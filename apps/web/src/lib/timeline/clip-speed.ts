export const DEFAULT_PLAYBACK_RATE = 1;
export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;
const SOURCE_TIME_EPSILON = 1e-6;

export function normalizePlaybackRate({
	playbackRate,
}: {
	playbackRate?: number;
}): number {
	if (typeof playbackRate !== "number" || !Number.isFinite(playbackRate)) {
		return DEFAULT_PLAYBACK_RATE;
	}

	return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, playbackRate));
}

export function getSourceDuration({
	sourceDuration,
	trimStart,
	trimEnd,
	duration,
	playbackRate,
}: {
	sourceDuration?: number;
	trimStart: number;
	trimEnd: number;
	duration: number;
	playbackRate?: number;
}): number {
	if (typeof sourceDuration === "number" && Number.isFinite(sourceDuration)) {
		return sourceDuration;
	}

	return trimStart + getVisibleSourceDuration({ duration, playbackRate }) + trimEnd;
}

export function getVisibleSourceDuration({
	duration,
	playbackRate,
}: {
	duration: number;
	playbackRate?: number;
}): number {
	return Math.max(0, duration) * normalizePlaybackRate({ playbackRate });
}

export function getTimelineDurationFromSourceDuration({
	sourceDuration,
	trimStart,
	trimEnd,
	playbackRate,
}: {
	sourceDuration: number;
	trimStart: number;
	trimEnd: number;
	playbackRate?: number;
}): number {
	const visibleSourceDuration = Math.max(0, sourceDuration - trimStart - trimEnd);
	return visibleSourceDuration / normalizePlaybackRate({ playbackRate });
}

export function getSourceTimeFromTimelineTime({
	timelineTime,
	startTime,
	trimStart,
	playbackRate,
}: {
	timelineTime: number;
	startTime: number;
	trimStart: number;
	playbackRate?: number;
}): number {
	return (
		trimStart +
		Math.max(0, timelineTime - startTime) *
			normalizePlaybackRate({ playbackRate })
	);
}

export function normalizeFreezeFrameDuration({
	duration,
}: {
	duration?: number;
}): number {
	if (typeof duration !== "number" || !Number.isFinite(duration)) {
		return 0;
	}

	return Math.max(0, duration);
}

export function getVisibleTimelineDuration({
	duration,
	freezeFrameStart,
	freezeFrameEnd,
}: {
	duration: number;
	freezeFrameStart?: number;
	freezeFrameEnd?: number;
}): number {
	return Math.max(
		0,
		duration -
			normalizeFreezeFrameDuration({ duration: freezeFrameStart }) -
			normalizeFreezeFrameDuration({ duration: freezeFrameEnd }),
	);
}

export function getClampedVideoSourceTimeFromTimelineTime({
	timelineTime,
	startTime,
	trimStart,
	duration,
	playbackRate,
	freezeFrameStart,
	freezeFrameEnd,
}: {
	timelineTime: number;
	startTime: number;
	trimStart: number;
	duration: number;
	playbackRate?: number;
	freezeFrameStart?: number;
	freezeFrameEnd?: number;
}): number {
	const normalizedFreezeFrameStart = normalizeFreezeFrameDuration({
		duration: freezeFrameStart,
	});
	const visibleTimelineDuration = getVisibleTimelineDuration({
		duration,
		freezeFrameStart,
		freezeFrameEnd,
	});
	const playbackRateValue = normalizePlaybackRate({ playbackRate });
	const timelineLocalTime = Math.max(0, timelineTime - startTime);
	const visibleSourceStart = trimStart;
	const visibleSourceEnd =
		visibleSourceStart + visibleTimelineDuration * playbackRateValue;

	if (timelineLocalTime <= normalizedFreezeFrameStart) {
		return visibleSourceStart;
	}

	if (
		timelineLocalTime >=
		normalizedFreezeFrameStart + visibleTimelineDuration
	) {
		if (visibleSourceEnd <= visibleSourceStart) {
			return visibleSourceStart;
		}

		return Math.max(
			visibleSourceStart,
			visibleSourceEnd - SOURCE_TIME_EPSILON,
		);
	}

	return (
		visibleSourceStart +
		(timelineLocalTime - normalizedFreezeFrameStart) * playbackRateValue
	);
}
