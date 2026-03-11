import { getEffect } from "@/lib/effects";
import type { EffectParamValues } from "@/types/effects";
import { createOffscreenCanvas } from "./canvas-utils";
import { webglEffectRenderer } from "./webgl-effect-renderer";

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

function easeOutSine(value: number): number {
	const t = clamp01(value);
	return Math.sin((t * Math.PI) / 2);
}

function easeInSine(value: number): number {
	const t = clamp01(value);
	return 1 - Math.cos((t * Math.PI) / 2);
}

function resolveStrength({
	progress,
	easeInPercent,
	easeOutPercent,
}: {
	progress: number;
	easeInPercent: number;
	easeOutPercent: number;
}): number {
	const normalizedProgress = clamp01(progress);
	const easeIn = clamp01(easeInPercent / 100);
	const easeOut = clamp01(easeOutPercent / 100);
	const easeOutStart = 1 - easeOut;

	if (easeIn > 0 && normalizedProgress < easeIn) {
		return easeInOutSine(easeOutSine(normalizedProgress / easeIn));
	}

	if (easeOut > 0 && normalizedProgress > easeOutStart) {
		return easeInOutSine(easeInSine((1 - normalizedProgress) / easeOut));
	}

	if (easeIn > easeOutStart) {
		const enter =
			easeIn > 0
				? easeInOutSine(easeOutSine(normalizedProgress / easeIn))
				: 1;
		const exit =
			easeOut > 0
				? easeInOutSine(easeInSine((1 - normalizedProgress) / easeOut))
				: 1;
		return Math.min(enter, exit);
	}

	return 1;
}

function applyZoomCpuEffect({
	source,
	width,
	height,
	effectParams,
	progress,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	effectParams: EffectParamValues;
	progress: number;
}): CanvasImageSource {
	const canvas = createOffscreenCanvas({ width, height });
	const context = canvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!context) {
		return source;
	}

	const zoom = Math.max(resolveNumber({ value: effectParams.zoom, fallback: 1.35 }), 1);
	const focusX = clamp01(resolveNumber({ value: effectParams.focusX, fallback: 50 }) / 100);
	const focusY = clamp01(resolveNumber({ value: effectParams.focusY, fallback: 50 }) / 100);
	const easeIn = resolveNumber({ value: effectParams.easeIn, fallback: 20 });
	const easeOut = resolveNumber({ value: effectParams.easeOut, fallback: 20 });
	const strength = resolveStrength({
		progress,
		easeInPercent: easeIn,
		easeOutPercent: easeOut,
	});
	const scale = Math.max(1, 1 + (zoom - 1) * strength);
	const focusPixelX = width * focusX;
	const focusPixelY = height * focusY;
	const scaledWidth = width * scale;
	const scaledHeight = height * scale;
	const offsetX = focusPixelX - focusPixelX * scale;
	const offsetY = focusPixelY - focusPixelY * scale;
	const keepFrameFixed = resolveBoolean({
		value: effectParams.keepFrameFixed,
		fallback: true,
	});

	context.imageSmoothingEnabled = true;
	context.drawImage(source, offsetX, offsetY, scaledWidth, scaledHeight);

	if (keepFrameFixed) {
		const baseCanvas = createOffscreenCanvas({ width, height });
		const baseCtx = baseCanvas.getContext("2d") as
			| CanvasRenderingContext2D
			| OffscreenCanvasRenderingContext2D
			| null;
		if (!baseCtx) {
			return canvas;
		}

		baseCtx.drawImage(source, 0, 0, width, height);

		const baseImageData = baseCtx.getImageData(0, 0, width, height);
		const zoomedImageData = context.getImageData(0, 0, width, height);
		const baseData = baseImageData.data;
		const zoomedData = zoomedImageData.data;

		for (let index = 0; index < baseData.length; index += 4) {
			const alpha = baseData[index + 3] / 255;
			const opaqueInterior = Math.min(Math.max((alpha - 0.98) / 0.019, 0), 1);

			zoomedData[index] = Math.round(
				baseData[index] + (zoomedData[index] - baseData[index]) * opaqueInterior,
			);
			zoomedData[index + 1] = Math.round(
				baseData[index + 1] +
					(zoomedData[index + 1] - baseData[index + 1]) * opaqueInterior,
			);
			zoomedData[index + 2] = Math.round(
				baseData[index + 2] +
					(zoomedData[index + 2] - baseData[index + 2]) * opaqueInterior,
			);
			zoomedData[index + 3] = baseData[index + 3];
		}

		context.putImageData(zoomedImageData, 0, 0);
	}

	return canvas;
}

export function applyRendererEffect({
	source,
	width,
	height,
	effectType,
	effectParams,
	localTime,
	duration,
	progress = 1,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	effectType: string;
	effectParams: EffectParamValues;
	localTime?: number;
	duration?: number;
	progress?: number;
}): CanvasImageSource {
	const definition = getEffect({ effectType });
	const passes = definition.renderer.passes.map((pass) => ({
		fragmentShader: pass.fragmentShader,
		uniforms: pass.uniforms({
			effectParams,
			width,
			height,
			localTime,
			duration,
			progress,
		}),
	}));

	const webglResult = webglEffectRenderer.applyEffectOrNull({
		source,
		width,
		height,
		passes,
	});
	if (webglResult) {
		return webglResult;
	}

	if (effectType === "zoom") {
		return applyZoomCpuEffect({
			source,
			width,
			height,
			effectParams,
			progress,
		});
	}

	return source;
}
