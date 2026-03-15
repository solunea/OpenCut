import { upsertEffectParamKeyframe } from "@/lib/animation/effect-param-channel";
import { setChannel } from "@/lib/animation/keyframes";
import type { ElementAnimations } from "@/types/animation";
import type { CursorTrackingData } from "@/types/cursor-tracking";
import type { Effect } from "@/types/effects";
import type { VideoElement } from "@/types/timeline";

const EFFECT_PARAM_PATH_PREFIX = "effects.";
const EFFECT_PARAM_PATH_SUFFIX = ".params.";
const TIME_EPSILON = 1e-6;
const MAX_SAMPLES = 120;
const MIN_TIME_DELTA = 0.08;
const MIN_MOVEMENT_DELTA = 0.35;

type ZoomCursorKeyframe = {
	time: number;
	focusX: number;
	focusY: number;
	interpolation: "linear" | "hold";
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function buildEffectParamPath({
	effectId,
	paramKey,
}: {
	effectId: string;
	paramKey: string;
}): string {
	return `${EFFECT_PARAM_PATH_PREFIX}${effectId}${EFFECT_PARAM_PATH_SUFFIX}${paramKey}`;
}

function simplifyKeyframes({
	keyframes,
}: {
	keyframes: ZoomCursorKeyframe[];
}): ZoomCursorKeyframe[] {
	if (keyframes.length <= 2) {
		return keyframes;
	}

	const simplified: ZoomCursorKeyframe[] = [keyframes[0]];
	let lastKept = keyframes[0];
	for (let index = 1; index < keyframes.length - 1; index += 1) {
		const keyframe = keyframes[index];
		const timeDelta = keyframe.time - lastKept.time;
		const movement = Math.hypot(
			keyframe.focusX - lastKept.focusX,
			keyframe.focusY - lastKept.focusY,
		);
		if (
			keyframe.interpolation === "hold" ||
			timeDelta >= MIN_TIME_DELTA ||
			movement >= MIN_MOVEMENT_DELTA
		) {
			simplified.push(keyframe);
			lastKept = keyframe;
		}
	}
	const lastKeyframe = keyframes[keyframes.length - 1];
	if (simplified[simplified.length - 1] !== lastKeyframe) {
		simplified.push(lastKeyframe);
	}
	return simplified;
}

function dedupeByTime({
	keyframes,
}: {
	keyframes: ZoomCursorKeyframe[];
}): ZoomCursorKeyframe[] {
	const deduped: ZoomCursorKeyframe[] = [];
	for (const keyframe of keyframes) {
		const previous = deduped[deduped.length - 1];
		if (previous && Math.abs(previous.time - keyframe.time) <= TIME_EPSILON) {
			deduped[deduped.length - 1] = keyframe;
			continue;
		}
		deduped.push(keyframe);
	}
	return deduped;
}

function buildZoomCursorKeyframes({
	cursorTracking,
	element,
	sourceDuration,
}: {
	cursorTracking: CursorTrackingData;
	element: VideoElement;
	sourceDuration: number;
}): ZoomCursorKeyframe[] {
	const playbackRate = element.playbackRate ?? 1;
	const freezeFrameStart = element.freezeFrameStart ?? 0;
	const freezeFrameEnd = element.freezeFrameEnd ?? 0;
	const visibleStartSourceTime = element.trimStart;
	const visibleEndSourceTime = Math.max(
		visibleStartSourceTime,
		sourceDuration - element.trimEnd,
	);
	const visibleTimelineEnd = Math.max(
		freezeFrameStart,
		element.duration - freezeFrameEnd,
	);
	const visibleSamples = cursorTracking.samples
		.filter(
			(sample) =>
				sample.time >= visibleStartSourceTime - TIME_EPSILON &&
				sample.time <= visibleEndSourceTime + TIME_EPSILON,
		)
		.slice(0, MAX_SAMPLES);

	if (visibleSamples.length === 0) {
		throw new Error("No cursor samples overlap the visible clip range");
	}

	const mappedSamples = visibleSamples.map((sample) => ({
		time: clamp(
			freezeFrameStart +
				(sample.time - visibleStartSourceTime) / Math.max(playbackRate, 0.001),
			freezeFrameStart,
			visibleTimelineEnd,
		),
		focusX: clamp(sample.x * 100, 0, 100),
		focusY: clamp((1 - sample.y) * 100, 0, 100),
	}));

	const firstSample = mappedSamples[0];
	const lastSample = mappedSamples[mappedSamples.length - 1];
	const keyframes: ZoomCursorKeyframe[] = [
		{
			time: 0,
			focusX: firstSample.focusX,
			focusY: firstSample.focusY,
			interpolation:
				freezeFrameStart > 0 || firstSample.time > TIME_EPSILON ? "hold" : "linear",
		},
	];

	if (firstSample.time > TIME_EPSILON) {
		keyframes.push({
			time: firstSample.time,
			focusX: firstSample.focusX,
			focusY: firstSample.focusY,
			interpolation: "linear",
		});
	}

	for (let index = 1; index < mappedSamples.length; index += 1) {
		const sample = mappedSamples[index];
		keyframes.push({
			time: sample.time,
			focusX: sample.focusX,
			focusY: sample.focusY,
			interpolation: "linear",
		});
	}

	const visibleEndKeyframe: ZoomCursorKeyframe = {
		time: visibleTimelineEnd,
		focusX: lastSample.focusX,
		focusY: lastSample.focusY,
		interpolation: freezeFrameEnd > 0 ? "hold" : "linear",
	};
	keyframes.push(visibleEndKeyframe);

	if (freezeFrameEnd > 0 && visibleTimelineEnd < element.duration - TIME_EPSILON) {
		keyframes.push({
			time: element.duration,
			focusX: lastSample.focusX,
			focusY: lastSample.focusY,
			interpolation: "hold",
		});
		keyframes[keyframes.length - 2] = {
			...keyframes[keyframes.length - 2],
			interpolation: "hold",
		};
	}

	return simplifyKeyframes({ keyframes: dedupeByTime({ keyframes }) });
}

export function applyCursorTrackingToZoomEffect({
	animations,
	effect,
	element,
	cursorTracking,
	sourceDuration,
}: {
	animations: ElementAnimations | undefined;
	effect: Effect;
	element: VideoElement;
	cursorTracking: CursorTrackingData;
	sourceDuration: number;
}): {
	animations: ElementAnimations | undefined;
	focusX: number;
	focusY: number;
	sampleCount: number;
} {
	if (cursorTracking.status !== "ready" || cursorTracking.samples.length === 0) {
		throw new Error("Cursor tracking data is not ready");
	}

	const keyframes = buildZoomCursorKeyframes({
		cursorTracking,
		element,
		sourceDuration,
	});
	let nextAnimations = setChannel({
		animations,
		propertyPath: buildEffectParamPath({ effectId: effect.id, paramKey: "focusX" }),
		channel: undefined,
	});
	nextAnimations = setChannel({
		animations: nextAnimations,
		propertyPath: buildEffectParamPath({ effectId: effect.id, paramKey: "focusY" }),
		channel: undefined,
	});

	for (const keyframe of keyframes) {
		nextAnimations = upsertEffectParamKeyframe({
			animations: nextAnimations,
			effectId: effect.id,
			paramKey: "focusX",
			time: keyframe.time,
			value: keyframe.focusX,
			interpolation: keyframe.interpolation,
		});
		nextAnimations = upsertEffectParamKeyframe({
			animations: nextAnimations,
			effectId: effect.id,
			paramKey: "focusY",
			time: keyframe.time,
			value: keyframe.focusY,
			interpolation: keyframe.interpolation,
		});
	}

	return {
		animations: nextAnimations,
		focusX: keyframes[0].focusX,
		focusY: keyframes[0].focusY,
		sampleCount: keyframes.length,
	};
}
