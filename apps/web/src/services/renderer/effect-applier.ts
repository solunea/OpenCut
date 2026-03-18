import { getEffect } from "@/lib/effects";
import { resolveZoomRenderState } from "@/lib/effects/definitions/zoom";
import type { EffectParamValues, ZoomEffectTransition } from "@/types/effects";
import { createOffscreenCanvas } from "./canvas-utils";
import { webglEffectRenderer } from "./webgl-effect-renderer";

function resolveZoomGeometry({
  width,
  height,
  effectParams,
  progress,
  duration,
  sourceTime,
  zoomTransition,
}: {
  width: number;
  height: number;
  effectParams: EffectParamValues;
  progress: number;
  duration?: number;
  sourceTime?: number;
  zoomTransition?: ZoomEffectTransition;
}) {
  const renderState = resolveZoomRenderState({
    effectParams,
    progress,
    duration,
    sourceTime,
    zoomTransition,
  });
  const scale = Math.max(1, 1 + (renderState.zoom - 1) * renderState.strength);
  const tiltX = renderState.tiltX * renderState.strength;
  const tiltY = renderState.tiltY * renderState.strength;
  const rotationX = ((renderState.rotationX * Math.PI) / 180) * renderState.strength;
  const perspective = renderState.perspective * renderState.strength;
  const tiltShearX = tiltY * (0.12 + perspective * 0.28);
  const tiltShearY = tiltX * (0.12 + perspective * 0.28);
  const horizontalCompression =
    1 - Math.min(Math.abs(tiltX) * (0.08 + perspective * 0.18), 0.24);
  const verticalCompression =
    1 - Math.min(Math.abs(tiltY) * (0.08 + perspective * 0.18), 0.24);
  const scaleX = Math.max(0.0001, horizontalCompression);
  const scaleY = Math.max(0.0001, verticalCompression);
  const focusPixelX = width * renderState.focusX;
  const focusPixelY = height * renderState.focusY;
  const centerX = width / 2;
  const centerY = height / 2;
  const shearX = tiltShearX * (width / height);
  const shearY = tiltShearY * (height / width);
  const cosRotation = Math.cos(rotationX);
  const sinRotation = Math.sin(rotationX);
  const matrixA = cosRotation * scaleX;
  const matrixB = sinRotation * scaleX + shearY;
  const matrixC = cosRotation * shearX - sinRotation * scaleY;
  const matrixD = sinRotation * shearX + cosRotation * scaleY;
  const translateX = centerX - matrixA * centerX - matrixC * centerY;
  const translateY = centerY - matrixB * centerX - matrixD * centerY;

  return {
    renderState,
    scale,
    focusPixelX,
    focusPixelY,
    matrixA,
    matrixB,
    matrixC,
    matrixD,
    translateX,
    translateY,
  };
}

export function mapPointThroughZoomEffect({
  x,
  y,
  width,
  height,
  effectParams,
  progress,
  duration,
  sourceTime,
  zoomTransition,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  effectParams: EffectParamValues;
  progress: number;
  duration?: number;
  sourceTime?: number;
  zoomTransition?: ZoomEffectTransition;
}): { x: number; y: number } {
  const geometry = resolveZoomGeometry({
    width,
    height,
    effectParams,
    progress,
    duration,
    sourceTime,
    zoomTransition,
  });
  const zoomedX =
    geometry.focusPixelX + (x - geometry.focusPixelX) * geometry.scale;
  const zoomedY =
    geometry.focusPixelY + (y - geometry.focusPixelY) * geometry.scale;

  return {
    x: geometry.matrixA * zoomedX + geometry.matrixC * zoomedY + geometry.translateX,
    y: geometry.matrixB * zoomedX + geometry.matrixD * zoomedY + geometry.translateY,
  };
}

function applyZoomCpuEffect({
  source,
  width,
  height,
  effectParams,
  progress,
  duration,
  sourceTime,
  zoomTransition,
}: {
  source: CanvasImageSource;
  width: number;
  height: number;
  effectParams: EffectParamValues;
  progress: number;
  duration?: number;
  sourceTime?: number;
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

  const geometry = resolveZoomGeometry({
    width,
    height,
    effectParams,
    progress,
    duration,
    sourceTime,
    zoomTransition,
  });

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
    geometry.focusPixelX - geometry.focusPixelX / geometry.scale,
    geometry.focusPixelY - geometry.focusPixelY / geometry.scale,
    width / geometry.scale,
    height / geometry.scale,
    0,
    0,
    width,
    height,
  );

  context.imageSmoothingEnabled = true;
  context.save();
  context.setTransform(
    geometry.matrixA,
    geometry.matrixB,
    geometry.matrixC,
    geometry.matrixD,
    geometry.translateX,
    geometry.translateY,
  );
  context.drawImage(zoomCanvas, 0, 0, width, height);
  context.restore();

  if (geometry.renderState.keepFrameFixed) {
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
  sourceTime,
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
  sourceTime?: number;
  zoomTransition?: ZoomEffectTransition;
}): CanvasImageSource {
  const definition = getEffect({ effectType });

  if (definition.renderer.type === "webgl") {
    const passes = definition.renderer.passes.map((pass) => ({
      fragmentShader: pass.fragmentShader,
      uniforms: pass.uniforms({
        effectParams,
        width,
        height,
        localTime,
        duration,
        progress,
        sourceTime,
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
  }

  if (effectType === "zoom") {
    return applyZoomCpuEffect({
      source,
      width,
      height,
      effectParams,
      progress,
      duration,
      sourceTime,
      zoomTransition,
    });
  }

  return source;
}
