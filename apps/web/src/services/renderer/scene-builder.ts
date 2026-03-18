import type { ZoomEffectTransition, ZoomTransitionState } from "@/types/effects";
import type { EffectElement, TimelineElement, TimelineTrack } from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import { resolveZoomTransitionState } from "@/lib/effects/definitions/zoom";
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
import {
	getClampedVideoSourceTimeFromTimelineTime,
	getSourceTimeFromTimelineTime,
} from "@/lib/timeline/clip-speed";

const PREVIEW_MAX_IMAGE_SIZE = 2048;
const BLUR_BACKGROUND_ZOOM_SCALE = 1.4;
const EFFECT_TIME_EPSILON = 1e-6;

type TrackedVideoSource = {
	startTime: number;
	duration: number;
	trimStart: number;
	playbackRate?: number;
	freezeFrameStart?: number;
	freezeFrameEnd?: number;
	cursorTracking?: MediaAsset["cursorTracking"];
};

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
	trackedVideoSources,
}: {
	currentElement: EffectElement;
	adjacentElement: TimelineElement | undefined;
	isPrevious: boolean;
	trackedVideoSources: TrackedVideoSource[];
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

	const boundaryTime = isPrevious
		? currentElement.startTime
		: currentElement.startTime + currentElement.duration;
	const trackedVideoSource = resolveTrackedVideoSourceAtTime({
		time: boundaryTime,
		trackedVideoSources,
	});

	return resolveZoomTransitionState({
		effectParams: adjacentElement.params,
		boundary: isPrevious ? "end" : "start",
		cursorTracking: trackedVideoSource?.cursorTracking,
		sourceTime: trackedVideoSource
			? getTrackedVideoSourceTime({
					time: boundaryTime,
					trackedVideoSource,
			  })
			: undefined,
	});
}

function resolveZoomTransition({
	elements,
	index,
	trackedVideoSources,
}: {
	elements: TimelineElement[];
	index: number;
	trackedVideoSources: TrackedVideoSource[];
}): ZoomEffectTransition | undefined {
	const currentElement = elements[index];
	if (currentElement?.type !== "effect" || currentElement.effectType !== "zoom") {
		return undefined;
	}

	const previous = resolveAdjacentZoomState({
		currentElement,
		adjacentElement: elements[index - 1],
		isPrevious: true,
		trackedVideoSources,
	});
	const next = resolveAdjacentZoomState({
		currentElement,
		adjacentElement: elements[index + 1],
		isPrevious: false,
		trackedVideoSources,
	});

	if (!previous && !next) {
		return undefined;
	}

	return { previous, next };
}

function isTrackedVideoSourceInRange({
	time,
	trackedVideoSource,
}: {
	time: number;
	trackedVideoSource: TrackedVideoSource;
}): boolean {
	return (
		time >= trackedVideoSource.startTime - EFFECT_TIME_EPSILON &&
		time < trackedVideoSource.startTime + trackedVideoSource.duration
	);
}

function resolveTrackedVideoSourceAtTime({
	time,
	trackedVideoSources,
}: {
	time: number;
	trackedVideoSources: TrackedVideoSource[];
}): TrackedVideoSource | undefined {
	for (const trackedVideoSource of trackedVideoSources) {
		if (isTrackedVideoSourceInRange({ time, trackedVideoSource })) {
			return trackedVideoSource;
		}
	}

	return undefined;
}

function getTrackedVideoSourceTime({
	time,
	trackedVideoSource,
}: {
	time: number;
	trackedVideoSource: TrackedVideoSource;
}): number {
	if (
		typeof trackedVideoSource.freezeFrameStart === "number" ||
		typeof trackedVideoSource.freezeFrameEnd === "number"
	) {
		return getClampedVideoSourceTimeFromTimelineTime({
			timelineTime: time,
			startTime: trackedVideoSource.startTime,
			trimStart: trackedVideoSource.trimStart,
			duration: trackedVideoSource.duration,
			playbackRate: trackedVideoSource.playbackRate,
			freezeFrameStart: trackedVideoSource.freezeFrameStart,
			freezeFrameEnd: trackedVideoSource.freezeFrameEnd,
		});
	}

	return getSourceTimeFromTimelineTime({
		timelineTime: time,
		startTime: trackedVideoSource.startTime,
		trimStart: trackedVideoSource.trimStart,
		playbackRate: trackedVideoSource.playbackRate,
	});
}

function collectTrackedVideoSources({
	tracks,
	mediaMap,
	beforeTrackIndex,
}: {
	tracks: TimelineTrack[];
	mediaMap: Map<string, MediaAsset>;
	beforeTrackIndex: number;
}): TrackedVideoSource[] {
	const trackedSources: TrackedVideoSource[] = [];

	for (let trackIndex = beforeTrackIndex - 1; trackIndex >= 0; trackIndex -= 1) {
		const track = tracks[trackIndex];
		if (track.type !== "video") {
			continue;
		}

		const elements = getVisibleSortedElements({ track });
		for (const element of elements) {
			if (element.type !== "video") {
				continue;
			}

			const mediaAsset = mediaMap.get(element.mediaId);
			trackedSources.push({
				startTime: element.startTime,
				duration: element.duration,
				trimStart: element.trimStart,
				playbackRate: element.playbackRate,
				freezeFrameStart: element.freezeFrameStart,
				freezeFrameEnd: element.freezeFrameEnd,
				cursorTracking: mediaAsset?.cursorTracking,
			});
		}
	}

	return trackedSources;
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

	for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
		const track = tracks[trackIndex];
		const elements = getVisibleSortedElements({ track });

		for (let index = 0; index < elements.length; index += 1) {
			const element = elements[index];
			if (element.type === "effect") {
				const trackedVideoSources = collectTrackedVideoSources({
					tracks,
					mediaMap,
					beforeTrackIndex: trackIndex,
				});
				nodes.push(
					new EffectLayerNode({
						effectType: element.effectType,
						effectParams: element.params,
						timeOffset: element.startTime,
						duration: element.duration,
						zoomTransition: resolveZoomTransition({
							elements,
							index,
							trackedVideoSources,
						}),
						trackedVideoSources,
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
							cursorTracking: mediaAsset.cursorTracking,
							recordedCursor: mediaAsset.recordedCursor,
							duration: videoElement.duration,
							timeOffset: videoElement.startTime,
							trimStart: videoElement.trimStart,
							trimEnd: videoElement.trimEnd,
							playbackRate: videoElement.playbackRate,
							freezeFrameStart: videoElement.freezeFrameStart,
							freezeFrameEnd: videoElement.freezeFrameEnd,
							transform: videoElement.transform,
							animations: videoElement.animations,
							keyframeEasing: videoElement.keyframeEasing,
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
							keyframeEasing: element.keyframeEasing,
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
							sourceDuration:
								typeof element.sourceDuration === "number" &&
								Number.isFinite(element.sourceDuration)
									? element.sourceDuration
									: mediaAsset.duration,
							transform: element.transform,
							animations: element.animations,
							keyframeEasing: element.keyframeEasing,
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
