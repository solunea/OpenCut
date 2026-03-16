import { toast } from "sonner";
import type { MediaAsset } from "@/types/assets";
import { getMediaTypeFromFile } from "@/lib/media/media-utils";
import {
	getLottieMetadata,
	isLottieJsonFile,
	normalizeLottieFile,
} from "./lottie";
import { getVideoInfo } from "./mediabunny";
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from "mediabunny";

export interface ProcessedMediaAsset extends Omit<MediaAsset, "id"> {}

const THUMBNAIL_MAX_WIDTH = 1280;
const THUMBNAIL_MAX_HEIGHT = 720;

const getThumbnailSize = ({
	width,
	height,
}: {
	width: number;
	height: number;
}): { width: number; height: number } => {
	const aspectRatio = width / height;
	let targetWidth = width;
	let targetHeight = height;

	if (targetWidth > THUMBNAIL_MAX_WIDTH) {
		targetWidth = THUMBNAIL_MAX_WIDTH;
		targetHeight = Math.round(targetWidth / aspectRatio);
	}
	if (targetHeight > THUMBNAIL_MAX_HEIGHT) {
		targetHeight = THUMBNAIL_MAX_HEIGHT;
		targetWidth = Math.round(targetHeight * aspectRatio);
	}

	return { width: targetWidth, height: targetHeight };
};

const renderToThumbnailDataUrl = ({
	width,
	height,
	draw,
}: {
	width: number;
	height: number;
	draw: ({
		context,
		width,
		height,
	}: {
		context: CanvasRenderingContext2D;
		width: number;
		height: number;
	}) => void;
}): string => {
	const size = getThumbnailSize({ width, height });
	const canvas = document.createElement("canvas");
	canvas.width = size.width;
	canvas.height = size.height;
	const context = canvas.getContext("2d");

	if (!context) {
		throw new Error("Could not get canvas context");
	}

	draw({ context, width: size.width, height: size.height });
	return canvas.toDataURL("image/jpeg", 0.8);
};

const getThumbnailTimeInSeconds = ({
	duration,
	preferredTimeInSeconds,
}: {
	duration?: number;
	preferredTimeInSeconds: number;
}): number => {
	if (!Number.isFinite(duration) || !duration || duration <= 0) {
		return Math.max(0, preferredTimeInSeconds);
	}

	const safeEndOffset = Math.min(0.05, duration / 4);
	return Math.max(
		0,
		Math.min(preferredTimeInSeconds, Math.max(0, duration - safeEndOffset)),
	);
};

export async function generateThumbnail({
	videoFile,
	timeInSeconds,
}: {
	videoFile: File;
	timeInSeconds: number;
}): Promise<string> {
	const input = new Input({
		source: new BlobSource(videoFile),
		formats: ALL_FORMATS,
	});

	const videoTrack = await input.getPrimaryVideoTrack();
	if (!videoTrack) {
		throw new Error("No video track found in the file");
	}

	const canDecode = await videoTrack.canDecode();
	if (!canDecode) {
		throw new Error("Video codec not supported for decoding");
	}

	const sink = new VideoSampleSink(videoTrack);

	const frame = await sink.getSample(timeInSeconds);

	if (!frame) {
		throw new Error("Could not get frame at specified time");
	}

	try {
		return renderToThumbnailDataUrl({
			width: videoTrack.displayWidth,
			height: videoTrack.displayHeight,
			draw: ({ context, width, height }) => {
				frame.draw(context, 0, 0, width, height);
			},
		});
	} finally {
		frame.close();
	}
}

async function generateThumbnailFromVideoElement({
	videoFile,
	timeInSeconds,
}: {
	videoFile: File;
	timeInSeconds: number;
}): Promise<{
	dataUrl: string;
	duration: number;
	height: number;
	width: number;
}> {
	return await new Promise((resolve, reject) => {
		const video = document.createElement("video");
		const objectUrl = URL.createObjectURL(videoFile);
		let settled = false;

		const cleanup = () => {
			URL.revokeObjectURL(objectUrl);
			video.pause();
			video.removeAttribute("src");
			video.load();
			video.remove();
		};

		const settle = (
			callback: () => void,
		) => {
			if (settled) {
				return;
			}

			settled = true;
			callback();
			cleanup();
		};

		const capture = () => {
			if (!video.videoWidth || !video.videoHeight) {
				settle(() => reject(new Error("Could not read video frame size")));
				return;
			}

			try {
				const dataUrl = renderToThumbnailDataUrl({
					width: video.videoWidth,
					height: video.videoHeight,
					draw: ({ context, width, height }) => {
						context.drawImage(video, 0, 0, width, height);
					},
				});

				settle(() =>
					resolve({
						dataUrl,
						duration: Number.isFinite(video.duration) ? video.duration : 0,
						height: video.videoHeight,
						width: video.videoWidth,
					}),
				);
			} catch (error) {
				settle(() =>
					reject(
						error instanceof Error
							? error
							: new Error("Could not render video thumbnail"),
					),
				);
			}
		};

		video.addEventListener(
			"loadedmetadata",
			() => {
				const targetTimeInSeconds = getThumbnailTimeInSeconds({
					duration: video.duration,
					preferredTimeInSeconds: timeInSeconds,
				});

				try {
					video.currentTime = targetTimeInSeconds;
				} catch (error) {
					settle(() =>
						reject(
							error instanceof Error
								? error
								: new Error("Could not seek video for thumbnail"),
						),
					);
				}
			},
			{ once: true },
		);

		video.addEventListener("seeked", capture, { once: true });
		video.addEventListener(
			"error",
			() => {
				settle(() => reject(new Error("Could not load video")));
			},
			{ once: true },
		);

		video.muted = true;
		video.playsInline = true;
		video.preload = "metadata";
		video.src = objectUrl;
		video.load();
	});
}

export async function generateImageThumbnail({
	imageFile,
}: {
	imageFile: File;
}): Promise<string> {
	return new Promise((resolve, reject) => {
		const image = new window.Image();
		const objectUrl = URL.createObjectURL(imageFile);

		image.addEventListener("load", () => {
			try {
				const dataUrl = renderToThumbnailDataUrl({
					width: image.naturalWidth,
					height: image.naturalHeight,
					draw: ({ context, width, height }) => {
						context.drawImage(image, 0, 0, width, height);
					},
				});
				resolve(dataUrl);
			} catch (error) {
				reject(
					error instanceof Error ? error : new Error("Could not render image"),
				);
			} finally {
				URL.revokeObjectURL(objectUrl);
				image.remove();
			}
		});

		image.addEventListener("error", () => {
			URL.revokeObjectURL(objectUrl);
			image.remove();
			reject(new Error("Could not load image"));
		});

		image.src = objectUrl;
	});
}

export async function processMediaAssets({
	files,
	onProgress,
}: {
	files: FileList | File[];
	onProgress?: ({ progress }: { progress: number }) => void;
}): Promise<ProcessedMediaAsset[]> {
	const fileArray = Array.from(files);
	const processedAssets: ProcessedMediaAsset[] = [];

	const total = fileArray.length;
	let completed = 0;

	for (const inputFile of fileArray) {
		let file = inputFile;
		let fileType = getMediaTypeFromFile({ file });

		if (!fileType && (await isLottieJsonFile({ file }))) {
			fileType = "lottie";
		}

		if (!fileType) {
			toast.error(`Unsupported file type: ${file.name}`);
			continue;
		}

		if (fileType === "lottie") {
			file = await normalizeLottieFile({ file });
		}

		const url = URL.createObjectURL(file);
		let thumbnailUrl: string | undefined;
		let duration: number | undefined;
		let width: number | undefined;
		let height: number | undefined;
		let fps: number | undefined;

		try {
			if (fileType === "image") {
				const dimensions = await getImageDimensions({ file });
				width = dimensions.width;
				height = dimensions.height;
				thumbnailUrl = await generateImageThumbnail({ imageFile: file });
			} else if (fileType === "video") {
				const preferredThumbnailTimeInSeconds = 1;
				let thumbnailTimeInSeconds = preferredThumbnailTimeInSeconds;

				try {
					const videoInfo = await getVideoInfo({ videoFile: file });
					duration = videoInfo.duration;
					width = videoInfo.width;
					height = videoInfo.height;
					fps = Number.isFinite(videoInfo.fps)
						? Math.round(videoInfo.fps)
						: undefined;
				} catch (error) {
					console.warn("Video metadata processing failed", error);
				}

				thumbnailTimeInSeconds = getThumbnailTimeInSeconds({
					duration,
					preferredTimeInSeconds: preferredThumbnailTimeInSeconds,
				});

				try {
					thumbnailUrl = await generateThumbnail({
						videoFile: file,
						timeInSeconds: thumbnailTimeInSeconds,
					});
				} catch (error) {
					console.warn("Video thumbnail decoding failed", error);

					try {
						const browserThumbnail = await generateThumbnailFromVideoElement({
							videoFile: file,
							timeInSeconds: thumbnailTimeInSeconds,
						});
						thumbnailUrl = browserThumbnail.dataUrl;
						duration = duration ?? browserThumbnail.duration;
						width = width ?? browserThumbnail.width;
						height = height ?? browserThumbnail.height;
					} catch (fallbackError) {
						console.warn("Browser video thumbnail generation failed", fallbackError);
					}
				}
			} else if (fileType === "audio") {
				// For audio, we don't set width/height/fps (they'll be undefined)
				duration = await getMediaDuration({ file });
			} else if (fileType === "lottie") {
				const metadata = await getLottieMetadata({ url });
				duration = metadata.duration;
				width = metadata.width;
				height = metadata.height;
				fps = metadata.fps;
				thumbnailUrl = metadata.thumbnailUrl;
			}

			processedAssets.push({
				name: file.name,
				type: fileType,
				file,
				url,
				thumbnailUrl,
				duration,
				width,
				height,
				fps,
			});

			await new Promise((resolve) => setTimeout(resolve, 0));

			completed += 1;
			if (onProgress) {
				const percent = Math.round((completed / total) * 100);
				onProgress({ progress: percent });
			}
		} catch (error) {
			console.error("Error processing file:", file.name, error);
			toast.error(`Failed to process ${file.name}`);
			URL.revokeObjectURL(url); // Clean up on error
		}
	}

	return processedAssets;
}

const getImageDimensions = ({
	file,
}: {
	file: File;
}): Promise<{ width: number; height: number }> => {
	return new Promise((resolve, reject) => {
		const img = new window.Image();
		const objectUrl = URL.createObjectURL(file);

		img.addEventListener("load", () => {
			const width = img.naturalWidth;
			const height = img.naturalHeight;
			resolve({ width, height });
			URL.revokeObjectURL(objectUrl);
			img.remove();
		});

		img.addEventListener("error", () => {
			reject(new Error("Could not load image"));
			URL.revokeObjectURL(objectUrl);
			img.remove();
		});

		img.src = objectUrl;
	});
};

const getMediaDuration = ({ file }: { file: File }): Promise<number> => {
	return new Promise((resolve, reject) => {
		const element = document.createElement(
			file.type.startsWith("video/") ? "video" : "audio",
		) as HTMLVideoElement;
		const objectUrl = URL.createObjectURL(file);

		element.addEventListener("loadedmetadata", () => {
			resolve(element.duration);
			URL.revokeObjectURL(objectUrl);
			element.remove();
		});

		element.addEventListener("error", () => {
			reject(new Error("Could not load media"));
			URL.revokeObjectURL(objectUrl);
			element.remove();
		});

		element.src = objectUrl;
		element.load();
	});
};
