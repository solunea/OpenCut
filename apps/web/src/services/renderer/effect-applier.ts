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

	context.imageSmoothingEnabled = true;
	context.drawImage(source, offsetX, offsetY, scaledWidth, scaledHeight);
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
