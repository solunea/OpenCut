import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import {
	applyCustomCursorEffect,
	type AppliedZoomEffect,
} from "../custom-cursor-effect";
import { BaseNode } from "./base-node";
import type { Effect } from "@/types/effects";
import type { RecordedCursorData } from "@/types/cursor-tracking";
import type { BlendMode } from "@/types/rendering";
import type {
	MediaKeyframeEasing,
	Transform,
	VideoFrameStyle,
} from "@/types/timeline";
import type { ElementAnimations } from "@/types/animation";
import {
	getElementLocalTime,
	resolveOpacityAtTime,
	resolveTransformAtTime,
} from "@/lib/animation";
import { resolveZoomRenderState } from "@/lib/effects/definitions/zoom";
import {
	getClampedVideoSourceTimeFromTimelineTime,
	getSourceTimeFromTimelineTime,
	getVisibleTimelineDuration,
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

function clampNumber({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}): number {
	return Math.min(Math.max(value, min), max);
}

function resolveZoomFrameStyleState({
	effects,
	animations,
	localTime,
	duration,
}: {
	effects: Effect[];
	animations?: ElementAnimations;
	localTime: number;
	duration: number;
}):
	| {
			tiltX: number;
			tiltY: number;
			rotationX: number;
			perspective: number;
			strength: number;
	  }
	| undefined {
	let resolvedState:
		| {
				tiltX: number;
				tiltY: number;
				rotationX: number;
				perspective: number;
				strength: number;
		  }
		| undefined;

	for (const effect of effects) {
		if (!effect.enabled || effect.type !== "zoom") {
			continue;
		}

		const effectParams = resolveEffectParamsAtTime({
			effect,
			animations,
			localTime,
		});
		const progress = duration <= 0 ? 1 : Math.min(localTime / duration, 1);
		const renderState = resolveZoomRenderState({
			effectParams,
			progress,
			duration,
		});

		if (
			Math.abs(renderState.tiltX) <= 0.0001 &&
			Math.abs(renderState.tiltY) <= 0.0001 &&
			Math.abs(renderState.rotationX) <= 0.0001 &&
			renderState.perspective <= 0.0001
		) {
			continue;
		}

		resolvedState = {
			tiltX: renderState.tiltX,
			tiltY: renderState.tiltY,
			rotationX: renderState.rotationX,
			perspective: renderState.perspective,
			strength: renderState.strength,
		};
	}

	return resolvedState;
}

function resolveTiltAwareFrameStyle({
	frameStyle,
	zoomFrameState,
}: {
	frameStyle: Required<VideoFrameStyle>;
	zoomFrameState:
		| {
				tiltX: number;
				tiltY: number;
				rotationX: number;
				perspective: number;
				strength: number;
		  }
		| undefined;
}): Required<VideoFrameStyle> {
	if (!zoomFrameState) {
		return frameStyle;
	}

	const tiltAmount =
		Math.max(Math.abs(zoomFrameState.tiltX), Math.abs(zoomFrameState.tiltY)) *
		zoomFrameState.strength;
	const rotationAmount =
		(Math.abs(zoomFrameState.rotationX) / 25) * zoomFrameState.strength;
	const perspectiveAmount = zoomFrameState.perspective * zoomFrameState.strength;
	const radiusScale = 1 - perspectiveAmount * 0.2 - tiltAmount * 0.12;
	const shadowLift = 1 + perspectiveAmount * 0.45 + tiltAmount * 0.25;
	const directionalOffsetX =
		zoomFrameState.tiltY * perspectiveAmount * 6 + zoomFrameState.tiltX * 4;
	const directionalOffsetY =
		Math.sign(zoomFrameState.tiltY || 1) *
			(tiltAmount * (8 + perspectiveAmount * 14) + rotationAmount * 3) +
		zoomFrameState.rotationX * 0.12;

	return {
		...frameStyle,
		cornerRadius: clampNumber({
			value: frameStyle.cornerRadius * radiusScale,
			min: 0,
			max: 100,
		}),
		shadowBlur: Math.max(0, frameStyle.shadowBlur * shadowLift),
		shadowOffsetX: frameStyle.shadowOffsetX + directionalOffsetX,
		shadowOffsetY: frameStyle.shadowOffsetY + directionalOffsetY,
		shadowOpacity: clampNumber({
			value:
				frameStyle.shadowOpacity + perspectiveAmount * 18 + tiltAmount * 10,
			min: 0,
			max: 100,
		}),
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

function drawFrameShape({
	context,
	width,
	height,
	cornerRadius,
}: {
	context: RenderableContext;
	width: number;
	height: number;
	cornerRadius: number;
}): void {
	context.beginPath();
	if (cornerRadius <= 0) {
		context.rect(0, 0, width, height);
		return;
	}

	const percent = Math.min(Math.max(cornerRadius, 0), 100) / 100;
	const radius = Math.min(width, height) * 0.5 * percent;
	context.roundRect(0, 0, width, height, radius);
}

function drawStaticFrameShadow({
	context,
	x,
	y,
	width,
	height,
	cornerRadius,
	shadowBlur,
	shadowOffsetX,
	shadowOffsetY,
	shadowColor,
}: {
	context: RenderableContext;
	x: number;
	y: number;
	width: number;
	height: number;
	cornerRadius: number;
	shadowBlur: number;
	shadowOffsetX: number;
	shadowOffsetY: number;
	shadowColor: string;
}): void {
	const shadowCanvasWidth = Math.max(1, Math.ceil(width));
	const shadowCanvasHeight = Math.max(1, Math.ceil(height));
	const shadowCanvas = createOffscreenCanvas({
		width: shadowCanvasWidth,
		height: shadowCanvasHeight,
	});
	const shadowCtx = shadowCanvas.getContext("2d") as RenderableContext | null;
	if (!shadowCtx) {
		return;
	}

	shadowCtx.fillStyle = "#000";
	drawFrameShape({
		context: shadowCtx,
		width: shadowCanvasWidth,
		height: shadowCanvasHeight,
		cornerRadius,
	});
	shadowCtx.fill();

	context.save();
	context.shadowColor = shadowColor;
	context.shadowBlur = shadowBlur;
	context.shadowOffsetX = shadowOffsetX;
	context.shadowOffsetY = shadowOffsetY;
	context.drawImage(
		shadowCanvas,
		x,
		y,
		width,
		height,
	);
	context.restore();
}

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	playbackRate?: number;
	freezeFrameStart?: number;
	freezeFrameEnd?: number;
	transform: Transform;
	animations?: ElementAnimations;
	keyframeEasing?: MediaKeyframeEasing;
	opacity: number;
	blendMode?: BlendMode;
	frameStyle?: VideoFrameStyle;
	effects?: Effect[];
	recordedCursor?: RecordedCursorData;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
> extends BaseNode<Params> {
	protected getSourceLocalTime({ time }: { time: number }): number {
		if (
			typeof this.params.freezeFrameStart === "number" ||
			typeof this.params.freezeFrameEnd === "number"
		) {
			return getClampedVideoSourceTimeFromTimelineTime({
				timelineTime: time,
				startTime: this.params.timeOffset,
				trimStart: this.params.trimStart,
				duration: this.params.duration,
				playbackRate: this.params.playbackRate,
				freezeFrameStart: this.params.freezeFrameStart,
				freezeFrameEnd: this.params.freezeFrameEnd,
			});
		}

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
		const timelineLocalTime = time - this.params.timeOffset;
		const freezeFrameStart = this.params.freezeFrameStart ?? 0;
		const freezeFrameEnd = this.params.freezeFrameEnd ?? 0;
		const visibleTimelineDuration = getVisibleTimelineDuration({
			duration: this.params.duration,
			freezeFrameStart,
			freezeFrameEnd,
		});
		return (
			timelineLocalTime >= -TIME_EPSILON_SECONDS &&
			timelineLocalTime <
				freezeFrameStart +
					visibleTimelineDuration +
					freezeFrameEnd +
					TIME_EPSILON_SECONDS
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
		const sourceLocalTime = this.getSourceLocalTime({ time: timelineTime });
		const transform = resolveTransformAtTime({
			baseTransform: this.params.transform,
			animations: this.params.animations,
			localTime: animationLocalTime,
			keyframeEasing: this.params.keyframeEasing,
		});
		const opacity = resolveOpacityAtTime({
			baseOpacity: this.params.opacity,
			animations: this.params.animations,
			localTime: animationLocalTime,
			keyframeEasing: this.params.keyframeEasing,
		});
		const containScale = Math.min(
			renderer.width / sourceWidth,
			renderer.height / sourceHeight,
		);
		const scaledWidth = sourceWidth * containScale * transform.scale;
		const scaledHeight = sourceHeight * containScale * transform.scale;
		const pixelWidth = Math.max(
			1,
			Math.round(scaledWidth * renderer.renderScale),
		);
		const pixelHeight = Math.max(
			1,
			Math.round(scaledHeight * renderer.renderScale),
		);
		const x = renderer.width / 2 + transform.position.x - scaledWidth / 2;
		const y = renderer.height / 2 + transform.position.y - scaledHeight / 2;
		const enabledEffects =
			this.params.effects?.filter((effect) => effect.enabled) ?? [];
		const baseFrameStyle = resolveFrameStyle(this.params.frameStyle);
		const zoomFrameState = resolveZoomFrameStyleState({
			effects: enabledEffects,
			animations: this.params.animations,
			localTime: animationLocalTime,
			duration: this.params.duration,
		});
		const frameStyle = resolveTiltAwareFrameStyle({
			frameStyle: baseFrameStyle,
			zoomFrameState,
		});
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
		let hasKeepFrameFixedZoom = false;
		const appliedZoomEffects: AppliedZoomEffect[] = [];

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
				((effect.type === "zoom" && keepFrameFixed) ||
					effect.type === "custom-cursor");

			if (shouldSkipEffectForBackgroundBlur) {
				continue;
			}

			if (effect.type === "zoom" && keepFrameFixed) {
				hasKeepFrameFixedZoom = true;
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

			if (effect.type === "custom-cursor") {
				currentResult = applyCustomCursorEffect({
					source: currentResult,
					width: pixelWidth,
					height: pixelHeight,
					sourceTime: sourceLocalTime,
					effectParams: resolvedParams,
					recordedCursor: this.params.recordedCursor,
					zoomEffects: appliedZoomEffects,
				});
				continue;
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

			if (effect.type === "zoom") {
				appliedZoomEffects.push({
					effectParams: resolvedParams,
					progress,
					duration: this.params.duration,
				});
			}
		}

		const finalResult = hasAppliedRoundedMask
			? currentResult
			: applyRoundedMask({
					source: currentResult,
					width: pixelWidth,
					height: pixelHeight,
					cornerRadius: frameStyle.cornerRadius,
				});

		if (hasKeepFrameFixedZoom) {
			if (hasShadow) {
				drawStaticFrameShadow({
					context: renderer.context,
					x,
					y,
					width: scaledWidth,
					height: scaledHeight,
					cornerRadius: frameStyle.cornerRadius,
					shadowBlur: frameStyle.shadowBlur,
					shadowOffsetX: frameStyle.shadowOffsetX,
					shadowOffsetY: frameStyle.shadowOffsetY,
					shadowColor: colorWithOpacity({
						color: frameStyle.shadowColor,
						opacity: frameStyle.shadowOpacity,
					}),
				});
			}

			renderer.context.save();
			renderer.context.translate(x, y);
			drawFrameShape({
				context: renderer.context,
				width: scaledWidth,
				height: scaledHeight,
				cornerRadius: frameStyle.cornerRadius,
			});
			renderer.context.clip();
			renderer.context.drawImage(currentResult, 0, 0, scaledWidth, scaledHeight);
			renderer.context.restore();
			renderer.context.restore();
			return;
		}

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
