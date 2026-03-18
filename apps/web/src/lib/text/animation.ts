import { DEFAULT_TEXT_ANIMATION } from "@/constants/text-constants";
import type { TextAnimation, Transform } from "@/types/timeline";
import { clamp } from "@/utils/math";

export interface ResolvedTextAnimationState {
	transform: Transform;
	opacityMultiplier: number;
	blurPx: number;
}

function easeInCubic({ progress }: { progress: number }): number {
	return progress * progress * progress;
}

function easeOutCubic({ progress }: { progress: number }): number {
	return 1 - (1 - progress) ** 3;
}

function easeOutBack({
	progress,
	overshoot,
}: {
	progress: number;
	overshoot: number;
}): number {
	const shifted = progress - 1;
	return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

function lerp({ from, to, progress }: { from: number; to: number; progress: number }) {
	return from + (to - from) * progress;
}

export function normalizeTextAnimation({
	textAnimation,
}: {
	textAnimation?: TextAnimation;
}): Required<TextAnimation> {
	return {
		...DEFAULT_TEXT_ANIMATION,
		...textAnimation,
	};
}

export function resolveTextAnimationState({
	textAnimation,
	transform,
	localTime,
	duration,
	segmentDelay = 0,
	maxSegmentDelay = 0,
}: {
	textAnimation?: TextAnimation;
	transform: Transform;
	localTime: number;
	duration: number;
	segmentDelay?: number;
	maxSegmentDelay?: number;
}): ResolvedTextAnimationState {
	const normalized = normalizeTextAnimation({ textAnimation });
	const delayedLocalTime = localTime - segmentDelay;

	if (normalized.preset === "none" || duration <= 0) {
		return {
			transform,
			opacityMultiplier: 1,
			blurPx: 0,
		};
	}

	const availableAnimationDuration = Math.max(0, duration - maxSegmentDelay);
	const requestedDurationIn = Math.max(0, normalized.durationIn);
	const requestedDurationOut = Math.max(0, normalized.durationOut);
	const minimumVisibleDuration =
		requestedDurationIn > 0 && requestedDurationOut > 0
			? Math.min(0.12, availableAnimationDuration * 0.2)
			: 0;
	const animationBudget = Math.max(0, availableAnimationDuration - minimumVisibleDuration);
	const totalRequestedDuration = requestedDurationIn + requestedDurationOut;
	const durationScale =
		totalRequestedDuration > 0 && totalRequestedDuration > animationBudget
			? animationBudget / totalRequestedDuration
			: 1;

	const durationIn = clamp({
		value: requestedDurationIn * durationScale,
		min: 0,
		max: animationBudget,
	});
	const durationOut = clamp({
		value: requestedDurationOut * durationScale,
		min: 0,
		max: Math.max(0, animationBudget - durationIn),
	});
	const distance = Math.max(0, normalized.distance);
	const intensity = Math.max(0, normalized.intensity);
	const blur = Math.max(0, normalized.blur);

	const nextTransform: Transform = {
		scale: transform.scale,
		position: { ...transform.position },
		rotate: transform.rotate,
	};
	let opacityMultiplier = 1;
	let blurPx = 0;

	if (durationIn > 0) {
		const enterProgress = clamp({
			value: delayedLocalTime / durationIn,
			min: 0,
			max: 1,
		});
		const enterEase = easeOutCubic({ progress: enterProgress });

		switch (normalized.preset) {
			case "fade":
				opacityMultiplier *= enterEase;
				break;
			case "slide-up":
				nextTransform.position.y += (1 - enterEase) * distance;
				opacityMultiplier *= enterEase;
				break;
			case "slide-down":
				nextTransform.position.y -= (1 - enterEase) * distance;
				opacityMultiplier *= enterEase;
				break;
			case "pop": {
				const startScale = Math.max(0.01, 1 - intensity * 0.35);
				const popEase = easeOutBack({
					progress: enterProgress,
					overshoot: 1 + intensity * 0.35,
				});
				nextTransform.scale *= lerp({
					from: startScale,
					to: 1,
					progress: popEase,
				});
				opacityMultiplier *= enterEase;
				break;
			}
			case "blur":
				blurPx = Math.max(blurPx, (1 - enterEase) * blur);
				opacityMultiplier *= enterEase;
				break;
			default:
				break;
		}
	}

	if (durationOut > 0) {
		const exitStart = Math.max(0, durationIn + minimumVisibleDuration);
		const exitProgress = clamp({
			value: (delayedLocalTime - exitStart) / durationOut,
			min: 0,
			max: 1,
		});
		const exitEase = easeInCubic({ progress: exitProgress });

		switch (normalized.preset) {
			case "fade":
				opacityMultiplier *= 1 - exitEase;
				break;
			case "slide-up":
				nextTransform.position.y -= exitEase * distance;
				opacityMultiplier *= 1 - exitEase;
				break;
			case "slide-down":
				nextTransform.position.y += exitEase * distance;
				opacityMultiplier *= 1 - exitEase;
				break;
			case "pop": {
				const endScale = Math.max(0.01, 1 - intensity * 0.2);
				nextTransform.scale *= lerp({
					from: 1,
					to: endScale,
					progress: exitEase,
				});
				opacityMultiplier *= 1 - exitEase;
				break;
			}
			case "blur":
				blurPx = Math.max(blurPx, exitEase * blur);
				opacityMultiplier *= 1 - exitEase;
				break;
			default:
				break;
		}
	}

	return {
		transform: nextTransform,
		opacityMultiplier: clamp({ value: opacityMultiplier, min: 0, max: 1 }),
		blurPx,
	};
}
