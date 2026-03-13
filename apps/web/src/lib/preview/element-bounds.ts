import type { TimelineTrack, TimelineElement } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import { isMainTrack } from "@/lib/timeline";
import {
	DEFAULT_TEXT_ELEMENT,
	DEFAULT_LINE_HEIGHT,
	DEFAULT_TEXT_BACKGROUND,
	FONT_SIZE_SCALE_REFERENCE,
} from "@/constants/text-constants";
import {
	getMetricAscent,
	getMetricDescent,
	getTextBackgroundRect,
	getTextVisualRect,
	measureTextBlock,
} from "@/lib/text/layout";
import {
	getElementLocalTime,
	resolveTransformAtTime,
	resolveNumberAtTime,
} from "@/lib/animation";
import { resolveTextAnimationState } from "@/lib/text/animation";

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

function getTransformedRectBounds({
	left,
	top,
	width,
	height,
	transform,
}: {
	left: number;
	top: number;
	width: number;
	height: number;
	transform: {
		scale: number;
		position: { x: number; y: number };
		rotate: number;
	};
}) {
	const right = left + width;
	const bottom = top + height;
	const rotationRad = (transform.rotate * Math.PI) / 180;
	const cos = Math.cos(rotationRad);
	const sin = Math.sin(rotationRad);
	const corners = [
		{ x: left, y: top },
		{ x: right, y: top },
		{ x: right, y: bottom },
		{ x: left, y: bottom },
	].map((point) => {
		const scaledX = point.x * transform.scale;
		const scaledY = point.y * transform.scale;
		return {
			x: transform.position.x + scaledX * cos - scaledY * sin,
			y: transform.position.y + scaledX * sin + scaledY * cos,
		};
	});

	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);

	return {
		left: Math.min(...xs),
		top: Math.min(...ys),
		right: Math.max(...xs),
		bottom: Math.max(...ys),
	};
}

export interface ElementBounds {
	cx: number;
	cy: number;
	width: number;
	height: number;
	rotation: number;
}

export interface ElementWithBounds {
	trackId: string;
	elementId: string;
	element: TimelineElement;
	bounds: ElementBounds;
}

function getVisualElementBounds({
	canvasWidth,
	canvasHeight,
	sourceWidth,
	sourceHeight,
	transform,
}: {
	canvasWidth: number;
	canvasHeight: number;
	sourceWidth: number;
	sourceHeight: number;
	transform: {
		scale: number;
		position: { x: number; y: number };
		rotate: number;
	};
}): ElementBounds {
	const containScale = Math.min(
		canvasWidth / sourceWidth,
		canvasHeight / sourceHeight,
	);
	const scaledWidth = sourceWidth * containScale * transform.scale;
	const scaledHeight = sourceHeight * containScale * transform.scale;
	const cx = canvasWidth / 2 + transform.position.x;
	const cy = canvasHeight / 2 + transform.position.y;

	return {
		cx,
		cy,
		width: scaledWidth,
		height: scaledHeight,
		rotation: transform.rotate,
	};
}

export function getElementBounds({
	element,
	canvasSize,
	mediaAsset,
	localTime,
}: {
	element: TimelineElement;
	canvasSize: { width: number; height: number };
	mediaAsset?: MediaAsset | null;
	localTime: number;
}): ElementBounds | null {
	if (element.type === "audio" || element.type === "effect") return null;
	if ("hidden" in element && element.hidden) return null;

	const { width: canvasWidth, height: canvasHeight } = canvasSize;

	if (element.type === "video" || element.type === "image") {
		const transform = resolveTransformAtTime({
			baseTransform: element.transform,
			animations: element.animations,
			localTime,
		});
		const sourceWidth = mediaAsset?.width ?? canvasWidth;
		const sourceHeight = mediaAsset?.height ?? canvasHeight;
		return getVisualElementBounds({
			canvasWidth,
			canvasHeight,
			sourceWidth,
			sourceHeight,
			transform,
		});
	}

	if (element.type === "sticker") {
		const transform = resolveTransformAtTime({
			baseTransform: element.transform,
			animations: element.animations,
			localTime,
		});
		return getVisualElementBounds({
			canvasWidth,
			canvasHeight,
			sourceWidth: 200,
			sourceHeight: 200,
			transform,
		});
	}

	if (element.type === "text") {
		const transform = resolveTransformAtTime({
			baseTransform: element.transform,
			animations: element.animations,
			localTime,
		});
		const textAnimationState = resolveTextAnimationState({
			textAnimation: element.textAnimation,
			transform,
			localTime,
			duration: element.duration,
		});
		const animatedTransform = textAnimationState.transform;
		const scaledFontSize =
			element.fontSize * (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
		const letterSpacing = element.letterSpacing ?? 0;
		const lineHeight = element.lineHeight ?? DEFAULT_LINE_HEIGHT;
		const lineHeightPx = scaledFontSize * lineHeight;
		const granularity = element.textAnimation?.granularity ?? "whole";
		const isSegmentedAnimation = granularity !== "whole";
		const stagger = element.textAnimation?.stagger ?? 0;
		const renderedTransform = isSegmentedAnimation
			? transform
			: textAnimationState.transform;

		let measuredWidth = 100;
		let measuredHeight = scaledFontSize;

		const canvas = document.createElement("canvas");
		canvas.width = 4096;
		canvas.height = 4096;
		const ctx = canvas.getContext("2d");

		if (ctx) {
			const fontWeight = element.fontWeight === "bold" ? "bold" : "normal";
			const fontStyle = element.fontStyle === "italic" ? "italic" : "normal";
			const fontFamily = `"${element.fontFamily.replace(/"/g, '\\"')}"`;
			ctx.font = `${fontStyle} ${fontWeight} ${scaledFontSize}px ${fontFamily}, sans-serif`;
			ctx.textAlign = element.textAlign as CanvasTextAlign;
			if ("letterSpacing" in ctx) {
				(
					ctx as CanvasRenderingContext2D & { letterSpacing: string }
				).letterSpacing = `${letterSpacing}px`;
			}

			const lines = element.content.split("\n");
			const lineMetrics = lines.map((line) => ctx.measureText(line));
			const block = measureTextBlock({
				lineMetrics,
				lineHeightPx,
				fallbackFontSize: scaledFontSize,
			});
			const fontSizeRatio = element.fontSize / DEFAULT_TEXT_ELEMENT.fontSize;
			const resolvedBackground = {
				...element.background,
				paddingX: resolveNumberAtTime({
					baseValue:
						element.background.paddingX ?? DEFAULT_TEXT_BACKGROUND.paddingX,
					animations: element.animations,
					propertyPath: "background.paddingX",
					localTime,
				}),
				paddingY: resolveNumberAtTime({
					baseValue:
						element.background.paddingY ?? DEFAULT_TEXT_BACKGROUND.paddingY,
					animations: element.animations,
					propertyPath: "background.paddingY",
					localTime,
				}),
				offsetX: resolveNumberAtTime({
					baseValue:
						element.background.offsetX ?? DEFAULT_TEXT_BACKGROUND.offsetX,
					animations: element.animations,
					propertyPath: "background.offsetX",
					localTime,
				}),
				offsetY: resolveNumberAtTime({
					baseValue:
						element.background.offsetY ?? DEFAULT_TEXT_BACKGROUND.offsetY,
					animations: element.animations,
					propertyPath: "background.offsetY",
					localTime,
				}),
			};
			const visualRect = getTextVisualRect({
				textAlign: element.textAlign,
				block,
				background: resolvedBackground,
				fontSizeRatio,
			});
			measuredWidth = visualRect.width;
			measuredHeight = visualRect.height;

			let localBounds = {
				left: visualRect.left,
				top: visualRect.top,
				right: visualRect.left + visualRect.width,
				bottom: visualRect.top + visualRect.height,
			};

			if (granularity !== "whole") {
				const backgroundRect = getTextBackgroundRect({
					textAlign: element.textAlign,
					block,
					background: resolvedBackground,
					fontSizeRatio,
				});
				let animatedSegmentIndex = 0;
				let hasSegmentBounds = false;
				let segmentUnion = {
					left: Number.POSITIVE_INFINITY,
					top: Number.POSITIVE_INFINITY,
					right: Number.NEGATIVE_INFINITY,
					bottom: Number.NEGATIVE_INFINITY,
				};

				for (let index = 0; index < lines.length; index++) {
					const lineY = index * lineHeightPx - block.visualCenterOffset;
					const segments = splitLineIntoSegments({
						line: lines[index],
						granularity,
					});
					let cursorX = getLineStartX({
						textAlign: element.textAlign,
						lineWidth: lineMetrics[index].width,
					});

					for (const segment of segments) {
						const metrics = ctx.measureText(segment);
						const shouldAnimateSegment = /\S/.test(segment);
						const segmentDelay = shouldAnimateSegment
							? animatedSegmentIndex * stagger
							: Math.max(0, animatedSegmentIndex - 1) * stagger;
						const segmentState = resolveTextAnimationState({
							textAnimation: element.textAnimation,
							transform: {
								scale: 1,
								position: { x: 0, y: 0 },
								rotate: 0,
							},
							localTime,
							duration: element.duration,
							segmentDelay,
						});
						const ascent = getMetricAscent({
							metrics,
							fallbackFontSize: scaledFontSize,
						});
						const descent = getMetricDescent({
							metrics,
							fallbackFontSize: scaledFontSize,
						});
						const blurPx = segmentState.blurPx;
						const transformedRect = getTransformedRectBounds({
							left: -blurPx,
							top: -ascent - blurPx,
							width: metrics.width + blurPx * 2,
							height: ascent + descent + blurPx * 2,
							transform: {
								scale: segmentState.transform.scale,
								position: {
									x: cursorX + segmentState.transform.position.x,
									y: lineY + segmentState.transform.position.y,
								},
								rotate: segmentState.transform.rotate,
							},
						});

						hasSegmentBounds = true;
						segmentUnion = {
							left: Math.min(segmentUnion.left, transformedRect.left),
							top: Math.min(segmentUnion.top, transformedRect.top),
							right: Math.max(segmentUnion.right, transformedRect.right),
							bottom: Math.max(segmentUnion.bottom, transformedRect.bottom),
						};

						cursorX += metrics.width;
						if (shouldAnimateSegment) {
							animatedSegmentIndex += 1;
						}
					}
				}

				if (backgroundRect) {
					segmentUnion = {
						left: Math.min(segmentUnion.left, backgroundRect.left),
						top: Math.min(segmentUnion.top, backgroundRect.top),
						right: Math.max(
							segmentUnion.right,
							backgroundRect.left + backgroundRect.width,
						),
						bottom: Math.max(
							segmentUnion.bottom,
							backgroundRect.top + backgroundRect.height,
						),
					};
					hasSegmentBounds = true;
				}

				if (hasSegmentBounds) {
					localBounds = segmentUnion;
				}
			}

			const transformedBounds = getTransformedRectBounds({
				left: localBounds.left,
				top: localBounds.top,
				width: localBounds.right - localBounds.left,
				height: localBounds.bottom - localBounds.top,
				transform: {
					scale: renderedTransform.scale,
					position: {
						x: canvasWidth / 2 + renderedTransform.position.x,
						y: canvasHeight / 2 + renderedTransform.position.y,
					},
					rotate: renderedTransform.rotate,
				},
			});

			return {
				cx: (transformedBounds.left + transformedBounds.right) / 2,
				cy: (transformedBounds.top + transformedBounds.bottom) / 2,
				width: transformedBounds.right - transformedBounds.left,
				height: transformedBounds.bottom - transformedBounds.top,
				rotation: 0,
			};
		}

		const width = measuredWidth * animatedTransform.scale;
		const height = measuredHeight * animatedTransform.scale;
		return {
			cx: canvasWidth / 2 + renderedTransform.position.x,
			cy: canvasHeight / 2 + renderedTransform.position.y,
			width,
			height,
			rotation: renderedTransform.rotate,
		};
	}

	return null;
}

export function getVisibleElementsWithBounds({
	tracks,
	currentTime,
	canvasSize,
	mediaAssets,
}: {
	tracks: TimelineTrack[];
	currentTime: number;
	canvasSize: { width: number; height: number };
	mediaAssets: MediaAsset[];
}): ElementWithBounds[] {
	const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));
	const visibleTracks = tracks.filter(
		(track) => !("hidden" in track && track.hidden),
	);
	const orderedTracks = [
		...visibleTracks.filter((track) => !isMainTrack(track)),
		...visibleTracks.filter((track) => isMainTrack(track)),
	].reverse();

	const result: ElementWithBounds[] = [];

	for (const track of orderedTracks) {
		const elements = track.elements
			.filter((element) => !("hidden" in element && element.hidden))
			.filter(
				(element) =>
					currentTime >= element.startTime &&
					currentTime < element.startTime + element.duration,
			)
			.slice()
			.sort((a, b) => {
				if (a.startTime !== b.startTime) return a.startTime - b.startTime;
				return a.id.localeCompare(b.id);
			});

		for (const element of elements) {
			const localTime = getElementLocalTime({
				timelineTime: currentTime,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});
			const mediaAsset =
				element.type === "video" || element.type === "image"
					? mediaMap.get(element.mediaId)
					: undefined;
			const bounds = getElementBounds({
				element,
				canvasSize,
				mediaAsset,
				localTime,
			});
			if (bounds) {
				result.push({
					trackId: track.id,
					elementId: element.id,
					element,
					bounds,
				});
			}
		}
	}

	return result;
}
