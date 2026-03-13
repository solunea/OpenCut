import type { CanvasRenderer } from "../canvas-renderer";
import { createOffscreenCanvas } from "../canvas-utils";
import { BaseNode } from "./base-node";
import type { TextElement, Transform } from "@/types/timeline";
import {
	DEFAULT_TEXT_BACKGROUND,
	DEFAULT_TEXT_ELEMENT,
	DEFAULT_LINE_HEIGHT,
	FONT_SIZE_SCALE_REFERENCE,
	CORNER_RADIUS_MAX,
	CORNER_RADIUS_MIN,
} from "@/constants/text-constants";
import {
	getMetricAscent,
	getMetricDescent,
	getTextBackgroundRect,
	measureTextBlock,
} from "@/lib/text/layout";
import {
	getElementLocalTime,
	resolveColorAtTime,
	resolveNumberAtTime,
	resolveOpacityAtTime,
	resolveTransformAtTime,
} from "@/lib/animation";
import { resolveTextAnimationState } from "@/lib/text/animation";
import { resolveEffectParamsAtTime } from "@/lib/animation/effect-param-channel";
import { applyRendererEffect } from "../effect-applier";
import { clamp } from "@/utils/math";

function scaleFontSize({
	fontSize,
	canvasHeight,
}: {
	fontSize: number;
	canvasHeight: number;
}): number {
	return fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
}

function quoteFontFamily({ fontFamily }: { fontFamily: string }): string {
	return `"${fontFamily.replace(/"/g, '\\"')}"`;
}

function splitLineIntoSegments({
	line,
	granularity,
}: {
	line: string;
	granularity: "whole" | "word" | "character";
}): string[] {
	if (granularity === "whole") {
		return [line];
	}

	if (granularity === "word") {
		const segments = line.match(/\S+|\s+/g);
		return segments && segments.length > 0 ? segments : [line];
	}

	return Array.from(line);
}

function getLineStartX({
	textAlign,
	lineWidth,
}: {
	textAlign: CanvasTextAlign;
	lineWidth: number;
}): number {
	if (textAlign === "left") return 0;
	if (textAlign === "right") return -lineWidth;
	return -lineWidth / 2;
}

function getAnimatedSegmentCount({
	lines,
	granularity,
}: {
	lines: string[];
	granularity: "whole" | "word" | "character";
}): number {
	if (granularity === "whole") {
		return lines.length > 0 ? 1 : 0;
	}

	let count = 0;
	for (const line of lines) {
		for (const segment of splitLineIntoSegments({ line, granularity })) {
			if (/\S/.test(segment)) {
				count += 1;
			}
		}
	}

	return count;
}

const IDENTITY_TRANSFORM: Transform = {
	scale: 1,
	position: { x: 0, y: 0 },
	rotate: 0,
};

const TEXT_DECORATION_THICKNESS_RATIO = 0.07;
const STRIKETHROUGH_VERTICAL_RATIO = 0.35;

function drawTextDecoration({
	ctx,
	textDecoration,
	lineWidth,
	lineY,
	metrics,
	scaledFontSize,
	textAlign,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	textDecoration: string;
	lineWidth: number;
	lineY: number;
	metrics: TextMetrics;
	scaledFontSize: number;
	textAlign: CanvasTextAlign;
}): void {
	if (textDecoration === "none" || !textDecoration) return;

	const thickness = Math.max(1, scaledFontSize * TEXT_DECORATION_THICKNESS_RATIO);
	const ascent = getMetricAscent({ metrics, fallbackFontSize: scaledFontSize });
	const descent = getMetricDescent({ metrics, fallbackFontSize: scaledFontSize });

	let xStart = -lineWidth / 2;
	if (textAlign === "left") xStart = 0;
	if (textAlign === "right") xStart = -lineWidth;

	if (textDecoration === "underline") {
		const underlineY = lineY + descent + thickness;
		ctx.fillRect(xStart, underlineY, lineWidth, thickness);
	}

	if (textDecoration === "line-through") {
		const strikeY = lineY - (ascent - descent) * STRIKETHROUGH_VERTICAL_RATIO;
		ctx.fillRect(xStart, strikeY, lineWidth, thickness);
	}
}

export type TextNodeParams = TextElement & {
	canvasCenter: { x: number; y: number };
	canvasHeight: number;
	textBaseline?: CanvasTextBaseline;
};

export class TextNode extends BaseNode<TextNodeParams> {
	isInRange({ time }: { time: number }) {
		return (
			time >= this.params.startTime &&
			time < this.params.startTime + this.params.duration
		);
	}

	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		if (!this.isInRange({ time })) {
			return;
		}

		const localTime = getElementLocalTime({
			timelineTime: time,
			elementStartTime: this.params.startTime,
			elementDuration: this.params.duration,
		});
		const transform = resolveTransformAtTime({
			baseTransform: this.params.transform,
			animations: this.params.animations,
			localTime,
		});
		const opacity = resolveOpacityAtTime({
			baseOpacity: this.params.opacity,
			animations: this.params.animations,
			localTime,
		});

		const textAnimationState = resolveTextAnimationState({
			textAnimation: this.params.textAnimation,
			transform,
			localTime,
			duration: this.params.duration,
		});

		const fontWeight = this.params.fontWeight === "bold" ? "bold" : "normal";
		const fontStyle = this.params.fontStyle === "italic" ? "italic" : "normal";
		const scaledFontSize = scaleFontSize({
			fontSize: this.params.fontSize,
			canvasHeight: this.params.canvasHeight,
		});
		const fontFamily = quoteFontFamily({ fontFamily: this.params.fontFamily });
		const fontString = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}, sans-serif`;
		const letterSpacing = this.params.letterSpacing ?? 0;
		const lineHeight = this.params.lineHeight ?? DEFAULT_LINE_HEIGHT;
		const lines = this.params.content.split("\n");
		const lineHeightPx = scaledFontSize * lineHeight;
		const fontSizeRatio = this.params.fontSize / DEFAULT_TEXT_ELEMENT.fontSize;
		const baseline = this.params.textBaseline ?? "middle";
		const blendMode = (
			this.params.blendMode && this.params.blendMode !== "normal"
				? this.params.blendMode
				: "source-over"
		) as GlobalCompositeOperation;

		const granularity = this.params.textAnimation?.granularity ?? "whole";
		const isSegmentedAnimation = granularity !== "whole";
		const stagger = this.params.textAnimation?.stagger ?? 0;
		const animatedSegmentCount = getAnimatedSegmentCount({
			lines,
			granularity,
		});
		const maxSegmentDelay = Math.max(0, animatedSegmentCount - 1) * stagger;
		const renderedTransform = isSegmentedAnimation
			? transform
			: textAnimationState.transform;
		const renderedOpacity = isSegmentedAnimation
			? opacity
			: opacity * textAnimationState.opacityMultiplier;
		const x = renderedTransform.position.x + this.params.canvasCenter.x;
		const y = renderedTransform.position.y + this.params.canvasCenter.y;

		renderer.context.save();
		renderer.context.font = fontString;
		renderer.context.textBaseline = baseline;
		if ("letterSpacing" in renderer.context) {
			(renderer.context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
		}
		const lineMetrics = lines.map((line) => renderer.context.measureText(line));
		renderer.context.restore();

		const lineCount = lines.length;
		const block = measureTextBlock({ lineMetrics, lineHeightPx, fallbackFontSize: scaledFontSize });

		const textColor = resolveColorAtTime({
			baseColor: this.params.color,
			animations: this.params.animations,
			propertyPath: "color",
			localTime,
		});
		const bg = this.params.background;
		const resolvedBackground = {
			...bg,
			color: resolveColorAtTime({
				baseColor: bg.color,
				animations: this.params.animations,
				propertyPath: "background.color",
				localTime,
			}),
			paddingX: resolveNumberAtTime({
				baseValue: bg.paddingX ?? DEFAULT_TEXT_BACKGROUND.paddingX,
				animations: this.params.animations,
				propertyPath: "background.paddingX",
				localTime,
			}),
			paddingY: resolveNumberAtTime({
				baseValue: bg.paddingY ?? DEFAULT_TEXT_BACKGROUND.paddingY,
				animations: this.params.animations,
				propertyPath: "background.paddingY",
				localTime,
			}),
			offsetX: resolveNumberAtTime({
				baseValue: bg.offsetX ?? DEFAULT_TEXT_BACKGROUND.offsetX,
				animations: this.params.animations,
				propertyPath: "background.offsetX",
				localTime,
			}),
			offsetY: resolveNumberAtTime({
				baseValue: bg.offsetY ?? DEFAULT_TEXT_BACKGROUND.offsetY,
				animations: this.params.animations,
				propertyPath: "background.offsetY",
				localTime,
			}),
			cornerRadius: resolveNumberAtTime({
				baseValue: bg.cornerRadius ?? CORNER_RADIUS_MIN,
				animations: this.params.animations,
				propertyPath: "background.cornerRadius",
				localTime,
			}),
		};

		const drawContent = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
			ctx.font = fontString;
			ctx.textAlign = this.params.textAlign;
			ctx.textBaseline = baseline;
			ctx.fillStyle = textColor;
			if ("letterSpacing" in ctx) {
				(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
			}

			if (
				this.params.background.enabled &&
				this.params.background.color &&
				this.params.background.color !== "transparent" &&
				lineCount > 0
			) {
				const backgroundRect = getTextBackgroundRect({
					textAlign: this.params.textAlign,
					block,
					background: resolvedBackground,
					fontSizeRatio,
				});
				if (backgroundRect) {
					const p = clamp({ value: resolvedBackground.cornerRadius, min: CORNER_RADIUS_MIN, max: CORNER_RADIUS_MAX }) / 100;
					const radius = Math.min(backgroundRect.width, backgroundRect.height) / 2 * p;
					ctx.fillStyle = resolvedBackground.color;
					ctx.beginPath();
					ctx.roundRect(backgroundRect.left, backgroundRect.top, backgroundRect.width, backgroundRect.height, radius);
					ctx.fill();
					ctx.fillStyle = textColor;
				}
			}

			if (granularity === "whole") {
				ctx.filter =
					textAnimationState.blurPx > 0 ? `blur(${textAnimationState.blurPx}px)` : "none";

				for (let i = 0; i < lineCount; i++) {
					const lineY = i * lineHeightPx - block.visualCenterOffset;
					ctx.fillText(lines[i], 0, lineY);
					drawTextDecoration({
						ctx,
						textDecoration: this.params.textDecoration ?? "none",
						lineWidth: lineMetrics[i].width,
						lineY,
						metrics: lineMetrics[i],
						scaledFontSize,
						textAlign: this.params.textAlign,
					});
				}

				return;
			}

			let animatedSegmentIndex = 0;

			for (let i = 0; i < lineCount; i++) {
				const lineY = i * lineHeightPx - block.visualCenterOffset;
				const segments = splitLineIntoSegments({
					line: lines[i],
					granularity,
				});
				let cursorX = getLineStartX({
					textAlign: this.params.textAlign,
					lineWidth: lineMetrics[i].width,
				});

				for (const segment of segments) {
					const segmentWidth = ctx.measureText(segment).width;
					const shouldAnimateSegment = /\S/.test(segment);
					const segmentDelay = shouldAnimateSegment
						? animatedSegmentIndex * stagger
						: Math.max(0, animatedSegmentIndex - 1) * stagger;
					const segmentState = resolveTextAnimationState({
						textAnimation: this.params.textAnimation,
						transform: IDENTITY_TRANSFORM,
						localTime,
						duration: this.params.duration,
						segmentDelay,
						maxSegmentDelay,
					});

					ctx.save();
					ctx.translate(
						cursorX + segmentState.transform.position.x,
						lineY + segmentState.transform.position.y,
					);
					ctx.scale(segmentState.transform.scale, segmentState.transform.scale);
					if (segmentState.transform.rotate) {
						ctx.rotate((segmentState.transform.rotate * Math.PI) / 180);
					}
					ctx.filter =
						segmentState.blurPx > 0 ? `blur(${segmentState.blurPx}px)` : "none";
					ctx.globalAlpha = segmentState.opacityMultiplier;
					ctx.textAlign = "left";
					ctx.fillText(segment, 0, 0);
					ctx.restore();

					cursorX += segmentWidth;
					if (shouldAnimateSegment) {
						animatedSegmentIndex += 1;
					}
				}

				drawTextDecoration({
					ctx,
					textDecoration: this.params.textDecoration ?? "none",
					lineWidth: lineMetrics[i].width,
					lineY,
					metrics: lineMetrics[i],
					scaledFontSize,
					textAlign: this.params.textAlign,
				});
			}
		};

		const applyTransform = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
			ctx.translate(x, y);
			ctx.scale(renderedTransform.scale, renderedTransform.scale);
			if (renderedTransform.rotate) {
				ctx.rotate((renderedTransform.rotate * Math.PI) / 180);
			}
		};

		const enabledEffects = this.params.effects?.filter((effect) => effect.enabled) ?? [];

		if (enabledEffects.length === 0) {
			renderer.context.save();
			applyTransform(renderer.context);
			renderer.context.globalCompositeOperation = blendMode;
			renderer.context.globalAlpha = renderedOpacity;
			drawContent(renderer.context);
			renderer.context.restore();
			return;
		}

		// Effects path: render text to a same-size offscreen canvas so the blur
		// can spread into the surrounding transparent area without hard clipping.
		const offscreen = createOffscreenCanvas({ width: renderer.width, height: renderer.height });
		const offscreenCtx = offscreen.getContext("2d") as OffscreenCanvasRenderingContext2D | null;

		if (!offscreenCtx) {
			renderer.context.save();
			applyTransform(renderer.context);
			renderer.context.globalCompositeOperation = blendMode;
			renderer.context.globalAlpha = renderedOpacity;
			drawContent(renderer.context);
			renderer.context.restore();
			return;
		}

		offscreenCtx.save();
		applyTransform(offscreenCtx);
		drawContent(offscreenCtx);
		offscreenCtx.restore();

		let currentSource: CanvasImageSource = offscreen;
		for (const effect of enabledEffects) {
			const resolvedParams = resolveEffectParamsAtTime({
				effect,
				animations: this.params.animations,
				localTime,
			});
			const progress =
				this.params.duration <= 0 ? 1 : Math.min(localTime / this.params.duration, 1);
			currentSource = applyRendererEffect({
				source: currentSource,
				width: renderer.width,
				height: renderer.height,
				effectType: effect.type,
				effectParams: resolvedParams,
				localTime,
				duration: this.params.duration,
				progress,
			});
		}

		renderer.context.save();
		renderer.context.globalCompositeOperation = blendMode;
		renderer.context.globalAlpha = renderedOpacity;
		renderer.context.drawImage(currentSource, 0, 0);
		renderer.context.restore();
	}
}
