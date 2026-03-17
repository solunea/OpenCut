import type { CanvasRenderer } from "../canvas-renderer";
import type { EffectParamValues, ZoomEffectTransition } from "@/types/effects";
import { BaseNode } from "./base-node";
import { applyRendererEffect } from "../effect-applier";

const TIME_EPSILON = 1e-6;

export type EffectLayerNodeParams = {
	effectType: string;
	effectParams: EffectParamValues;
	timeOffset: number;
	duration: number;
	zoomTransition?: ZoomEffectTransition;
};

function isInRange({
	time,
	timeOffset,
	duration,
}: {
	time: number;
	timeOffset: number;
	duration: number;
}): boolean {
	return (
		time >= timeOffset - TIME_EPSILON &&
		time < timeOffset + duration
	);
}

// snapshots whatever is currently on the canvas, applies the effect, draws it back
export class EffectLayerNode extends BaseNode<EffectLayerNodeParams> {
	async render({
		renderer,
		time,
	}: {
		renderer: CanvasRenderer;
		time: number;
	}): Promise<void> {
		if (
			!isInRange({
				time,
				timeOffset: this.params.timeOffset,
				duration: this.params.duration,
			})
		) {
			return;
		}

		const localTime = Math.max(0, time - this.params.timeOffset);
		const progress =
			this.params.duration <= 0
				? 1
				: Math.min(localTime / this.params.duration, 1);

		const source = renderer.context.canvas as CanvasImageSource;
		const rasterWidth = renderer.getRasterWidth();
		const rasterHeight = renderer.getRasterHeight();

		const effectResult = applyRendererEffect({
			source,
			width: rasterWidth,
			height: rasterHeight,
			effectType: this.params.effectType,
			effectParams: this.params.effectParams,
			localTime,
			duration: this.params.duration,
			progress,
			zoomTransition: this.params.zoomTransition,
		});

		renderer.context.save();
		renderer.context.clearRect(0, 0, renderer.width, renderer.height);
		renderer.context.drawImage(
			effectResult,
			0,
			0,
			renderer.width,
			renderer.height,
		);
		renderer.context.restore();
	}
}
