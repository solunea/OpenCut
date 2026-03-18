import type {
	EffectDefinition,
	EffectParamValues,
	ZoomEffectTransition,
	ZoomTransitionState,
} from "@/types/effects";
import type { CursorTrackingData } from "@/types/cursor-tracking";
import zoomFragmentShader from "./zoom.frag.glsl";

function resolveNumber({
	value,
	fallback,
}: {
	value: number | string | boolean | undefined;
	fallback: number;
}): number {
	if (typeof value === "number") {
		return value;
	}
	const parsed = Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveOptionalNumber({
	value,
}: {
	value: number | string | boolean | undefined;
}): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	const parsed = Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : null;
}

function resolveBoolean({
	value,
	fallback,
}: {
	value: number | string | boolean | undefined;
	fallback: boolean;
}): boolean {
	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return value !== 0;
	}

	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") {
			return true;
		}
		if (normalized === "false") {
			return false;
		}
	}

	return fallback;
}

function clamp01(value: number): number {
	return Math.min(Math.max(value, 0), 1);
}

function easeInOutSine(value: number): number {
	const t = clamp01(value);
	return -(Math.cos(Math.PI * t) - 1) / 2;
}

function easeOutCubic(value: number): number {
	const t = clamp01(value);
	return 1 - (1 - t) ** 3;
}

function easeOutBack(value: number): number {
	const t = clamp01(value);
	const overshoot = 1.05;
	const c1 = overshoot;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

type ZoomMotionVariant = "soft" | "punchy";
type ZoomTransitionBoundary = "start" | "end";
export type ZoomFocusSource = "manual" | "media-tracking";

type ZoomMotionProfile = {
	entryStrength: (value: number) => number;
	exitStrength: (value: number) => number;
	zoomTransition: (value: number) => number;
	focusTransition: (value: number) => number;
};

function resolveZoomMotionVariant({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): ZoomMotionVariant {
	return effectParams.motion === "punchy" ? "punchy" : "soft";
}

function resolveZoomMode({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): "zoom" | "tilt" {
	return effectParams.mode === "tilt" ? "tilt" : "zoom";
}

function resolveTiltEnabled({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): boolean {
	if (typeof effectParams.tiltEnabled === "boolean") {
		return effectParams.tiltEnabled;
	}
	return resolveZoomMode({ effectParams }) === "tilt";
}

export function resolveZoomFocusSource({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): ZoomFocusSource {
	return effectParams.focusSource === "media-tracking"
		? "media-tracking"
		: "manual";
}

function resolveCursorTrackingFocusAtTime({
	cursorTracking,
	sourceTime,
}: {
	cursorTracking?: CursorTrackingData;
	sourceTime: number;
}): { focusX: number; focusY: number } | null {
	if (
		!cursorTracking ||
		cursorTracking.status !== "ready" ||
		cursorTracking.samples.length === 0
	) {
		return null;
	}

	const samples = cursorTracking.samples;
	const clampedSourceTime = Math.max(sourceTime, 0);
	const firstSample = samples[0];
	const lastSample = samples[samples.length - 1];

	if (clampedSourceTime <= firstSample.time) {
		return {
			focusX: clamp01(firstSample.x),
			focusY: clamp01(1 - firstSample.y),
		};
	}

	if (clampedSourceTime >= lastSample.time) {
		return {
			focusX: clamp01(lastSample.x),
			focusY: clamp01(1 - lastSample.y),
		};
	}

	for (let index = 1; index < samples.length; index += 1) {
		const previousSample = samples[index - 1];
		const nextSample = samples[index];
		if (clampedSourceTime > nextSample.time) {
			continue;
		}

		const timeRange = nextSample.time - previousSample.time;
		if (timeRange <= 1e-6) {
			return {
				focusX: clamp01(nextSample.x),
				focusY: clamp01(1 - nextSample.y),
			};
		}

		const progress = clamp01((clampedSourceTime - previousSample.time) / timeRange);
		return {
			focusX: clamp01(
				lerp({
					leftValue: previousSample.x,
					rightValue: nextSample.x,
					progress,
				}),
			),
			focusY: clamp01(
				1 -
					lerp({
						leftValue: previousSample.y,
						rightValue: nextSample.y,
						progress,
					}),
			),
		};
	}

	return {
		focusX: clamp01(lastSample.x),
		focusY: clamp01(1 - lastSample.y),
	};
}

function resolveZoomFocusState({
	effectParams,
	cursorTracking,
	sourceTime,
}: {
	effectParams: EffectParamValues;
	cursorTracking?: CursorTrackingData;
	sourceTime?: number;
}): { focusX: number; focusY: number } {
	const fallback = {
		focusX: clamp01(resolveNumber({ value: effectParams.focusX, fallback: 50 }) / 100),
		focusY: clamp01(resolveNumber({ value: effectParams.focusY, fallback: 50 }) / 100),
	};

	if (resolveZoomFocusSource({ effectParams }) !== "media-tracking") {
		return fallback;
	}

	if (typeof sourceTime !== "number" || !Number.isFinite(sourceTime)) {
		return fallback;
	}

	return (
		resolveCursorTrackingFocusAtTime({
			cursorTracking,
			sourceTime,
		}) ?? fallback
	);
}

export function resolveZoomEffectParamsForRender({
	effectParams,
	cursorTracking,
	sourceTime,
}: {
	effectParams: EffectParamValues;
	cursorTracking?: CursorTrackingData;
	sourceTime?: number;
}): EffectParamValues {
	const focusState = resolveZoomFocusState({
		effectParams,
		cursorTracking,
		sourceTime,
	});

	return {
		...effectParams,
		focusX: focusState.focusX * 100,
		focusY: focusState.focusY * 100,
	};
}

function resolveZoomMotionProfile({
	variant,
}: {
	variant: ZoomMotionVariant;
}): ZoomMotionProfile {
	if (variant === "soft") {
		return {
			entryStrength: easeOutCubic,
			exitStrength: easeInOutSine,
			zoomTransition: easeInOutSine,
			focusTransition: easeInOutSine,
		};
	}

	return {
		entryStrength: easeOutBack,
		exitStrength: easeOutCubic,
		zoomTransition: easeOutBack,
		focusTransition: easeOutCubic,
	};
}

function lerp({
	leftValue,
	rightValue,
	progress,
}: {
	leftValue: number;
	rightValue: number;
	progress: number;
}): number {
	return leftValue + (rightValue - leftValue) * progress;
}

function resolveTiltX({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): number {
	return Math.min(
		Math.max(resolveNumber({ value: effectParams.tiltX, fallback: 0 }), -100),
		100,
	) / 100;
}

function resolveTiltY({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): number {
	return Math.min(
		Math.max(resolveNumber({ value: effectParams.tiltY, fallback: 18 }), -100),
		100,
	) / 100;
}

function resolveRotationX({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): number {
	return resolveNumber({
		value: effectParams.rotationX,
		fallback: resolveNumber({ value: effectParams.rotation, fallback: 4 }),
	});
}

function resolveTiltPerspective({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): number {
	return clamp01(resolveNumber({ value: effectParams.perspective, fallback: 55 }) / 100);
}

function resolveConfiguredEaseDurations({
	effectParams,
	duration,
}: {
	effectParams: EffectParamValues;
	duration: number;
}): {
	entrySeconds: number;
	exitSeconds: number;
} {
	const sharedEase = resolveOptionalNumber({ value: effectParams.ease });
	if (sharedEase !== null) {
		const resolvedEase = Math.max(sharedEase, 0);
		return {
			entrySeconds: resolvedEase,
			exitSeconds: resolvedEase,
		};
	}

	if (duration > 0) {
		return {
			entrySeconds:
				duration *
				clamp01(resolveNumber({ value: effectParams.easeIn, fallback: 20 }) / 100),
			exitSeconds:
				duration *
				clamp01(resolveNumber({ value: effectParams.easeOut, fallback: 20 }) / 100),
		};
	}

	return {
		entrySeconds: 0.4,
		exitSeconds: 0.4,
	};
}

function resolveActiveEaseDurations({
	entrySeconds,
	exitSeconds,
	duration,
	hasNext,
}: {
	entrySeconds: number;
	exitSeconds: number;
	duration: number;
	hasNext: boolean;
}): {
	entrySeconds: number;
	exitSeconds: number;
} {
	let resolvedEntry = Math.max(entrySeconds, 0);
	let resolvedExit = hasNext ? 0 : Math.max(exitSeconds, 0);

	if (duration > 0) {
		const total = resolvedEntry + resolvedExit;
		if (total > duration && total > 0) {
			const scale = duration / total;
			resolvedEntry *= scale;
			resolvedExit *= scale;
		}
	}

	return {
		entrySeconds: resolvedEntry,
		exitSeconds: resolvedExit,
	};
}

export function resolveZoomTransitionState({
	effectParams,
	boundary,
	travelProgress,
}: {
	effectParams: EffectParamValues;
	boundary?: ZoomTransitionBoundary;
	travelProgress?: number;
}): ZoomTransitionState {
	const keepFrameFixed = resolveBoolean({
		value: effectParams.keepFrameFixed,
		fallback: true,
	});
	const _boundary = boundary;
	const _travelProgress = travelProgress;
	void _boundary;
	void _travelProgress;
	const tiltEnabled = resolveTiltEnabled({ effectParams });
	const focusState = resolveZoomFocusState({ effectParams });

	return {
		zoom: Math.max(resolveNumber({ value: effectParams.zoom, fallback: 1.35 }), 1),
		focusX: focusState.focusX,
		focusY: focusState.focusY,
		keepFrameFixed,
		tiltX: tiltEnabled ? resolveTiltX({ effectParams }) : 0,
		tiltY: tiltEnabled ? resolveTiltY({ effectParams }) : 0,
		rotationX: tiltEnabled ? resolveRotationX({ effectParams }) : 0,
		perspective: tiltEnabled ? resolveTiltPerspective({ effectParams }) : 0,
	};
}

export function resolveZoomRenderState({
	effectParams,
	progress,
	duration,
	zoomTransition,
	cursorTracking,
	sourceTime,
}: {
	effectParams: EffectParamValues;
	progress: number;
	duration?: number;
	zoomTransition?: ZoomEffectTransition;
	cursorTracking?: CursorTrackingData;
	sourceTime?: number;
}): ZoomTransitionState & { strength: number } {
	const motionProfile = resolveZoomMotionProfile({
		variant: resolveZoomMotionVariant({ effectParams }),
	});
	const clampedProgress = clamp01(progress);
	const resolvedEffectParams = resolveZoomEffectParamsForRender({
		effectParams,
		cursorTracking,
		sourceTime,
	});
	const targetState = resolveZoomTransitionState({
		effectParams: resolvedEffectParams,
		travelProgress: motionProfile.focusTransition(clampedProgress),
	});
	const previousState = zoomTransition?.previous;
	const nextState = zoomTransition?.next;
	const hasPrevious =
		previousState?.keepFrameFixed === targetState.keepFrameFixed;
	const hasNext = nextState?.keepFrameFixed === targetState.keepFrameFixed;
	const resolvedDuration =
		typeof duration === "number" && duration > 0 ? duration : 1;
	const localTime = clampedProgress * resolvedDuration;
	const configuredEases = resolveConfiguredEaseDurations({
		effectParams,
		duration: resolvedDuration,
	});
	const { entrySeconds, exitSeconds } = resolveActiveEaseDurations({
		entrySeconds: configuredEases.entrySeconds,
		exitSeconds: configuredEases.exitSeconds,
		duration: resolvedDuration,
		hasNext,
	});

	if (hasPrevious && previousState && entrySeconds > 0 && localTime < entrySeconds) {
		const normalizedTransitionTime = localTime / entrySeconds;
		const zoomTransitionProgress = motionProfile.zoomTransition(normalizedTransitionTime);
		const focusTransitionProgress = motionProfile.focusTransition(normalizedTransitionTime);
		return {
			zoom: lerp({
				leftValue: previousState.zoom,
				rightValue: targetState.zoom,
				progress: zoomTransitionProgress,
			}),
			focusX: lerp({
				leftValue: previousState.focusX,
				rightValue: targetState.focusX,
				progress: focusTransitionProgress,
			}),
			focusY: lerp({
				leftValue: previousState.focusY,
				rightValue: targetState.focusY,
				progress: focusTransitionProgress,
			}),
			keepFrameFixed: targetState.keepFrameFixed,
			tiltX: lerp({
				leftValue: previousState.tiltX,
				rightValue: targetState.tiltX,
				progress: focusTransitionProgress,
			}),
			tiltY: lerp({
				leftValue: previousState.tiltY,
				rightValue: targetState.tiltY,
				progress: focusTransitionProgress,
			}),
			rotationX: lerp({
				leftValue: previousState.rotationX,
				rightValue: targetState.rotationX,
				progress: focusTransitionProgress,
			}),
			perspective: lerp({
				leftValue: previousState.perspective,
				rightValue: targetState.perspective,
				progress: focusTransitionProgress,
			}),
			strength: 1,
		};
	}

	const exitStrength =
		exitSeconds > 0
			? 1 -
				motionProfile.exitStrength(
					1 - (resolvedDuration - localTime) / exitSeconds,
				)
			: 1;

	if (!hasPrevious) {
		const entryStrength =
			entrySeconds > 0 ? motionProfile.entryStrength(localTime / entrySeconds) : 1;
		return {
			...targetState,
			strength: Math.min(entryStrength, exitStrength),
		};
	}

	return {
		...targetState,
		strength: exitStrength,
	};
}

export const zoomEffectDefinition: EffectDefinition = {
	type: "zoom",
	name: "Zoom",
	keywords: ["zoom", "focus", "punch in", "shots", "tilt"],
	params: [
		{
			key: "zoom",
			label: "Zoom",
			type: "number",
			default: 1.35,
			min: 1,
			max: 4,
			step: 0.01,
		},
		{
			key: "focusSource",
			label: "Focus Source",
			type: "select",
			default: "manual",
			options: [
				{ value: "manual", label: "Manual" },
				{ value: "media-tracking", label: "Media Tracking" },
			],
		},
		{
			key: "focusX",
			label: "Focus X",
			type: "number",
			default: 50,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "focusY",
			label: "Focus Y",
			type: "number",
			default: 50,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "tiltEnabled",
			label: "Tilt",
			type: "boolean",
			default: false,
		},
		{
			key: "tiltX",
			label: "Tilt X",
			type: "number",
			default: 0,
			min: -100,
			max: 100,
			step: 1,
		},
		{
			key: "tiltY",
			label: "Tilt Y",
			type: "number",
			default: 18,
			min: -100,
			max: 100,
			step: 1,
		},
		{
			key: "rotationX",
			label: "Rotation X",
			type: "number",
			default: 4,
			min: -25,
			max: 25,
			step: 0.1,
		},
		{
			key: "perspective",
			label: "Perspective",
			type: "number",
			default: 55,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "keepFrameFixed",
			label: "Keep Frame Fixed",
			type: "boolean",
			default: true,
		},
		{
			key: "motion",
			label: "Motion",
			type: "select",
			default: "soft",
			options: [
				{ value: "soft", label: "Soft" },
				{ value: "punchy", label: "Punchy" },
			],
		},
		{
			key: "ease",
			label: "Ease (s)",
			type: "number",
			default: 1,
			min: 0,
			max: 5,
			step: 0.05,
		},
	],
	renderer: {
		type: "webgl",
		passes: [
			{
				fragmentShader: zoomFragmentShader,
				uniforms: ({ effectParams, progress, duration, zoomTransition }) => {
					const renderState = resolveZoomRenderState({
						effectParams,
						progress: progress ?? 1,
						duration,
						zoomTransition,
					});

					return {
						u_focus: [renderState.focusX, renderState.focusY],
						u_zoom: renderState.zoom,
						u_tiltX: renderState.tiltX,
						u_tiltY: renderState.tiltY,
						u_rotationX: renderState.rotationX,
						u_perspective: renderState.perspective,
						u_strength: renderState.strength,
						u_keepFrameFixed: renderState.keepFrameFixed ? 1 : 0,
					};
				},
			},
		],
	},
};
