import { describe, expect, test } from "bun:test";
import { DEFAULT_TRANSFORM } from "@/constants/timeline-constants";
import type { MediaAsset } from "@/types/assets";
import type { AudioElement, ImageElement, VideoElement } from "@/types/timeline";
import { buildReplaceMediaUpdates } from "../replace-media";

function buildMediaAsset({
	id,
	name,
	type,
	duration,
}: {
	id: string;
	name: string;
	type: MediaAsset["type"];
	duration?: number;
}): MediaAsset {
	return {
		id,
		name,
		type,
		duration,
		file: new File(["test"], `${name}.${type}`),
	};
}

function buildAudioElement(): AudioElement {
	return {
		id: "audio-element",
		type: "audio",
		sourceType: "upload",
		mediaId: "audio-1",
		name: "Audio",
		duration: 4,
		startTime: 0,
		trimStart: 1,
		trimEnd: 1,
		sourceDuration: 6,
		volume: 1,
		playbackRate: 1,
		muted: false,
	};
}

function buildVideoElement(): VideoElement {
	return {
		id: "video-element",
		type: "video",
		mediaId: "video-1",
		name: "Video",
		duration: 6,
		startTime: 0,
		trimStart: 1,
		trimEnd: 1,
		sourceDuration: 8,
		playbackRate: 1,
		freezeFrameStart: 0.5,
		freezeFrameEnd: 0.5,
		muted: false,
		hidden: false,
		transform: DEFAULT_TRANSFORM,
		opacity: 1,
	};
}

function buildImageElement(): ImageElement {
	return {
		id: "image-element",
		type: "image",
		mediaId: "image-1",
		name: "Image",
		duration: 5,
		startTime: 0,
		trimStart: 1,
		trimEnd: 1,
		sourceDuration: 7,
		hidden: false,
		transform: DEFAULT_TRANSFORM,
		opacity: 1,
	};
}

describe("buildReplaceMediaUpdates", () => {
	test("recomputes audio duration from the replacement media", () => {
		const updates = buildReplaceMediaUpdates({
			element: buildAudioElement(),
			mediaAsset: buildMediaAsset({
				id: "audio-2",
				name: "replacement-audio",
				type: "audio",
				duration: 10,
			}),
		});

		expect(updates.duration).toBe(8);
		expect(updates.trimStart).toBe(1);
		expect(updates.trimEnd).toBe(1);
	});

	test("recomputes video duration from the replacement media while preserving freeze padding", () => {
		const updates = buildReplaceMediaUpdates({
			element: buildVideoElement(),
			mediaAsset: buildMediaAsset({
				id: "video-2",
				name: "replacement-video",
				type: "video",
				duration: 12,
			}),
		});

		expect(updates.duration).toBe(11);
		expect(updates.trimStart).toBe(1);
		expect(updates.trimEnd).toBe(1);
	});

	test("updates lottie image duration to match the replacement animation", () => {
		const updates = buildReplaceMediaUpdates({
			element: buildImageElement(),
			mediaAsset: buildMediaAsset({
				id: "lottie-2",
				name: "replacement-animation",
				type: "lottie",
				duration: 9,
			}),
		});

		expect(updates.duration).toBe(7);
		expect(updates.trimStart).toBe(1);
		expect(updates.trimEnd).toBe(1);
	});
});
