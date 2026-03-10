import { createOffscreenCanvas } from "./canvas-utils";
import { getEffect } from "@/lib/effects";
import type { EffectParamValues } from "@/types/effects";
import { applyRendererEffect } from "./effect-applier";

const PREVIEW_SIZE = 160;
const PREVIEW_IMAGE_PATH = "/effects/preview.jpg";

let testSourceCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let previewImageElement: HTMLImageElement | null = null;
const onReadyCallbacks = new Set<() => void>();

export function onPreviewImageReady({
	callback,
}: {
	callback: () => void;
}): () => void {
	onReadyCallbacks.add(callback);
	return () => onReadyCallbacks.delete(callback);
}

function loadPreviewImage(): void {
	if (typeof window === "undefined") return;
	const image = new Image();
	image.onload = () => {
		testSourceCanvas = null;
		for (const callback of onReadyCallbacks) {
			callback();
		}
	};
	image.src = PREVIEW_IMAGE_PATH;
	previewImageElement = image;
}

loadPreviewImage();

function buildDefaultParams({
	effectType,
}: {
	effectType: string;
}): EffectParamValues {
	const definition = getEffect({ effectType });
	const params: EffectParamValues = {};
	for (const paramDef of definition.params) {
		params[paramDef.key] = paramDef.default;
	}
	return params;
}

function createTestSource({
	width,
	height,
}: {
	width: number;
	height: number;
}): OffscreenCanvas | HTMLCanvasElement | null {
	const isImageReady =
		previewImageElement?.complete &&
		(previewImageElement.naturalWidth ?? 0) > 0;
	if (!isImageReady || !previewImageElement) {
		return null;
	}

	const canvas = createOffscreenCanvas({ width, height });
	const ctx = canvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!ctx) {
		throw new Error("failed to get 2d context for test source");
	}
	ctx.drawImage(previewImageElement, 0, 0, width, height);
	return canvas;
}

function getTestSource({
	width,
	height,
}: {
	width: number;
	height: number;
}): CanvasImageSource | null {
	if (
		!testSourceCanvas ||
		testSourceCanvas.width !== width ||
		testSourceCanvas.height !== height
	) {
		testSourceCanvas = createTestSource({ width, height });
	}
	return testSourceCanvas;
}

export function renderPreview({
	effectType,
	params,
	targetCanvas,
}: {
	effectType: string;
	params: EffectParamValues;
	targetCanvas: HTMLCanvasElement;
}): void {
	const size = PREVIEW_SIZE;
	const source = getTestSource({ width: size, height: size });
	if (!source) return;

	const definition = getEffect({ effectType });
	const resolvedParams =
		Object.keys(params).length > 0
			? params
			: buildDefaultParams({ effectType });

	const result = applyRendererEffect({
		source,
		width: size,
		height: size,
		effectType: definition.type,
		effectParams: resolvedParams,
		localTime: 0,
		duration: 1,
		progress: 1,
	});

	const targetCtx = targetCanvas.getContext(
		"2d",
	) as CanvasRenderingContext2D | null;
	if (targetCtx) {
		targetCanvas.width = size;
		targetCanvas.height = size;
		targetCtx.drawImage(result, 0, 0, size, size);
	}
}

export const effectPreviewService = {
	renderPreview,
	onPreviewImageReady,
	PREVIEW_SIZE,
};
