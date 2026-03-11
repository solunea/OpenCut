import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import { BaseNode } from "./base-node";
import type { Effect } from "@/types/effects";
import type { BlendMode } from "@/types/rendering";
import type { Transform, VideoFrameStyle } from "@/types/timeline";
import type { ElementAnimations } from "@/types/animation";
import {
	getElementLocalTime,
	resolveOpacityAtTime,
	resolveTransformAtTime,
} from "@/lib/animation";
import {
	getSourceTimeFromTimelineTime,
	normalizePlaybackRate,
} from "@/lib/timeline/clip-speed";
import { resolveEffectParamsAtTime } from "@/lib/animation/effect-param-channel";
import { TIME_EPSILON_SECONDS } from "@/constants/animation-constants";
import { applyRendererEffect } from "../effect-applier";

type RenderableContext =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D;

const DEFAULT_FRAME_STYLE: Required<VideoFrameStyle> = {
	cornerRadius: 0,
	shadowBlur: 0,
	shadowOffsetX: 0,
	shadowOffsetY: 0,
	shadowOpacity: 35,
	shadowColor: "rgba(0, 0, 0, 0.35)",
};

function colorWithOpacity({
	color,
	opacity,
}: {
	color: string;
	opacity: number;
}): string {
	const normalizedOpacity = Math.min(Math.max(opacity, 0), 100) / 100;
	if (color.startsWith("rgba(")) {
		const parts = color.slice(5, -1).split(",").map((part) => part.trim());
		if (parts.length >= 3) {
			return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${normalizedOpacity})`;
		}
	}
	if (color.startsWith("rgb(")) {
		const parts = color.slice(4, -1).split(",").map((part) => part.trim());
		if (parts.length >= 3) {
			return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${normalizedOpacity})`;
		}
	}
	return color;
}

function resolveFrameStyle(frameStyle?: VideoFrameStyle): Required<VideoFrameStyle> {
	return {
		cornerRadius: frameStyle?.cornerRadius ?? DEFAULT_FRAME_STYLE.cornerRadius,
		shadowBlur: frameStyle?.shadowBlur ?? DEFAULT_FRAME_STYLE.shadowBlur,
		shadowOffsetX: frameStyle?.shadowOffsetX ?? DEFAULT_FRAME_STYLE.shadowOffsetX,
		shadowOffsetY: frameStyle?.shadowOffsetY ?? DEFAULT_FRAME_STYLE.shadowOffsetY,
		shadowOpacity: frameStyle?.shadowOpacity ?? DEFAULT_FRAME_STYLE.shadowOpacity,
		shadowColor: frameStyle?.shadowColor ?? DEFAULT_FRAME_STYLE.shadowColor,
	};
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

function applyRoundedMask({
	source,
	width,
	height,
	cornerRadius,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	cornerRadius: number;
}): CanvasImageSource {
	if (cornerRadius <= 0) {
		return source;
	}

	const maskedCanvas = createOffscreenCanvas({ width, height });
	const maskedCtx = maskedCanvas.getContext("2d") as RenderableContext | null;
	if (!maskedCtx) {
		return source;
	}

	const percent = Math.min(Math.max(cornerRadius, 0), 100) / 100;
	const radius = Math.min(width, height) * 0.5 * percent;
	maskedCtx.beginPath();
	maskedCtx.roundRect(0, 0, width, height, radius);
	maskedCtx.clip();
	maskedCtx.drawImage(source, 0, 0, width, height);
	return maskedCanvas;
}

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	playbackRate?: number;
	transform: Transform;
	animations?: ElementAnimations;
	opacity: number;
	blendMode?: BlendMode;
	frameStyle?: VideoFrameStyle;
	effects?: Effect[];
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
> extends BaseNode<Params> {
	protected getSourceLocalTime({ time }: { time: number }): number {
		return getSourceTimeFromTimelineTime({
			timelineTime: time,
			startTime: this.params.timeOffset,
			trimStart: this.params.trimStart,
			playbackRate: this.params.playbackRate,
		});
	}

	protected getAnimationLocalTime({ time }: { time: number }): number {
		return getElementLocalTime({
			timelineTime: time,
			elementStartTime: this.params.timeOffset,
			elementDuration: this.params.duration,
		});
	}

	protected isInRange({ time }: { time: number }): boolean {
		const localTime = this.getSourceLocalTime({ time });
		const playbackRate = normalizePlaybackRate({
			playbackRate: this.params.playbackRate,
		});
		return (
			localTime >= this.params.trimStart - TIME_EPSILON_SECONDS &&
			localTime <
				this.params.trimStart + this.params.duration * playbackRate
		);
	}

	protected renderVisual({
		renderer,
		source,
		sourceWidth,
		sourceHeight,
		timelineTime,
	}: {
		renderer: CanvasRenderer;
		source: CanvasImageSource;
		sourceWidth: number;
		sourceHeight: number;
		timelineTime: number;
	}): void {
		renderer.context.save();

		const animationLocalTime = this.getAnimationLocalTime({ time: timelineTime });
		const transform = resolveTransformAtTime({
			baseTransform: this.params.transform,
			animations: this.params.animations,
			localTime: animationLocalTime,
		});
		const opacity = resolveOpacityAtTime({
			baseOpacity: this.params.opacity,
			animations: this.params.animations,
			localTime: animationLocalTime,
		});
		const containScale = Math.min(
			renderer.width / sourceWidth,
			renderer.height / sourceHeight,
		);
		const scaledWidth = sourceWidth * containScale * transform.scale;
		const scaledHeight = sourceHeight * containScale * transform.scale;
		const pixelWidth = Math.max(1, Math.round(scaledWidth));
		const pixelHeight = Math.max(1, Math.round(scaledHeight));
		const x = renderer.width / 2 + transform.position.x - scaledWidth / 2;
		const y = renderer.height / 2 + transform.position.y - scaledHeight / 2;
		const frameStyle = resolveFrameStyle(this.params.frameStyle);
		const hasRoundedCorners = frameStyle.cornerRadius > 0;
		const hasShadow =
			frameStyle.shadowBlur > 0 ||
			frameStyle.shadowOffsetX !== 0 ||
			frameStyle.shadowOffsetY !== 0;

		renderer.context.globalCompositeOperation = (
			this.params.blendMode && this.params.blendMode !== "normal"
				? this.params.blendMode
				: "source-over"
		) as GlobalCompositeOperation;
		renderer.context.globalAlpha = opacity;

		if (transform.rotate !== 0) {
			const centerX = x + scaledWidth / 2;
			const centerY = y + scaledHeight / 2;
			renderer.context.translate(centerX, centerY);
			renderer.context.rotate((transform.rotate * Math.PI) / 180);
			renderer.context.translate(-centerX, -centerY);
		}

		const enabledEffects =
			this.params.effects?.filter((effect) => effect.enabled) ?? [];

		if (!hasRoundedCorners && !hasShadow && enabledEffects.length === 0) {
			renderer.context.drawImage(source, x, y, scaledWidth, scaledHeight);
			renderer.context.restore();
			return;
		}

		const elementCanvas = createOffscreenCanvas({
			width: pixelWidth,
			height: pixelHeight,
		});
		const elementCtx = elementCanvas.getContext("2d") as RenderableContext | null;
		if (!elementCtx) {
			renderer.context.drawImage(source, x, y, scaledWidth, scaledHeight);
			renderer.context.restore();
			return;
		}

		elementCtx.drawImage(source, 0, 0, pixelWidth, pixelHeight);

		let currentResult: CanvasImageSource = elementCanvas;
		let hasAppliedRoundedMask = false;

		for (const effect of enabledEffects) {
			const resolvedParams = resolveEffectParamsAtTime({
				effect,
				animations: this.params.animations,
				localTime: animationLocalTime,
			});
			const progress =
				this.params.duration <= 0
					? 1
					: Math.min(animationLocalTime / this.params.duration, 1);
			const keepFrameFixed = resolveBoolean({
				value: resolvedParams.keepFrameFixed,
				fallback: true,
			});
			const shouldSkipEffectForBackgroundBlur =
				renderer.renderLayer === "backgroundBlur" &&
				effect.type === "zoom" &&
				keepFrameFixed;

			if (shouldSkipEffectForBackgroundBlur) {
				continue;
			}

			const shouldApplyZoomAfterFrameMask =
				effect.type === "zoom" &&
				!keepFrameFixed;

			if (shouldApplyZoomAfterFrameMask && !hasAppliedRoundedMask) {
				currentResult = applyRoundedMask({
					source: currentResult,
					width: pixelWidth,
					height: pixelHeight,
					cornerRadius: frameStyle.cornerRadius,
				});
				hasAppliedRoundedMask = true;
			}

			currentResult = applyRendererEffect({
				source: currentResult,
				width: pixelWidth,
				height: pixelHeight,
				effectType: effect.type,
				effectParams: resolvedParams,
				localTime: animationLocalTime,
				duration: this.params.duration,
				progress,
			});
		}

		const finalResult = hasAppliedRoundedMask
			? currentResult
			: applyRoundedMask({
					source: currentResult,
					width: pixelWidth,
					height: pixelHeight,
					cornerRadius: frameStyle.cornerRadius,
				});

		renderer.context.shadowColor = hasShadow
			? colorWithOpacity({
					color: frameStyle.shadowColor,
					opacity: frameStyle.shadowOpacity,
				})
			: "transparent";
		renderer.context.shadowBlur = hasShadow ? frameStyle.shadowBlur : 0;
		renderer.context.shadowOffsetX = hasShadow ? frameStyle.shadowOffsetX : 0;
		renderer.context.shadowOffsetY = hasShadow ? frameStyle.shadowOffsetY : 0;

		renderer.context.drawImage(
			finalResult,
			x,
			y,
			scaledWidth,
			scaledHeight,
		);
		renderer.context.restore();
	}
}
