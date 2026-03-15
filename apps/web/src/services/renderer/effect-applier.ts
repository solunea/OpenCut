import { getEffect } from "@/lib/effects";
import { resolveZoomRenderState } from "@/lib/effects/definitions/zoom";
import type { EffectParamValues, ZoomEffectTransition } from "@/types/effects";
import { createOffscreenCanvas } from "./canvas-utils";
import { webglEffectRenderer } from "./webgl-effect-renderer";

function applyZoomCpuEffect({
	source,
	width,
	height,
	effectParams,
	progress,
	duration,
	zoomTransition,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	effectParams: EffectParamValues;
	progress: number;
	duration?: number;
	zoomTransition?: ZoomEffectTransition;
}): CanvasImageSource {
	const canvas = createOffscreenCanvas({ width, height });
	const context = canvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!context) {
		return source;
	}

	const renderState = resolveZoomRenderState({
		effectParams,
		progress,
		duration,
		zoomTransition,
	});
	const scale = Math.max(1, 1 + (renderState.zoom - 1) * renderState.strength);
	const tilt = renderState.tilt * renderState.strength;
	const rotation = ((renderState.rotation * Math.PI) / 180) * renderState.strength;
	const perspective = renderState.perspective * renderState.strength;
	const tiltShear = tilt * (0.12 + perspective * 0.28);
	const verticalCompression = 1 - Math.min(Math.abs(tilt) * (0.08 + perspective * 0.18), 0.24);
	const scaleY = Math.max(0.0001, verticalCompression);
	const focusPixelX = width * renderState.focusX;
	const focusPixelY = height * renderState.focusY;
	const centerX = width / 2;
	const centerY = height / 2;
	const shearX = tiltShear * (width / height);
	const cosRotation = Math.cos(rotation);
	const sinRotation = Math.sin(rotation);
	const matrixA = cosRotation;
	const matrixB = sinRotation;
	const matrixC = cosRotation * shearX - sinRotation * scaleY;
	const matrixD = sinRotation * shearX + cosRotation * scaleY;

	const zoomCanvas = createOffscreenCanvas({ width, height });
	const zoomContext = zoomCanvas.getContext("2d") as
		| CanvasRenderingContext2D
		| OffscreenCanvasRenderingContext2D
		| null;
	if (!zoomContext) {
		return source;
	}

	zoomContext.imageSmoothingEnabled = true;
	zoomContext.drawImage(
		source,
		focusPixelX - focusPixelX / scale,
		focusPixelY - focusPixelY / scale,
		width / scale,
		height / scale,
		0,
		0,
		width,
		height,
	);

	context.imageSmoothingEnabled = true;
	context.save();
	context.setTransform(
		matrixA,
		matrixB,
		matrixC,
		matrixD,
		centerX - matrixA * centerX - matrixC * centerY,
		centerY - matrixB * centerX - matrixD * centerY,
	);
	context.drawImage(zoomCanvas, 0, 0, width, height);
	context.restore();

	if (renderState.keepFrameFixed) {
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
	zoomTransition,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	effectType: string;
	effectParams: EffectParamValues;
	localTime?: number;
	duration?: number;
	progress?: number;
	zoomTransition?: ZoomEffectTransition;
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
			zoomTransition,
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
			duration,
			zoomTransition,
		});
	}

	return source;
}
