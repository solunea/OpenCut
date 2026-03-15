import type { CursorSample, CursorTrackingData } from "@/types/cursor-tracking";

const ANALYSIS_SAMPLE_RATE = 10;
const ANALYSIS_MAX_WIDTH = 960;
const GLOBAL_SEARCH_STEP = 8;
const LOCAL_SEARCH_STEP = 2;
const LOCAL_SEARCH_RADIUS = 72;
const MIN_MATCH_SCORE = 0.72;
const MAX_SAMPLES = 240;
const MIN_KEYFRAME_TIME_DELTA = 0.08;
const MIN_NORMALIZED_MOVEMENT = 0.0035;

type TemplateData = {
	width: number;
	height: number;
	lightOffsets: number[];
	darkOffsets: number[];
};

type MatchResult = {
	x: number;
	y: number;
	score: number;
	template: TemplateData;
};

type SearchRegion = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	step: number;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function waitForEvent<T extends Event>({
	target,
	eventName,
}: {
	target: EventTarget;
	eventName: string;
}): Promise<T> {
	return new Promise((resolve, reject) => {
		const handleEvent = (event: Event) => {
			cleanup();
			resolve(event as T);
		};
		const handleError = () => {
			cleanup();
			reject(new Error(`Failed while waiting for ${eventName}`));
		};
		const cleanup = () => {
			target.removeEventListener(eventName, handleEvent);
			target.removeEventListener("error", handleError);
		};
		target.addEventListener(eventName, handleEvent, { once: true });
		target.addEventListener("error", handleError, { once: true });
	});
}

function createCanvas({ width, height }: { width: number; height: number }) {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new Error("Could not get 2D canvas context");
	}
	return { canvas, context };
}

function drawArrowTemplate({
	size,
	fillStyle,
	strokeStyle,
}: {
	size: number;
	fillStyle: string;
	strokeStyle: string;
}): HTMLCanvasElement {
	const padding = Math.max(2, Math.round(size * 0.14));
	const { canvas, context } = createCanvas({
		width: size + padding * 2,
		height: size + padding * 2,
	});
	context.translate(padding, padding);
	context.beginPath();
	context.moveTo(0, 0);
	context.lineTo(0, size * 0.8);
	context.lineTo(size * 0.23, size * 0.61);
	context.lineTo(size * 0.38, size);
	context.lineTo(size * 0.53, size * 0.93);
	context.lineTo(size * 0.38, size * 0.55);
	context.lineTo(size * 0.7, size * 0.55);
	context.closePath();
	context.fillStyle = fillStyle;
	context.strokeStyle = strokeStyle;
	context.lineJoin = "round";
	context.lineWidth = Math.max(2, Math.round(size * 0.1));
	context.fill();
	context.stroke();
	return canvas;
}

function extractTemplateData({ canvas }: { canvas: HTMLCanvasElement }): TemplateData {
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new Error("Could not get template context");
	}
	const { width, height } = canvas;
	const imageData = context.getImageData(0, 0, width, height);
	const lightOffsets: number[] = [];
	const darkOffsets: number[] = [];

	for (let index = 0; index < imageData.data.length; index += 4) {
		const alpha = imageData.data[index + 3];
		if (alpha < 80) {
			continue;
		}
		const pixelIndex = index / 4;
		const luminance =
			imageData.data[index] * 0.299 +
			imageData.data[index + 1] * 0.587 +
			imageData.data[index + 2] * 0.114;
		if (luminance >= 160) {
			lightOffsets.push(pixelIndex);
		} else {
			darkOffsets.push(pixelIndex);
		}
	}

	return { width, height, lightOffsets, darkOffsets };
}

function buildTemplates(): TemplateData[] {
	const sizes = [18, 22, 26, 30];
	return sizes.flatMap((size) => [
		extractTemplateData({
			canvas: drawArrowTemplate({
				size,
				fillStyle: "#ffffff",
				strokeStyle: "#111111",
			}),
		}),
		extractTemplateData({
			canvas: drawArrowTemplate({
				size,
				fillStyle: "#111111",
				strokeStyle: "#ffffff",
			}),
		}),
	]);
}

const TEMPLATE_CACHE = typeof window === "undefined" ? [] : buildTemplates();

function scoreTemplateAtPosition({
	luminance,
	frameWidth,
	frameHeight,
	template,
	x,
	y,
}: {
	luminance: Uint8ClampedArray;
	frameWidth: number;
	frameHeight: number;
	template: TemplateData;
	x: number;
	y: number;
}): number {
	if (x < 0 || y < 0 || x + template.width >= frameWidth || y + template.height >= frameHeight) {
		return 0;
	}

	let darkMatches = 0;
	let lightMatches = 0;
	let darkTotal = 0;
	let lightTotal = 0;
	let localMin = 255;
	let localMax = 0;

	for (const offset of template.darkOffsets) {
		const sampleX = x + (offset % template.width);
		const sampleY = y + Math.floor(offset / template.width);
		const value = luminance[sampleY * frameWidth + sampleX];
		if (value < localMin) localMin = value;
		if (value > localMax) localMax = value;
		darkTotal += 1;
		if (value <= 115) {
			darkMatches += 1;
		}
	}

	for (const offset of template.lightOffsets) {
		const sampleX = x + (offset % template.width);
		const sampleY = y + Math.floor(offset / template.width);
		const value = luminance[sampleY * frameWidth + sampleX];
		if (value < localMin) localMin = value;
		if (value > localMax) localMax = value;
		lightTotal += 1;
		if (value >= 145) {
			lightMatches += 1;
		}
	}

	if (darkTotal === 0 || lightTotal === 0) {
		return 0;
	}

	const darkScore = darkMatches / darkTotal;
	const lightScore = lightMatches / lightTotal;
	const contrastScore = clamp((localMax - localMin) / 90, 0, 1);
	return darkScore * 0.5 + lightScore * 0.35 + contrastScore * 0.15;
}

function findBestMatch({
	luminance,
	frameWidth,
	frameHeight,
	regions,
}: {
	luminance: Uint8ClampedArray;
	frameWidth: number;
	frameHeight: number;
	regions: SearchRegion[];
}): MatchResult | null {
	let bestMatch: MatchResult | null = null;

	for (const region of regions) {
		for (const template of TEMPLATE_CACHE) {
			const maxX = Math.min(region.right, frameWidth - template.width - 1);
			const maxY = Math.min(region.bottom, frameHeight - template.height - 1);
			for (let y = region.top; y <= maxY; y += region.step) {
				for (let x = region.left; x <= maxX; x += region.step) {
					const score = scoreTemplateAtPosition({
						luminance,
						frameWidth,
						frameHeight,
						template,
						x,
						y,
					});
					if (!bestMatch || score > bestMatch.score) {
						bestMatch = { x, y, score, template };
					}
				}
			}
		}
	}

	return bestMatch;
}

function toLuminance({ imageData }: { imageData: ImageData }): Uint8ClampedArray {
	const luminance = new Uint8ClampedArray(imageData.width * imageData.height);
	for (let sourceIndex = 0, targetIndex = 0; sourceIndex < imageData.data.length; sourceIndex += 4, targetIndex += 1) {
		luminance[targetIndex] = Math.round(
			imageData.data[sourceIndex] * 0.299 +
				imageData.data[sourceIndex + 1] * 0.587 +
				imageData.data[sourceIndex + 2] * 0.114,
		);
	}
	return luminance;
}

function buildSearchRegions({
	previousMatch,
	frameWidth,
	frameHeight,
}: {
	previousMatch: MatchResult | null;
	frameWidth: number;
	frameHeight: number;
}): SearchRegion[] {
	if (!previousMatch) {
		return [
			{
				left: 0,
				top: 0,
				right: frameWidth - 1,
				bottom: frameHeight - 1,
				step: GLOBAL_SEARCH_STEP,
			},
		];
	}

	const centerX = previousMatch.x + previousMatch.template.width / 2;
	const centerY = previousMatch.y + previousMatch.template.height / 2;
	const localRegion: SearchRegion = {
		left: Math.max(0, Math.round(centerX - LOCAL_SEARCH_RADIUS)),
		top: Math.max(0, Math.round(centerY - LOCAL_SEARCH_RADIUS)),
		right: Math.min(frameWidth - 1, Math.round(centerX + LOCAL_SEARCH_RADIUS)),
		bottom: Math.min(frameHeight - 1, Math.round(centerY + LOCAL_SEARCH_RADIUS)),
		step: LOCAL_SEARCH_STEP,
	};

	return [
		localRegion,
		{
			left: 0,
			top: 0,
			right: frameWidth - 1,
			bottom: frameHeight - 1,
			step: GLOBAL_SEARCH_STEP,
		},
	];
}

function simplifySamples({ samples }: { samples: CursorSample[] }): CursorSample[] {
	if (samples.length <= 2) {
		return samples;
	}

	const simplified: CursorSample[] = [samples[0]];
	let lastKept = samples[0];
	for (let index = 1; index < samples.length - 1; index += 1) {
		const sample = samples[index];
		const timeDelta = sample.time - lastKept.time;
		const movement = Math.hypot(sample.x - lastKept.x, sample.y - lastKept.y);
		if (timeDelta >= 0.22 || movement >= MIN_NORMALIZED_MOVEMENT) {
			simplified.push(sample);
			lastKept = sample;
		}
	}
	const lastSample = samples[samples.length - 1];
	if (simplified[simplified.length - 1] !== lastSample) {
		simplified.push(lastSample);
	}
	return simplified;
}

export async function analyzeCursorTracking({
	videoFile,
}: {
	videoFile: File;
}): Promise<CursorTrackingData> {
	if (typeof document === "undefined") {
		throw new Error("Cursor tracking is only available in the browser");
	}

	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	const objectUrl = URL.createObjectURL(videoFile);
	video.src = objectUrl;

	try {
		if (video.readyState < 1) {
			await waitForEvent({ target: video, eventName: "loadedmetadata" });
		}

		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		if (duration <= 0) {
			throw new Error("Video duration is unavailable");
		}

		const sourceWidth = video.videoWidth;
		const sourceHeight = video.videoHeight;
		if (!sourceWidth || !sourceHeight) {
			throw new Error("Video dimensions are unavailable");
		}

		const scale = Math.min(1, ANALYSIS_MAX_WIDTH / sourceWidth);
		const analysisWidth = Math.max(1, Math.round(sourceWidth * scale));
		const analysisHeight = Math.max(1, Math.round(sourceHeight * scale));
		const { canvas, context } = createCanvas({
			width: analysisWidth,
			height: analysisHeight,
		});
		const targetSampleCount = Math.min(MAX_SAMPLES, Math.max(12, Math.round(duration * ANALYSIS_SAMPLE_RATE)));
		const stepSeconds = duration / targetSampleCount;
		const samples: CursorSample[] = [];
		let previousMatch: MatchResult | null = null;
		let lastAcceptedSample: CursorSample | null = null;

		for (let index = 0; index <= targetSampleCount; index += 1) {
			if (index > 0 && index % 6 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			const targetTime = clamp(index * stepSeconds, 0, duration);
			if (Math.abs(video.currentTime - targetTime) > 0.001) {
				video.currentTime = targetTime;
				await waitForEvent({ target: video, eventName: "seeked" });
			}

			context.clearRect(0, 0, analysisWidth, analysisHeight);
			context.drawImage(video, 0, 0, analysisWidth, analysisHeight);
			const imageData = context.getImageData(0, 0, analysisWidth, analysisHeight);
			const luminance = toLuminance({ imageData });
			const searchRegions = buildSearchRegions({
				previousMatch,
				frameWidth: analysisWidth,
				frameHeight: analysisHeight,
			});
			const bestMatch = findBestMatch({
				luminance,
				frameWidth: analysisWidth,
				frameHeight: analysisHeight,
				regions: searchRegions,
			});

			if (!bestMatch || bestMatch.score < MIN_MATCH_SCORE) {
				previousMatch = null;
				continue;
			}

			previousMatch = bestMatch;
			const cursorX = clamp(
				(bestMatch.x + bestMatch.template.width * 0.18) / analysisWidth,
				0,
				1,
			);
			const cursorY = clamp(
				(bestMatch.y + bestMatch.template.height * 0.08) / analysisHeight,
				0,
				1,
			);
			const sample: CursorSample = {
				time: targetTime,
				x: cursorX,
				y: cursorY,
				confidence: bestMatch.score,
			};
			if (
				lastAcceptedSample &&
				targetTime - lastAcceptedSample.time < MIN_KEYFRAME_TIME_DELTA
			) {
				continue;
			}
			samples.push(sample);
			lastAcceptedSample = sample;
		}

		const simplifiedSamples = simplifySamples({ samples });
		if (simplifiedSamples.length === 0) {
			throw new Error("No cursor motion could be detected reliably");
		}

		const averageConfidence =
			simplifiedSamples.reduce((sum, sample) => sum + sample.confidence, 0) /
			simplifiedSamples.length;

		canvas.remove();
		video.remove();

		return {
			status: "ready",
			samples: simplifiedSamples,
			averageConfidence,
			analyzedAt: new Date().toISOString(),
			analysisWidth,
			analysisHeight,
		};
	} finally {
		URL.revokeObjectURL(objectUrl);
		video.removeAttribute("src");
		video.load();
		video.remove();
	}
}
