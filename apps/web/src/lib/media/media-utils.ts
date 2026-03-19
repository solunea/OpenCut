import type { MediaAsset, MediaType } from "@/types/assets";
import type { ElementType, TrackType } from "@/types/timeline";

export const SUPPORTS_AUDIO: readonly MediaType[] = ["audio", "video"];

export function mediaSupportsAudio({
	media,
}: {
	media: MediaAsset | null | undefined;
}): boolean {
	if (!media) return false;
	return SUPPORTS_AUDIO.includes(media.type);
}

export const getMediaTypeFromFile = ({
	file,
}: {
	file: File;
}): MediaType | null => {
	const { type } = file;
	const lowerName = file.name.toLowerCase();

	if (lowerName.endsWith(".avf")) {
		return "video";
	}

	if (type.startsWith("image/")) {
		return "image";
	}
	if (type.startsWith("video/")) {
		return "video";
	}
	if (type.startsWith("audio/")) {
		return "audio";
	}
	if (type.includes("lottie") || lowerName.endsWith(".lottie")) {
		return "lottie";
	}

	return null;
};

export function getElementTypeFromMediaType({
	mediaType,
}: {
	mediaType: MediaType;
}): Extract<ElementType, "audio" | "video" | "image"> {
	switch (mediaType) {
		case "audio":
			return "audio";
		case "video":
			return "video";
		case "image":
		case "lottie":
			return "image";
	}
}

export function getTrackTypeFromMediaType({
	mediaType,
}: {
	mediaType: MediaType;
}): Extract<TrackType, "audio" | "video"> {
	return mediaType === "audio" ? "audio" : "video";
}
