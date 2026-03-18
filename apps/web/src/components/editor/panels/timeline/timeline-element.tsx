"use client";

import { useEditor } from "@/hooks/use-editor";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";
import AudioWaveform from "./audio-waveform";
import { useTimelineElementResize } from "@/hooks/timeline/element/use-element-resize";
import {
	useKeyframeDrag,
	type KeyframeDragState,
} from "@/hooks/timeline/element/use-keyframe-drag";
import { useKeyframeSelection } from "@/hooks/timeline/element/use-keyframe-selection";
import type { SnapPoint } from "@/lib/timeline/snap-utils";
import { getElementKeyframes } from "@/lib/animation";
import {
	getVisibleTimelineDuration,
	normalizeFreezeFrameDuration,
} from "@/lib/timeline/clip-speed";
import {
	getTrackClasses,
	getTrackHeight,
	canElementHaveAudio,
	canElementBeHidden,
	hasMediaId,
	timelineTimeToPixels,
	timelineTimeToSnappedPixels,
} from "@/lib/timeline";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type {
	TimelineElement as TimelineElementType,
	TimelineTrack,
	VisualElement,
	EffectElement,
	ElementDragState,
} from "@/types/timeline";
import type { MediaAsset } from "@/types/assets";
import { mediaSupportsAudio } from "@/lib/media/media-utils";
import {
	getActionDefinition,
	type TActionWithOptionalArgs,
	invokeAction,
} from "@/lib/actions";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { resolveStickerId } from "@/lib/stickers";
import Image from "next/image";
import {
	ScissorIcon,
	Delete02Icon,
	Copy01Icon,
	ViewIcon,
	ViewOffSlashIcon,
	VolumeHighIcon,
	VolumeOffIcon,
	VolumeMute02Icon,
	Search01Icon,
	Exchange01Icon,
	KeyframeIcon,
	MagicWand05Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { uppercase } from "@/utils/string";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react";
import type { SelectedKeyframeRef, ElementKeyframe } from "@/types/animation";
import { cn } from "@/utils/ui";
import { Button } from "@/components/ui/button";
import { usePropertiesStore } from "@/stores/properties-store";
import { getEffect } from "@/lib/effects/registry";

const KEYFRAME_INDICATOR_MIN_WIDTH_PX = 40;
const ELEMENT_RING_WIDTH_PX = 1.5;
const ZOOM_EASE_HANDLE_HIT_WIDTH_PX = 12;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

type ZoomTimelineElement = VisualElement | EffectElement;

function resolveZoomTimelineEffect({
	element,
}: {
	element: ZoomTimelineElement;
}): { id: string; type: string; params: Record<string, number | string | boolean> } | null {
	if (element.type === "effect") {
		if (element.effectType !== "zoom") {
			return null;
		}
		return {
			id: element.id,
			type: element.effectType,
			params: element.params,
		};
	}

	const effect = (element.effects ?? []).find(
		(item) => item.enabled && item.type === "zoom",
	);
	if (!effect) {
		return null;
	}

	return {
		id: effect.id,
		type: effect.type,
		params: effect.params,
	};
}

function resolveZoomEaseSeconds({
	element,
	effectId,
	paramKey,
}: {
	element: ZoomTimelineElement;
	effectId: string;
	paramKey: "ease" | "easeIn" | "easeOut";
}): number | null {
	if (element.type === "effect") {
		if (element.effectType !== "zoom" || effectId !== element.id) {
			return null;
		}
		const rawValue = element.params[paramKey];
		return typeof rawValue === "number" && Number.isFinite(rawValue)
			? rawValue
			: null;
	}

	const channel = getElementKeyframes({ animations: element.animations }).find(
		(keyframe) => keyframe.propertyPath === `effects.${effectId}.params.${paramKey}`,
	);
	if (channel) {
		return null;
	}
	const effect = (element.effects ?? []).find((item) => item.id === effectId);
	if (!effect) {
		return null;
	}
	const rawValue = effect.params[paramKey];
	return typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null;
}

function resolveZoomEaseBounds({
	element,
	effectId,
	displayedDuration,
}: {
	element: ZoomTimelineElement;
	effectId: string;
	displayedDuration: number;
}): { entrySeconds: number; exitSeconds: number; shared: boolean } | null {
	const zoomEffect = resolveZoomTimelineEffect({ element });
	if (!zoomEffect || zoomEffect.id !== effectId || displayedDuration <= 0) {
		return null;
	}
	const sharedEase = resolveZoomEaseSeconds({
		element,
		effectId,
		paramKey: "ease",
	});
	if (sharedEase !== null) {
		const clampedEase = clamp(sharedEase, 0, displayedDuration / 2);
		return {
			entrySeconds: clampedEase,
			exitSeconds: clampedEase,
			shared: true,
		};
	}
	const easeInPercent = resolveZoomEaseSeconds({
		element,
		effectId,
		paramKey: "easeIn",
	});
	const easeOutPercent = resolveZoomEaseSeconds({
		element,
		effectId,
		paramKey: "easeOut",
	});
	const entrySeconds =
		displayedDuration * clamp((easeInPercent ?? 20) / 100, 0, 1);
	const exitSeconds =
		displayedDuration * clamp((easeOutPercent ?? 20) / 100, 0, 1);
	const total = entrySeconds + exitSeconds;
	if (total <= displayedDuration) {
		return { entrySeconds, exitSeconds, shared: false };
	}
	if (total <= 0) {
		return { entrySeconds: 0, exitSeconds: 0, shared: false };
	}
	const scale = displayedDuration / total;
	return {
		entrySeconds: entrySeconds * scale,
		exitSeconds: exitSeconds * scale,
		shared: false,
	};
}

interface KeyframeIndicator {
	time: number;
	offsetPx: number;
	keyframes: SelectedKeyframeRef[];
}

function buildKeyframeIndicator({
	keyframe,
	trackId,
	elementId,
	displayedStartTime,
	zoomLevel,
	elementLeft,
}: {
	keyframe: ElementKeyframe;
	trackId: string;
	elementId: string;
	displayedStartTime: number;
	zoomLevel: number;
	elementLeft: number;
}): {
	time: number;
	offsetPx: number;
	keyframeRef: SelectedKeyframeRef;
} {
	const keyframeRef = {
		trackId,
		elementId,
		propertyPath: keyframe.propertyPath,
		keyframeId: keyframe.id,
	};
	const keyframeLeft = timelineTimeToSnappedPixels({
		time: displayedStartTime + keyframe.time,
		zoomLevel,
	});
	return {
		time: keyframe.time,
		offsetPx: keyframeLeft - elementLeft,
		keyframeRef,
	};
}

function getKeyframeIndicators({
	keyframes,
	trackId,
	elementId,
	displayedStartTime,
	zoomLevel,
	elementLeft,
	elementWidth,
}: {
	keyframes: ElementKeyframe[];
	trackId: string;
	elementId: string;
	displayedStartTime: number;
	zoomLevel: number;
	elementLeft: number;
	elementWidth: number;
}): KeyframeIndicator[] {
	const grouped = new Map<number, KeyframeIndicator>();

	for (const keyframe of keyframes) {
		const indicator = buildKeyframeIndicator({
			keyframe,
			trackId,
			elementId,
			displayedStartTime,
			zoomLevel,
			elementLeft,
		});
		const boundedOffsetPx = clamp(indicator.offsetPx, 0, elementWidth);
		const existing = grouped.get(indicator.time);
		if (existing) {
			existing.keyframes.push(indicator.keyframeRef);
		} else {
			grouped.set(indicator.time, {
				time: indicator.time,
				offsetPx: boundedOffsetPx,
				keyframes: [indicator.keyframeRef],
			});
		}
	}

	return Array.from(grouped.values()).sort((left, right) => left.time - right.time);
}

function getDisplayShortcut({
	action,
}: {
	action: TActionWithOptionalArgs;
}): string | undefined {
	const definition = getActionDefinition({ action });
	const shortcut = definition.defaultShortcuts?.[0];
	return shortcut ? uppercase({ string: shortcut.replaceAll("+", " + ") }) : undefined;
}

interface TimelineElementProps {
	element: TimelineElementType;
	track: TimelineTrack;
	zoomLevel: number;
	isSelected: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
	onResizeStateChange?: (params: { isResizing: boolean }) => void;
	onElementMouseDown: (
		event: React.MouseEvent,
		element: TimelineElementType,
	) => void;
	onElementClick: (
		event: React.MouseEvent,
		element: TimelineElementType,
	) => void;
	dragState: ElementDragState;
	isDropTarget?: boolean;
}

export function TimelineElement({
	element,
	track,
	zoomLevel,
	isSelected,
	onSnapPointChange,
	onResizeStateChange,
	onElementMouseDown,
	onElementClick,
	dragState,
	isDropTarget = false,
}: TimelineElementProps) {
	const editor = useEditor({ subscribeTo: ["media"] });
	const { selectedElements } = useElementSelection();
	const { requestRevealMedia, requestReplaceMedia } = useAssetsPanelStore();

	let mediaAsset: MediaAsset | null = null;

	if (hasMediaId(element)) {
		mediaAsset =
			editor.media.getAssets().find((asset) => asset.id === element.mediaId) ??
			null;
	}

	const hasAudio = mediaSupportsAudio({ media: mediaAsset });

	const {
		handleResizeStart,
		isResizing,
		currentTrimStart,
		currentTrimEnd,
		currentStartTime,
		currentDuration,
		currentFreezeFrameStart,
		currentFreezeFrameEnd,
	} = useTimelineElementResize({
		element,
		track,
		zoomLevel,
		onSnapPointChange,
		onResizeStateChange,
	});

	const isCurrentElementSelected = selectedElements.some(
		(selected) =>
			selected.elementId === element.id && selected.trackId === track.id,
	);

	const isBeingDragged = dragState.elementId === element.id;
	const dragOffsetY =
		isBeingDragged && dragState.isDragging
			? dragState.currentMouseY - dragState.startMouseY
			: 0;
	const elementStartTime =
		isBeingDragged && dragState.isDragging
			? dragState.currentTime
			: element.startTime;
	const displayedStartTime = isResizing ? currentStartTime : elementStartTime;
	const displayedDuration = isResizing ? currentDuration : element.duration;
	const displayedTrimStart = isResizing ? currentTrimStart : element.trimStart;
	const displayedTrimEnd = isResizing ? currentTrimEnd : element.trimEnd;
	const displayedFreezeFrameStart =
		element.type === "video"
			? isResizing
				? currentFreezeFrameStart
				: isBeingDragged && dragState.isDragging
					? dragState.currentFreezeFrameStart ?? (element.freezeFrameStart ?? 0)
				: element.freezeFrameStart ?? 0
			: 0;
	const displayedFreezeFrameEnd =
		element.type === "video"
			? isResizing
				? currentFreezeFrameEnd
				: isBeingDragged && dragState.isDragging
					? dragState.currentFreezeFrameEnd ?? (element.freezeFrameEnd ?? 0)
				: element.freezeFrameEnd ?? 0
			: 0;
	const elementWidth = timelineTimeToPixels({
		time: displayedDuration,
		zoomLevel,
	});
	const elementLeft = timelineTimeToSnappedPixels({
		time: displayedStartTime,
		zoomLevel,
	});
	const keyframeIndicators = isSelected
		? getKeyframeIndicators({
				keyframes: getElementKeyframes({ animations: element.animations }),
				trackId: track.id,
				elementId: element.id,
				displayedStartTime,
				zoomLevel,
				elementLeft,
				elementWidth,
			})
		: [];

	const {
		keyframeDragState,
		handleKeyframeMouseDown,
		handleKeyframeClick,
		getVisualOffsetPx,
	} = useKeyframeDrag({ zoomLevel, element, displayedStartTime });
	const handleRevealInMedia = ({ event }: { event: React.MouseEvent }) => {
		event.stopPropagation();
		if (hasMediaId(element)) {
			requestRevealMedia(element.mediaId);
		}
	};
	const handleReplaceMedia = ({ event }: { event: React.MouseEvent }) => {
		event.stopPropagation();
		if (hasMediaId(element)) {
			requestReplaceMedia({
				trackId: track.id,
				elementId: element.id,
				elementType: element.type,
				currentMediaId: element.mediaId,
			});
		}
	};

	const isMuted = canElementHaveAudio(element) && element.muted === true;

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className="absolute top-0 h-full select-none"
					style={{
						left: `${elementLeft}px`,
						width: `${elementWidth}px`,
						transform:
							isBeingDragged && dragState.isDragging
								? `translate3d(0, ${dragOffsetY}px, 0)`
								: undefined,
					}}
				>
					<ElementInner
						element={element}
						track={track}
						isSelected={isSelected}
						onElementClick={onElementClick}
						onElementMouseDown={onElementMouseDown}
						handleResizeStart={handleResizeStart}
						isDropTarget={isDropTarget}
						displayedDuration={displayedDuration}
						displayedTrimStart={displayedTrimStart}
						displayedTrimEnd={displayedTrimEnd}
						displayedFreezeFrameStart={displayedFreezeFrameStart}
						displayedFreezeFrameEnd={displayedFreezeFrameEnd}
					/>
					{isSelected && (
						<div className="pointer-events-none absolute inset-0 overflow-hidden">
							<KeyframeIndicators
								indicators={keyframeIndicators}
								dragState={keyframeDragState}
								displayedStartTime={displayedStartTime}
								elementLeft={elementLeft}
								onKeyframeMouseDown={handleKeyframeMouseDown}
								onKeyframeClick={handleKeyframeClick}
								getVisualOffsetPx={getVisualOffsetPx}
							/>
						</div>
					)}
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent className="w-64">
				<ActionMenuItem
					action="split"
					icon={<HugeiconsIcon icon={ScissorIcon} />}
				>
					Split
				</ActionMenuItem>
				<CopyMenuItem />
				{canElementHaveAudio(element) && hasAudio && (
					<MuteMenuItem
						isMultipleSelected={selectedElements.length > 1}
						isCurrentElementSelected={isCurrentElementSelected}
						isMuted={isMuted}
					/>
				)}
				{canElementBeHidden(element) && (
					<VisibilityMenuItem
						element={element}
						isMultipleSelected={selectedElements.length > 1}
						isCurrentElementSelected={isCurrentElementSelected}
					/>
				)}
				{selectedElements.length === 1 && (
					<ActionMenuItem
						action="duplicate-selected"
						icon={<HugeiconsIcon icon={Copy01Icon} />}
					>
						Duplicate
					</ActionMenuItem>
				)}
				{selectedElements.length === 1 && hasMediaId(element) && (
					<>
						<ContextMenuItem
							icon={<HugeiconsIcon icon={Search01Icon} />}
							onClick={(event: React.MouseEvent) =>
								handleRevealInMedia({ event })
							}
						>
							Reveal media
						</ContextMenuItem>
						<ContextMenuItem
							icon={<HugeiconsIcon icon={Exchange01Icon} />}
							onClick={(event: React.MouseEvent) =>
								handleReplaceMedia({ event })
							}
						>
							Replace media
						</ContextMenuItem>
					</>
				)}
				<ContextMenuSeparator />
				<DeleteMenuItem
					isMultipleSelected={selectedElements.length > 1}
					isCurrentElementSelected={isCurrentElementSelected}
					elementType={element.type}
					selectedCount={selectedElements.length}
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function ElementInner({
	element,
	track,
	isSelected,
	onElementClick,
	onElementMouseDown,
	handleResizeStart,
	isDropTarget = false,
	displayedDuration,
	displayedTrimStart,
	displayedTrimEnd,
	displayedFreezeFrameStart,
	displayedFreezeFrameEnd,
}: {
	element: TimelineElementType;
	track: TimelineTrack;
	isSelected: boolean;
	onElementClick: (
		event: React.MouseEvent,
		element: TimelineElementType,
	) => void;
	onElementMouseDown: (
		event: React.MouseEvent,
		element: TimelineElementType,
	) => void;
	handleResizeStart: (params: {
		event: React.MouseEvent;
		elementId: string;
		side: "left" | "right";
	}) => void;
	isDropTarget?: boolean;
	displayedDuration: number;
	displayedTrimStart: number;
	displayedTrimEnd: number;
	displayedFreezeFrameStart: number;
	displayedFreezeFrameEnd: number;
}) {
	const opacityClass =
		(canElementBeHidden(element) && element.hidden) || isDropTarget
			? "opacity-50"
			: "";
	const closeClipEffects = usePropertiesStore(
		(state) => state.closeClipEffects,
	);

	return (
		<div
			className="relative h-full cursor-pointer"
			style={{ marginInline: ELEMENT_RING_WIDTH_PX }}
		>
			<div
				className={cn(
					"absolute inset-0 overflow-hidden rounded-sm",
					getTrackClasses({ type: track.type }),
					opacityClass,
				)}
				style={
					isSelected
						? {
								boxShadow: `0 0 0 ${ELEMENT_RING_WIDTH_PX}px var(--foreground)`,
							}
						: undefined
				}
			>
				<button
					type="button"
					className="absolute inset-0 size-full cursor-pointer flex flex-col"
					onClick={(event) => {
						closeClipEffects();
						onElementClick(event, element);
					}}
					onMouseDown={(event) => onElementMouseDown(event, element)}
				>
					<div className="flex flex-1 min-h-0 items-center overflow-hidden">
						<ElementContent
							element={element}
							track={track}
							isSelected={isSelected}
							displayedDuration={displayedDuration}
							displayedTrimStart={displayedTrimStart}
							displayedTrimEnd={displayedTrimEnd}
							displayedFreezeFrameStart={displayedFreezeFrameStart}
							displayedFreezeFrameEnd={displayedFreezeFrameEnd}
						/>
						{element.type !== "audio" && (
							<ZoomEaseOverlay
								element={element as ZoomTimelineElement}
								trackId={track.id}
								isSelected={isSelected}
								displayedDuration={displayedDuration}
							/>
						)}
						<FreezeFrameOverlay
							element={element}
							displayedDuration={displayedDuration}
							displayedFreezeFrameStart={displayedFreezeFrameStart}
							displayedFreezeFrameEnd={displayedFreezeFrameEnd}
						/>
					</div>
				</button>
			</div>

			{element.type !== "audio" && element.type !== "effect" && (
				<div className="sticky left-1 mt-1 ml-1 w-fit">
					<EffectsButton
						element={element as VisualElement}
						trackId={track.id}
					/>
				</div>
			)}

			{isSelected && (
				<>
					<ResizeHandle
						side="left"
						elementId={element.id}
						handleResizeStart={handleResizeStart}
					/>
					<ResizeHandle
						side="right"
						elementId={element.id}
						handleResizeStart={handleResizeStart}
					/>
				</>
			)}
		</div>
	);
}

function ResizeHandle({
	side,
	elementId,
	handleResizeStart,
}: {
	side: "left" | "right";
	elementId: string;
	handleResizeStart: (params: {
		event: React.MouseEvent;
		elementId: string;
		side: "left" | "right";
	}) => void;
}) {
	const isLeft = side === "left";
	return (
		<button
			type="button"
			className={cn(
				"absolute top-0 bottom-0 w-2",
				isLeft ? "-left-1 cursor-w-resize" : "-right-1 cursor-e-resize",
			)}
			onMouseDown={(event) => handleResizeStart({ event, elementId, side })}
			onClick={(event) => event.stopPropagation()}
			aria-label={`${isLeft ? "Left" : "Right"} resize handle`}
		></button>
	);
}

function ZoomEaseOverlay({
	element,
	trackId,
	isSelected,
	displayedDuration,
}: {
	element: ZoomTimelineElement;
	trackId: string;
	isSelected: boolean;
	displayedDuration: number;
}) {
	const editor = useEditor();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [dragSide, setDragSide] = useState<"left" | "right" | null>(null);
	const zoomEffect = useMemo(() => resolveZoomTimelineEffect({ element }), [element]);
	const bounds = useMemo(
		() =>
			zoomEffect
				? resolveZoomEaseBounds({
						element,
						effectId: zoomEffect.id,
						displayedDuration,
					})
				: null,
		[element, zoomEffect, displayedDuration],
	);

	useEffect(() => {
		if (!dragSide || !zoomEffect || !bounds) {
			return;
		}

		const handleMouseMove = (event: MouseEvent) => {
			const container = containerRef.current;
			if (!container || displayedDuration <= 0) {
				return;
			}
			const rect = container.getBoundingClientRect();
			if (rect.width <= 0) {
				return;
			}
			const relativeX = clamp(event.clientX - rect.left, 0, rect.width);
			const timeAtCursor = (relativeX / rect.width) * displayedDuration;

			if (bounds.shared) {
				const mirroredTime = dragSide === "left" ? timeAtCursor : displayedDuration - timeAtCursor;
				const nextEase = clamp(
					mirroredTime,
					0,
					Math.max(0, displayedDuration / 2),
				);
				if (element.type === "effect") {
					editor.timeline.previewElements({
						updates: [
							{
								trackId,
								elementId: element.id,
								updates: {
									params: {
										...element.params,
										ease: Math.round(nextEase * 100) / 100,
									},
								},
							},
						],
					});
				} else {
					editor.timeline.updateClipEffectParams({
						trackId,
						elementId: element.id,
						effectId: zoomEffect.id,
						params: { ease: Math.round(nextEase * 100) / 100 },
						pushHistory: false,
					});
				}
				return;
			}

			if (dragSide === "left") {
				const maxEntry = Math.max(0, displayedDuration - bounds.exitSeconds);
				const nextEntryPercent =
					(displayedDuration <= 0
						? 0
						: (clamp(timeAtCursor, 0, maxEntry) / displayedDuration) * 100);
				if (element.type === "effect") {
					editor.timeline.previewElements({
						updates: [
							{
								trackId,
								elementId: element.id,
								updates: {
									params: {
										...element.params,
										easeIn: Math.round(nextEntryPercent * 10) / 10,
									},
								},
							},
						],
					});
				} else {
					editor.timeline.updateClipEffectParams({
						trackId,
						elementId: element.id,
						effectId: zoomEffect.id,
						params: { easeIn: Math.round(nextEntryPercent * 10) / 10 },
						pushHistory: false,
					});
				}
				return;
			}

			const maxExit = Math.max(0, displayedDuration - bounds.entrySeconds);
			const exitSeconds = clamp(displayedDuration - timeAtCursor, 0, maxExit);
			const nextExitPercent =
				displayedDuration <= 0 ? 0 : (exitSeconds / displayedDuration) * 100;
			if (element.type === "effect") {
				editor.timeline.previewElements({
					updates: [
						{
							trackId,
							elementId: element.id,
							updates: {
								params: {
									...element.params,
									easeOut: Math.round(nextExitPercent * 10) / 10,
								},
							},
						},
					],
				});
			} else {
				editor.timeline.updateClipEffectParams({
					trackId,
					elementId: element.id,
					effectId: zoomEffect.id,
					params: { easeOut: Math.round(nextExitPercent * 10) / 10 },
					pushHistory: false,
				});
			}
		};

		const handleMouseUp = () => {
			setDragSide(null);
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};
	}, [bounds, displayedDuration, dragSide, editor.timeline, element.id, trackId, zoomEffect]);

	if (!zoomEffect || !bounds || displayedDuration <= 0) {
		return null;
	}

	if (!isSelected) {
		return null;
	}

	const definition = getEffect({ effectType: zoomEffect.type });
	const entryPercent = clamp((bounds.entrySeconds / displayedDuration) * 100, 0, 100);
	const exitPercent = clamp((bounds.exitSeconds / displayedDuration) * 100, 0, 100);
	const rightStartPercent = clamp(100 - exitPercent, 0, 100);
	const canShowLabels = entryPercent >= 8 || exitPercent >= 8;
	const shouldShowEntry = element.startTime > 1;
	const shouldShowInLabel = entryPercent >= 10 && element.startTime > 1;
	const shouldShowOutLabel = exitPercent >= 10;

	return (
		<div
			ref={containerRef}
			className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-sm"
		>
			<div className="absolute left-1 right-1 top-1/2 h-4 -translate-y-1/2 rounded-md ring-1 ring-cyan-300/35 ring-inset" />
			{shouldShowEntry && (
				<div
					className="absolute left-0 top-1/2 h-4 -translate-y-1/2 rounded-l-md bg-cyan-400/16"
					style={{ width: `${entryPercent}%` }}
				/>
			)}
			<div
				className="absolute top-1/2 h-4 -translate-y-1/2 rounded-r-md bg-cyan-400/16"
				style={{ left: `${rightStartPercent}%`, width: `${exitPercent}%` }}
			/>
			<div className="absolute inset-x-2 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-black/18">
				{shouldShowEntry && (
					<div
						className="absolute left-0 top-0 h-full rounded-full bg-cyan-300/95 shadow-[0_0_8px_rgba(34,211,238,0.25)]"
						style={{ width: `${entryPercent}%` }}
					/>
				)}
				<div
					className="absolute top-0 h-full rounded-full bg-cyan-300/95 shadow-[0_0_8px_rgba(34,211,238,0.25)]"
					style={{ left: `${rightStartPercent}%`, width: `${exitPercent}%` }}
				/>
			</div>
			{shouldShowEntry && (
				<div
					className="absolute top-1/2 h-5 w-px -translate-y-1/2 bg-cyan-100/90 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]"
					style={{ left: `${entryPercent}%` }}
				/>
			)}
			<div
				className="absolute top-1/2 h-5 w-px -translate-y-1/2 bg-cyan-100/90 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]"
				style={{ left: `${rightStartPercent}%` }}
			/>
			{canShowLabels && (
				<>
					{shouldShowInLabel && (
						<div className="absolute left-1.5 top-0.5 rounded-md border border-cyan-300/45 bg-black/55 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-cyan-100 backdrop-blur-sm">
							In
						</div>
					)}
					{shouldShowOutLabel && (
						<div className="absolute right-1.5 top-0.5 rounded-md border border-cyan-300/45 bg-black/55 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-cyan-100 backdrop-blur-sm">
							Out
						</div>
					)}
				</>
			)}
			{shouldShowEntry && (
				<button
					type="button"
					className="pointer-events-auto absolute top-1/2 h-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"
					style={{ left: `${entryPercent}%`, width: `${ZOOM_EASE_HANDLE_HIT_WIDTH_PX}px` }}
					onMouseDown={(event) => {
						event.stopPropagation();
						event.preventDefault();
						setDragSide("left");
					}}
					aria-label={`${definition.name} ease in handle`}
				>
					<span className="pointer-events-none absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100 bg-cyan-300 shadow-[0_0_0_2px_rgba(8,15,25,0.35)]" />
				</button>
			)}
			<button
				type="button"
				className="pointer-events-auto absolute top-1/2 h-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize"
				style={{ left: `${rightStartPercent}%`, width: `${ZOOM_EASE_HANDLE_HIT_WIDTH_PX}px` }}
				onMouseDown={(event) => {
					event.stopPropagation();
					event.preventDefault();
					setDragSide("right");
				}}
				aria-label={`${definition.name} ease out handle`}
			>
				<span className="pointer-events-none absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-100 bg-cyan-300 shadow-[0_0_0_2px_rgba(8,15,25,0.35)]" />
			</button>
		</div>
	);
}

function KeyframeIndicators({
	indicators,
	dragState,
	displayedStartTime,
	elementLeft,
	onKeyframeMouseDown,
	onKeyframeClick,
	getVisualOffsetPx,
}: {
	indicators: KeyframeIndicator[];
	dragState: KeyframeDragState;
	displayedStartTime: number;
	elementLeft: number;
	onKeyframeMouseDown: (params: {
		event: React.MouseEvent;
		keyframes: SelectedKeyframeRef[];
	}) => void;
	onKeyframeClick: (params: {
		event: React.MouseEvent;
		keyframes: SelectedKeyframeRef[];
		orderedKeyframes: SelectedKeyframeRef[];
		indicatorTime: number;
	}) => void;
	getVisualOffsetPx: (params: {
		indicatorTime: number;
		indicatorOffsetPx: number;
		isBeingDragged: boolean;
		displayedStartTime: number;
		elementLeft: number;
	}) => number;
}) {
	const { isKeyframeSelected } = useKeyframeSelection();
	const orderedKeyframes = indicators.flatMap(
		(indicator) => indicator.keyframes,
	);

	return indicators.map((indicator) => {
		const isIndicatorSelected = indicator.keyframes.some((keyframe) =>
			isKeyframeSelected({ keyframe }),
		);
		const isBeingDragged = indicator.keyframes.some((kf) =>
			dragState.draggingKeyframeIds.has(kf.keyframeId),
		);
		const visualOffsetPx = getVisualOffsetPx({
			indicatorTime: indicator.time,
			indicatorOffsetPx: indicator.offsetPx,
			isBeingDragged,
			displayedStartTime,
			elementLeft,
		});

		return (
			<button
				key={indicator.time}
				type="button"
				className="pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-grab"
				style={{ left: visualOffsetPx }}
				onMouseDown={(event) =>
					onKeyframeMouseDown({ event, keyframes: indicator.keyframes })
				}
				onClick={(event) =>
					onKeyframeClick({
						event,
						keyframes: indicator.keyframes,
						orderedKeyframes,
						indicatorTime: indicator.time,
					})
				}
				aria-label="Select keyframe"
			>
				<HugeiconsIcon
					icon={KeyframeIcon}
					className={cn(
						"size-3.5 mt-1.5 text-black",
						isIndicatorSelected ? "fill-primary" : "fill-white",
					)}
					strokeWidth={1.5}
				/>
			</button>
		);
	});
}

interface ElementContentProps {
	element: TimelineElementType;
	track: TimelineTrack;
	isSelected: boolean;
	displayedDuration: number;
	displayedTrimStart: number;
	displayedTrimEnd: number;
	displayedFreezeFrameStart?: number;
	displayedFreezeFrameEnd?: number;
}

interface ElementContentRendererProps extends ElementContentProps {
	mediaAssets: MediaAsset[];
}

type ElementContentRenderer = (props: ElementContentRendererProps) => ReactNode;

function FreezeFrameOverlay({
	element,
	displayedDuration,
	displayedFreezeFrameStart,
	displayedFreezeFrameEnd,
}: {
	element: TimelineElementType;
	displayedDuration: number;
	displayedFreezeFrameStart: number;
	displayedFreezeFrameEnd: number;
}) {
	if (element.type !== "video") {
		return null;
	}

	const freezeFrameStart = normalizeFreezeFrameDuration({
		duration: displayedFreezeFrameStart,
	});
	const freezeFrameEnd = normalizeFreezeFrameDuration({
		duration: displayedFreezeFrameEnd,
	});

	if (displayedDuration <= 0 || (freezeFrameStart <= 0 && freezeFrameEnd <= 0)) {
		return null;
	}

	const leftWidthPercent = (freezeFrameStart / displayedDuration) * 100;
	const rightWidthPercent = (freezeFrameEnd / displayedDuration) * 100;

	return (
		<div className="pointer-events-none absolute inset-0 z-10">
			{freezeFrameStart > 0 && (
				<div
					className="absolute inset-y-0 left-0 overflow-hidden border-r border-white/40 bg-white/18"
					style={{
						width: `${leftWidthPercent}%`,
						backgroundImage:
							"repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 8px, rgba(255,255,255,0.02) 8px 16px)",
					}}
				>
					{leftWidthPercent >= 14 && (
						<div className="flex size-full items-center justify-center px-2">
							<span className="truncate text-[10px] font-medium uppercase tracking-wide text-white/90">
								Freeze
							</span>
						</div>
					)}
				</div>
			)}
			{freezeFrameEnd > 0 && (
				<div
					className="absolute inset-y-0 right-0 overflow-hidden border-l border-white/40 bg-white/18"
					style={{
						width: `${rightWidthPercent}%`,
						backgroundImage:
							"repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 8px, rgba(255,255,255,0.02) 8px 16px)",
					}}
				>
					{rightWidthPercent >= 14 && (
						<div className="flex size-full items-center justify-center px-2">
							<span className="truncate text-[10px] font-medium uppercase tracking-wide text-white/90">
								Freeze
							</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function LottieLoopOverlay({
	loopExtensionEnd,
	displayedDuration,
}: {
	loopExtensionEnd: number;
	displayedDuration: number;
}) {
	if (displayedDuration <= 0 || loopExtensionEnd <= 0) {
		return null;
	}

	const rightWidthPercent = (loopExtensionEnd / displayedDuration) * 100;

	return (
		<div className="pointer-events-none absolute inset-0 z-10">
			<div
				className="absolute inset-y-0 right-0 overflow-hidden border-l border-white/40 bg-white/14"
				style={{
					width: `${rightWidthPercent}%`,
					backgroundImage:
						"repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 8px, rgba(255,255,255,0.02) 8px 16px)",
				}}
			>
				{rightWidthPercent >= 14 && (
					<div className="flex size-full items-center justify-center px-2">
						<span className="truncate text-[10px] font-medium uppercase tracking-wide text-white/90">
							Loop
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

export function renderTiledMedia({
	element,
	imageUrl,
	track,
	clipDuration,
	displayedFreezeFrameStart,
	displayedFreezeFrameEnd,
	showTransparencyGrid = false,
	showTitle = false,
	loopExtensionEnd = 0,
}: {
	element: VisualElement;
	imageUrl: string | undefined;
	track: ElementContentProps["track"];
	clipDuration?: number;
	displayedFreezeFrameStart?: number;
	displayedFreezeFrameEnd?: number;
	showTransparencyGrid?: boolean;
	showTitle?: boolean;
	loopExtensionEnd?: number;
}): ReactNode {
	const resolvedClipDuration = clipDuration ?? element.duration;
	const trackHeight = getTrackHeight({ type: track.type });
	const tileWidth = trackHeight * (16 / 9);
	const freezeFrameStart =
		element.type === "video"
			? normalizeFreezeFrameDuration({
					duration: displayedFreezeFrameStart ?? element.freezeFrameStart,
				})
			: 0;
	const freezeFrameEnd =
		element.type === "video"
			? normalizeFreezeFrameDuration({
					duration: displayedFreezeFrameEnd ?? element.freezeFrameEnd,
				})
			: 0;
	const visibleTimelineDuration = getVisibleTimelineDuration({
		duration: resolvedClipDuration,
		freezeFrameStart,
		freezeFrameEnd,
	});
	const visibleWidthPercent =
		resolvedClipDuration > 0
			? (visibleTimelineDuration / resolvedClipDuration) * 100
			: 100;
	const leftOffsetPercent =
		resolvedClipDuration > 0 ? (freezeFrameStart / resolvedClipDuration) * 100 : 0;
	const shouldShowGrid = showTransparencyGrid || !imageUrl;
	const shouldShowTitle = showTitle || !imageUrl;

	return (
		<div className="relative size-full overflow-hidden">
			{shouldShowGrid && (
				<div
					className="absolute inset-y-0"
					style={{
						backgroundColor: "rgba(255,255,255,0.06)",
						backgroundImage:
							"linear-gradient(45deg, rgba(255,255,255,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.12) 75%)",
						backgroundSize: "16px 16px",
						backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
						left: `${leftOffsetPercent}%`,
						width: `${visibleWidthPercent}%`,
						pointerEvents: "none",
					}}
				/>
			)}
			{imageUrl && (
				<div
					className="absolute inset-y-0"
					style={{
						backgroundImage: `url("${imageUrl}")`,
						backgroundRepeat: "repeat-x",
						backgroundSize: `${tileWidth}px ${trackHeight}px`,
						backgroundPosition: "left center",
						left: `${leftOffsetPercent}%`,
						width: `${visibleWidthPercent}%`,
						pointerEvents: "none",
					}}
				/>
			)}
			{shouldShowTitle && (
				<div className="absolute inset-0 flex items-center justify-center px-2 pointer-events-none">
					<span className="truncate text-xs text-white/90">{element.name}</span>
				</div>
			)}
			{loopExtensionEnd > 0 && (
				<LottieLoopOverlay
					loopExtensionEnd={loopExtensionEnd}
					displayedDuration={resolvedClipDuration}
				/>
			)}
		</div>
	);
}

function EffectsButton({
	element,
	trackId,
	className,
}: {
	element: VisualElement;
	trackId: string;
	className?: string;
}) {
	const openClipEffects = usePropertiesStore((state) => state.openClipEffects);
	const { selectElement } = useElementSelection();

	if (!element.effects?.length) {
		return null;
	}

	const handleClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		selectElement({ elementId: element.id, trackId });
		openClipEffects({ elementId: element.id, trackId });
	};

	return (
		<Button
			variant="text"
			size="icon"
			className={cn("rounded-sm !size-5 bg-black/50 text-white", className)}
			onClick={handleClick}
			onMouseDown={(event) => event.stopPropagation()}
		>
			<HugeiconsIcon icon={MagicWand05Icon} />
		</Button>
	);
}

const ELEMENT_CONTENT_RENDERERS: Record<
	TimelineElementType["type"],
	ElementContentRenderer
> = {
	text: ({ element }) => {
		const textElement = element as Extract<
			TimelineElementType,
			{ type: "text" }
		>;
		return (
			<div className="flex size-full items-center justify-start pl-2">
				<span className="truncate text-xs text-white">
					{textElement.content}
				</span>
			</div>
		);
	},
	effect: ({ element, isSelected }) => {
		const shouldHideLabel =
			(element as EffectElement).effectType === "zoom" && isSelected;

		return (
			<div className="flex size-full items-center justify-start gap-1 pl-2">
				{!shouldHideLabel && (
					<>
						<HugeiconsIcon
							icon={MagicWand05Icon}
							className="size-4 shrink-0 text-white"
						/>
						<span className="truncate text-xs text-white ml-1">{element.name}</span>
					</>
				)}
			</div>
		);
	},
	sticker: ({ element }) => {
		const stickerElement = element as Extract<
			TimelineElementType,
			{ type: "sticker" }
		>;
		return (
			<div className="flex size-full items-center gap-2 pl-2">
				<Image
					src={resolveStickerId({
						stickerId: stickerElement.stickerId,
						options: { width: 20, height: 20 },
					})}
					alt={stickerElement.name}
					className="size-5 shrink-0"
					width={20}
					height={20}
					unoptimized
				/>
				<span className="truncate text-xs text-white">
					{stickerElement.name}
				</span>
			</div>
		);
	},
	audio: ({ element, mediaAssets }) => {
		const audioElement = element as Extract<
			TimelineElementType,
			{ type: "audio" }
		>;
		const audioBuffer =
			audioElement.sourceType === "library" ? audioElement.buffer : undefined;
		const audioUrl =
			audioElement.sourceType === "library"
				? audioElement.sourceUrl
				: mediaAssets.find((asset) => asset.id === audioElement.mediaId)?.url;

		if (audioBuffer || audioUrl) {
			return (
				<div className="flex size-full items-center gap-2">
					<div className="min-w-0 flex-1">
						<AudioWaveform
							audioBuffer={audioBuffer}
							audioUrl={audioUrl}
							height={24}
							className="w-full"
						/>
					</div>
				</div>
			);
		}

		return (
			<span className="text-foreground/80 truncate text-xs">
				{audioElement.name}
			</span>
		);
	},
	video: ({
		element,
		track,
		mediaAssets,
		displayedDuration,
		displayedFreezeFrameStart,
		displayedFreezeFrameEnd,
	}) => {
		const videoElement = element as Extract<
			TimelineElementType,
			{ type: "video" }
		>;
		const mediaAsset = mediaAssets.find(
			(asset) => asset.id === videoElement.mediaId,
		);
		return renderTiledMedia({
			element: videoElement,
			imageUrl: mediaAsset?.thumbnailUrl,
			track,
			clipDuration: displayedDuration,
			displayedFreezeFrameStart,
			displayedFreezeFrameEnd,
		});
	},
	image: ({
	element,
	track,
	mediaAssets,
	displayedDuration,
	displayedTrimStart,
	displayedTrimEnd,
}) => {
		const imageElement = element as Extract<
			TimelineElementType,
			{ type: "image" }
		>;
		const mediaAsset = mediaAssets.find(
			(asset) => asset.id === imageElement.mediaId,
		);
		const isLottie = mediaAsset?.type === "lottie";
		const sourceDuration =
			typeof imageElement.sourceDuration === "number" &&
			Number.isFinite(imageElement.sourceDuration)
				? imageElement.sourceDuration
				: isLottie &&
					  typeof mediaAsset?.duration === "number" &&
					  Number.isFinite(mediaAsset.duration)
					? mediaAsset.duration
				: undefined;
		const visibleSourceDuration =
			typeof sourceDuration === "number"
				? Math.max(0, sourceDuration - displayedTrimStart - displayedTrimEnd)
				: undefined;
		const loopExtensionEnd =
			isLottie && typeof visibleSourceDuration === "number"
				? Math.max(0, displayedDuration - visibleSourceDuration)
				: 0;
		return renderTiledMedia({
			element: imageElement,
			imageUrl:
				isLottie
					? mediaAsset.thumbnailUrl
					: mediaAsset?.url,
			track,
			clipDuration: displayedDuration,
			showTransparencyGrid: isLottie,
			showTitle: isLottie,
			loopExtensionEnd,
		});
	},
};

function ElementContent({
	element,
	track,
	isSelected,
	displayedDuration,
	displayedTrimStart,
	displayedTrimEnd,
	displayedFreezeFrameStart,
	displayedFreezeFrameEnd,
}: ElementContentProps) {
	const editor = useEditor();
	const renderer = ELEMENT_CONTENT_RENDERERS[element.type];
	return (
		<>
			{renderer({
				element,
				track,
				isSelected,
				displayedDuration,
				displayedTrimStart,
				displayedTrimEnd,
				displayedFreezeFrameStart,
				displayedFreezeFrameEnd,
				mediaAssets: editor.media.getAssets(),
			})}
		</>
	);
}

function CopyMenuItem() {
	return (
		<ActionMenuItem
			action="copy-selected"
			icon={<HugeiconsIcon icon={Copy01Icon} />}
		>
			Copy
		</ActionMenuItem>
	);
}

function MuteMenuItem({
	isMultipleSelected,
	isCurrentElementSelected,
	isMuted,
}: {
	isMultipleSelected: boolean;
	isCurrentElementSelected: boolean;
	isMuted: boolean;
}) {
	const getIcon = () => {
		if (isMultipleSelected && isCurrentElementSelected) {
			return <HugeiconsIcon icon={VolumeMute02Icon} />;
		}
		return isMuted ? (
			<HugeiconsIcon icon={VolumeOffIcon} />
		) : (
			<HugeiconsIcon icon={VolumeHighIcon} />
		);
	};

	return (
		<ActionMenuItem action="toggle-elements-muted-selected" icon={getIcon()}>
			{isMuted ? "Unmute" : "Mute"}
		</ActionMenuItem>
	);
}

function VisibilityMenuItem({
	element,
	isMultipleSelected,
	isCurrentElementSelected,
}: {
	element: TimelineElementType;
	isMultipleSelected: boolean;
	isCurrentElementSelected: boolean;
}) {
	const isHidden = canElementBeHidden(element) && element.hidden;

	const getIcon = () => {
		if (isMultipleSelected && isCurrentElementSelected) {
			return <HugeiconsIcon icon={ViewOffSlashIcon} />;
		}
		return isHidden ? (
			<HugeiconsIcon icon={ViewIcon} />
		) : (
			<HugeiconsIcon icon={ViewOffSlashIcon} />
		);
	};

	return (
		<ActionMenuItem
			action="toggle-elements-visibility-selected"
			icon={getIcon()}
		>
			{isHidden ? "Show" : "Hide"}
		</ActionMenuItem>
	);
}

function DeleteMenuItem({
	isMultipleSelected,
	isCurrentElementSelected,
	elementType,
	selectedCount,
}: {
	isMultipleSelected: boolean;
	isCurrentElementSelected: boolean;
	elementType: TimelineElementType["type"];
	selectedCount: number;
}) {
	return (
		<ActionMenuItem
			action="delete-selected"
			variant="destructive"
			icon={<HugeiconsIcon icon={Delete02Icon} />}
		>
			{isMultipleSelected && isCurrentElementSelected
				? `Delete ${selectedCount} elements`
				: `Delete ${elementType === "text" ? "text" : "clip"}`}
		</ActionMenuItem>
	);
}

function ActionMenuItem({
	action,
	children,
	...props
}: Omit<ComponentProps<typeof ContextMenuItem>, "onClick" | "textRight"> & {
	action: TActionWithOptionalArgs;
	children: ReactNode;
}) {
	return (
		<ContextMenuItem
			onClick={(event: React.MouseEvent) => {
				event.stopPropagation();
				invokeAction(action);
			}}
			textRight={getDisplayShortcut({ action })}
			{...props}
		>
			{children}
		</ContextMenuItem>
	);
}
