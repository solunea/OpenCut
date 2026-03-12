import type { ZoomEffectTransition, ZoomTransitionState } from "@/types/effects";
import type { EffectElement, TimelineElement, TimelineTrack } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import { RootNode } from "./nodes/root-node";
import { VideoNode } from "./nodes/video-node";
import { ImageNode } from "./nodes/image-node";
import { LottieNode } from "./nodes/lottie-node";
import { BackgroundImageNode } from "./nodes/background-image-node";
import { TextNode } from "./nodes/text-node";
import { StickerNode } from "./nodes/sticker-node";
import { ColorNode } from "./nodes/color-node";
import { CompositeEffectNode } from "./nodes/composite-effect-node";
import { EffectLayerNode } from "./nodes/effect-layer-node";
import type { BaseNode } from "./nodes/base-node";
import type { TBackground, TCanvasSize } from "@/types/project";
import { DEFAULT_BLUR_INTENSITY } from "@/constants/project-constants";
import { isMainTrack } from "@/lib/timeline";

const PREVIEW_MAX_IMAGE_SIZE = 2048;
const BLUR_BACKGROUND_ZOOM_SCALE = 1.4;
const EFFECT_TIME_EPSILON = 1e-6;

function getVisibleSortedElements({
	track,
}: {
	track: TimelineTrack;
}) {
	return track.elements
		.filter((element) => !("hidden" in element && element.hidden))
		.slice()
		.sort((a, b) => {
			if (a.startTime !== b.startTime) return a.startTime - b.startTime;
			return a.id.localeCompare(b.id);
		});
}

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

function resolveZoomTransitionState({
	element,
}: {
	element: EffectElement;
}): ZoomTransitionState {
	return {
		zoom: Math.max(resolveNumber({ value: element.params.zoom, fallback: 1.35 }), 1),
		focusX: clamp01(resolveNumber({ value: element.params.focusX, fallback: 50 }) / 100),
		focusY: clamp01(resolveNumber({ value: element.params.focusY, fallback: 50 }) / 100),
		keepFrameFixed: resolveBoolean({
			value: element.params.keepFrameFixed,
			fallback: true,
		}),
	};
}

function isAdjacentEffectBoundary({
	left,
	right,
}: {
	left: EffectElement;
	right: EffectElement;
}): boolean {
	return Math.abs(left.startTime + left.duration - right.startTime) <= EFFECT_TIME_EPSILON;
}

function resolveAdjacentZoomState({
	currentElement,
	adjacentElement,
	isPrevious,
}: {
	currentElement: EffectElement;
	adjacentElement: TimelineElement | undefined;
	isPrevious: boolean;
}): ZoomTransitionState | undefined {
	if (adjacentElement?.type !== "effect" || adjacentElement.effectType !== "zoom") {
		return undefined;
	}

	const isAdjacent = isPrevious
		? isAdjacentEffectBoundary({
				left: adjacentElement,
				right: currentElement,
			})
		: isAdjacentEffectBoundary({
				left: currentElement,
				right: adjacentElement,
			});

	if (!isAdjacent) {
		return undefined;
	}

	return resolveZoomTransitionState({ element: adjacentElement });
}

function resolveZoomTransition({
	elements,
	index,
}: {
	elements: TimelineElement[];
	index: number;
}): ZoomEffectTransition | undefined {
	const currentElement = elements[index];
	if (currentElement?.type !== "effect" || currentElement.effectType !== "zoom") {
		return undefined;
	}

	const previous = resolveAdjacentZoomState({
		currentElement,
		adjacentElement: elements[index - 1],
		isPrevious: true,
	});
	const next = resolveAdjacentZoomState({
		currentElement,
		adjacentElement: elements[index + 1],
		isPrevious: false,
	});

	if (!previous && !next) {
		return undefined;
	}

	return { previous, next };
}

function buildTrackNodes({
	tracks,
	mediaMap,
	canvasSize,
	isPreview,
}: {
	tracks: TimelineTrack[];
	mediaMap: Map<string, MediaAsset>;
	canvasSize: TCanvasSize;
	isPreview?: boolean;
}): BaseNode[] {
	const nodes: BaseNode[] = [];

	for (const track of tracks) {
		const elements = getVisibleSortedElements({ track });

		for (let index = 0; index < elements.length; index += 1) {
			const element = elements[index];
			if (element.type === "effect") {
				nodes.push(
					new EffectLayerNode({
						effectType: element.effectType,
						effectParams: element.params,
						timeOffset: element.startTime,
						duration: element.duration,
						zoomTransition: resolveZoomTransition({ elements, index }),
					}),
				);
				continue;
			}

			if (element.type === "video" || element.type === "image") {
				const mediaAsset = mediaMap.get(element.mediaId);
				if (!mediaAsset?.file || !mediaAsset?.url) {
					continue;
				}

				if (mediaAsset.type === "video") {
					if (element.type !== "video") {
						continue;
					}
					const videoElement = element;
					nodes.push(
						new VideoNode({
							mediaId: mediaAsset.id,
							url: mediaAsset.url,
							file: mediaAsset.file,
							duration: videoElement.duration,
							timeOffset: videoElement.startTime,
							trimStart: videoElement.trimStart,
							trimEnd: videoElement.trimEnd,
							playbackRate: videoElement.playbackRate,
							freezeFrameStart: videoElement.freezeFrameStart,
							freezeFrameEnd: videoElement.freezeFrameEnd,
							transform: videoElement.transform,
							animations: videoElement.animations,
							opacity: videoElement.opacity,
							blendMode: videoElement.blendMode,
							frameStyle:
								videoElement.type === "video" ? videoElement.frame : undefined,
							effects: videoElement.effects,
						}),
					);
				}
				if (mediaAsset.type === "image") {
					nodes.push(
						new ImageNode({
							url: mediaAsset.url,
							duration: element.duration,
							timeOffset: element.startTime,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							transform: element.transform,
							animations: element.animations,
							opacity: element.opacity,
							blendMode: element.blendMode,
							effects: element.effects,
							...(isPreview && {
								maxSourceSize: PREVIEW_MAX_IMAGE_SIZE,
							}),
						}),
					);
				}
				if (mediaAsset.type === "lottie") {
					nodes.push(
						new LottieNode({
							mediaId: mediaAsset.id,
							url: mediaAsset.url,
							duration: element.duration,
							timeOffset: element.startTime,
							trimStart: element.trimStart,
							trimEnd: element.trimEnd,
							transform: element.transform,
							animations: element.animations,
							opacity: element.opacity,
							blendMode: element.blendMode,
							effects: element.effects,
							fps: mediaAsset.fps,
						}),
					);
				}
			}

			if (element.type === "text") {
				nodes.push(
					new TextNode({
						...element,
						canvasCenter: { x: canvasSize.width / 2, y: canvasSize.height / 2 },
						canvasHeight: canvasSize.height,
						textBaseline: "middle",
						effects: element.effects,
					}),
				);
			}

			if (element.type === "sticker") {
				nodes.push(
					new StickerNode({
						stickerId: element.stickerId,
						duration: element.duration,
						timeOffset: element.startTime,
						trimStart: element.trimStart,
						trimEnd: element.trimEnd,
						transform: element.transform,
						animations: element.animations,
						opacity: element.opacity,
						blendMode: element.blendMode,
						effects: element.effects,
					}),
				);
			}
		}
	}

	return nodes;
}

export type BuildSceneParams = {
	canvasSize: TCanvasSize;
	tracks: TimelineTrack[];
	mediaAssets: MediaAsset[];
	duration: number;
	background: TBackground;
	isPreview?: boolean;
};

export function buildScene({
	canvasSize,
	tracks,
	mediaAssets,
	duration,
	background,
	isPreview,
}: BuildSceneParams) {
	const rootNode = new RootNode({ duration });
	const mediaMap = new Map(mediaAssets.map((m) => [m.id, m]));

	const visibleTracks = tracks.filter(
		(track) => !("hidden" in track && track.hidden),
	);

	const orderedTracksTopToBottom = [
		...visibleTracks.filter((track) => !isMainTrack(track)),
		...visibleTracks.filter((track) => isMainTrack(track)),
	];

	const orderedTracksBottomToTop = orderedTracksTopToBottom.slice().reverse();

	const allNodes = buildTrackNodes({
		tracks: orderedTracksBottomToTop,
		mediaMap,
		canvasSize,
		isPreview,
	});
	let backgroundImageNode: BackgroundImageNode | null = null;
	let backgroundColorNode: ColorNode | null = null;

	if (background.type === "blur") {
		rootNode.add(
			new CompositeEffectNode({
				contentNodes: allNodes.filter(
					(node) => !(node instanceof EffectLayerNode),
				),
				effectType: "blur",
				effectParams: {
					intensity:
						background.blurIntensity ?? DEFAULT_BLUR_INTENSITY,
				},
				scale: BLUR_BACKGROUND_ZOOM_SCALE,
			}),
		);
	} else if (background.type === "image") {
		const backgroundAsset = background.mediaId
			? mediaMap.get(background.mediaId)
			: undefined;
		if (backgroundAsset?.type === "image" && backgroundAsset.url) {
			backgroundImageNode = new BackgroundImageNode({
				url: backgroundAsset.url,
			});
		}
	} else if (background.type === "color" && background.color !== "transparent") {
		backgroundColorNode = new ColorNode({ color: background.color });
	}

	for (const node of allNodes) {
		rootNode.add(node);
	}

	if (backgroundColorNode) {
		rootNode.add(backgroundColorNode);
	}

	if (backgroundImageNode) {
		rootNode.add(backgroundImageNode);
	}

	return rootNode;
}
