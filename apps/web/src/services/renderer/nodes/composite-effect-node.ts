import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import type { EffectParamValues } from "@/types/effects";
import { BaseNode } from "./base-node";
import { applyRendererEffect } from "../effect-applier";

export type CompositeEffectNodeParams = {
	contentNodes: BaseNode[];
	effectType: string;
	effectParams: EffectParamValues;
	scale: number;
};

export class CompositeEffectNode extends BaseNode<CompositeEffectNodeParams> {
	async render({
		renderer,
		time,
	}: {
		renderer: CanvasRenderer;
		time: number;
	}): Promise<void> {
		const offscreen = createOffscreenCanvas({
			width: renderer.width,
			height: renderer.height,
		});
		const offscreenCtx = offscreen.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
		if (!offscreenCtx) {
			throw new Error("failed to get offscreen canvas context");
		}

		const originalContext = renderer.context;
		renderer.context = offscreenCtx;

		for (const node of this.params.contentNodes) {
			await node.render({ renderer, time });
		}

		renderer.context = originalContext;

		const scale = this.params.scale;
		const scaledWidth = renderer.width * scale;
		const scaledHeight = renderer.height * scale;
		const offsetX = (renderer.width - scaledWidth) / 2;
		const offsetY = (renderer.height - scaledHeight) / 2;

		const effectResult = applyRendererEffect({
			source: offscreen as CanvasImageSource,
			width: renderer.width,
			height: renderer.height,
			effectType: this.params.effectType,
			effectParams: this.params.effectParams,
			localTime: time,
			duration: 1,
			progress: 1,
		});

		renderer.context.save();
		renderer.context.drawImage(
			effectResult,
			0,
			0,
			renderer.width,
			renderer.height,
			offsetX,
			offsetY,
			scaledWidth,
			scaledHeight,
		);
		renderer.context.restore();
	}
}
