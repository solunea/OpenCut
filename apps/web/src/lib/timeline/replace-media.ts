import {
	getTimelineDurationFromSourceDuration,
	getVisibleTimelineDuration,
	normalizeFreezeFrameDuration,
	normalizePlaybackRate,
} from "@/lib/timeline/clip-speed";
import type { MediaAsset, MediaType } from "@/types/assets";
import type {
	AudioElement,
	ImageElement,
	TimelineElement,
	VideoElement,
} from "@/types/timeline";

export interface ReplaceMediaTarget {
	trackId: string;
	elementId: string;
	elementType: Extract<TimelineElement["type"], "audio" | "video" | "image">;
	currentMediaId?: string | null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function getCompatibleElementTypesForMedia({
	mediaType,
}: {
	mediaType: MediaType;
}): ReplaceMediaTarget["elementType"][] {
	switch (mediaType) {
		case "audio":
			return ["audio"];
		case "video":
			return ["video"];
		case "image":
		case "lottie":
			return ["image"];
	}
}

export function canReplaceTimelineElementWithMediaType({
	elementType,
	mediaType,
}: {
	elementType: ReplaceMediaTarget["elementType"];
	mediaType: MediaType;
}): boolean {
	return getCompatibleElementTypesForMedia({ mediaType }).includes(elementType);
}

function ensureCompatible({
	element,
	mediaAsset,
}: {
	element: TimelineElement;
	mediaAsset: MediaAsset;
}): void {
	if (
		element.type !== "audio" &&
		element.type !== "video" &&
		element.type !== "image"
	) {
		throw new Error("Choose an audio, video, or image clip.");
	}

	if (
		element.type === "audio" &&
		mediaAsset.type === "audio" &&
		element.sourceType !== "upload"
	) {
		throw new Error("Only uploaded audio clips can be replaced.");
	}

	if (
		!canReplaceTimelineElementWithMediaType({
			elementType: element.type,
			mediaType: mediaAsset.type,
		})
	) {
		throw new Error("Choose a compatible media asset for this clip.");
	}
}

function getClampedSourceWindow({
	sourceDuration,
	trimStart,
	trimEnd,
}: {
	sourceDuration: number;
	trimStart: number;
	trimEnd: number;
}) {
	const nextTrimStart = clamp(trimStart, 0, sourceDuration);
	const nextTrimEnd = clamp(trimEnd, 0, Math.max(0, sourceDuration - nextTrimStart));
	return {
		trimStart: nextTrimStart,
		trimEnd: nextTrimEnd,
	};
}

function buildAudioReplaceUpdates({
	element,
	mediaAsset,
}: {
	element: AudioElement;
	mediaAsset: MediaAsset;
}) {
	const sourceDuration = mediaAsset.duration;
	if (typeof sourceDuration !== "number" || !Number.isFinite(sourceDuration)) {
		throw new Error("The new audio duration is unavailable.");
	}

	const { trimStart, trimEnd } = getClampedSourceWindow({
		sourceDuration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
	});
	const duration = Math.min(
		element.duration,
		getTimelineDurationFromSourceDuration({
			sourceDuration,
			trimStart,
			trimEnd,
			playbackRate: normalizePlaybackRate({ playbackRate: element.playbackRate }),
		}),
	);

	return {
		mediaId: mediaAsset.id,
		name: mediaAsset.name,
		sourceDuration,
		trimStart,
		trimEnd,
		duration,
		buffer: undefined,
	};
}

function buildVideoReplaceUpdates({
	element,
	mediaAsset,
}: {
	element: VideoElement;
	mediaAsset: MediaAsset;
}) {
	const sourceDuration = mediaAsset.duration;
	if (typeof sourceDuration !== "number" || !Number.isFinite(sourceDuration)) {
		throw new Error("The new video duration is unavailable.");
	}

	const { trimStart, trimEnd } = getClampedSourceWindow({
		sourceDuration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
	});
	const freezeFrameStart = normalizeFreezeFrameDuration({
		duration: element.freezeFrameStart,
	});
	const freezeFrameEnd = normalizeFreezeFrameDuration({
		duration: element.freezeFrameEnd,
	});
	const currentVisibleDuration = getVisibleTimelineDuration({
		duration: element.duration,
		freezeFrameStart,
		freezeFrameEnd,
	});
	const nextVisibleDuration = Math.min(
		currentVisibleDuration,
		getTimelineDurationFromSourceDuration({
			sourceDuration,
			trimStart,
			trimEnd,
			playbackRate: normalizePlaybackRate({ playbackRate: element.playbackRate }),
		}),
	);

	return {
		mediaId: mediaAsset.id,
		name: mediaAsset.name,
		sourceDuration,
		trimStart,
		trimEnd,
		duration: nextVisibleDuration + freezeFrameStart + freezeFrameEnd,
	};
}

function buildImageReplaceUpdates({
	element,
	mediaAsset,
}: {
	element: ImageElement;
	mediaAsset: MediaAsset;
}) {
	if (mediaAsset.type === "lottie") {
		const sourceDuration = mediaAsset.duration;
		if (typeof sourceDuration !== "number" || !Number.isFinite(sourceDuration)) {
			throw new Error("The new animation duration is unavailable.");
		}
		const { trimStart, trimEnd } = getClampedSourceWindow({
			sourceDuration,
			trimStart: element.trimStart,
			trimEnd: element.trimEnd,
		});
		return {
			mediaId: mediaAsset.id,
			name: mediaAsset.name,
			sourceDuration,
			trimStart,
			trimEnd,
		};
	}

	return {
		mediaId: mediaAsset.id,
		name: mediaAsset.name,
		sourceDuration: undefined,
		trimStart: 0,
		trimEnd: 0,
	};
}

export function buildReplaceMediaUpdates({
	element,
	mediaAsset,
}: {
	element: TimelineElement;
	mediaAsset: MediaAsset;
}) {
	ensureCompatible({ element, mediaAsset });

	if ("mediaId" in element && element.mediaId === mediaAsset.id) {
		throw new Error("This clip already uses the selected media.");
	}

	if (element.type === "audio") {
		return buildAudioReplaceUpdates({ element, mediaAsset });
	}

	if (element.type === "video") {
		return buildVideoReplaceUpdates({ element, mediaAsset });
	}

	if (element.type === "image") {
		return buildImageReplaceUpdates({ element, mediaAsset });
	}

	throw new Error("Choose an audio, video, or image clip.");
}
