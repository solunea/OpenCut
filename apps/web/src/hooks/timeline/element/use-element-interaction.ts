import {
	useState,
	useCallback,
	useEffect,
	useRef,
	type MouseEvent as ReactMouseEvent,
	type RefObject,
} from "react";
import type { Command } from "@/lib/commands";
import { useEditor } from "@/hooks/use-editor";
import { useShiftKey } from "@/hooks/use-shift-key";
import { useTimelineStore } from "@/stores/timeline-store";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import {
	DRAG_THRESHOLD_PX,
	TIMELINE_CONSTANTS,
} from "@/constants/timeline-constants";
import { snapTimeToFrame } from "@/lib/time";
import { computeDropTarget } from "@/lib/timeline/drop-utils";
import { getMouseTimeFromClientX } from "@/lib/timeline/drag-utils";
import { generateUUID } from "@/utils/id";
import {
	findSnapPoints,
	snapElementEdge,
	snapToNearestPoint,
	type SnapPoint,
} from "@/lib/timeline/snap-utils";
import {
	BatchCommand,
	MoveElementCommand,
	UpdateElementTrimCommand,
} from "@/lib/commands";
import type {
	DropTarget,
	ElementDragState,
	TimelineElement,
	TimelineTrack,
} from "@/types/timeline";

interface UseElementInteractionProps {
	zoomLevel: number;
	timelineRef: RefObject<HTMLDivElement | null>;
	tracksContainerRef: RefObject<HTMLDivElement | null>;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	headerRef?: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

const MOUSE_BUTTON_RIGHT = 2;

const initialDragState: ElementDragState = {
	isDragging: false,
	elementId: null,
	trackId: null,
	startMouseX: 0,
	startMouseY: 0,
	startElementTime: 0,
	clickOffsetTime: 0,
	currentTime: 0,
	currentMouseY: 0,
	currentFreezeFrameStart: undefined,
	currentFreezeFrameEnd: undefined,
};

interface PendingDragState {
	elementId: string;
	trackId: string;
	startMouseX: number;
	startMouseY: number;
	startElementTime: number;
	clickOffsetTime: number;
	initialFreezeFrameStart?: number;
	initialFreezeFrameEnd?: number;
}

interface DragSnapPreview {
	snappedTime: number;
	snapPoint: SnapPoint | null;
	freezeFrameStart?: number;
	freezeFrameEnd?: number;
}

function getClickOffsetTime({
	clientX,
	elementRect,
	zoomLevel,
}: {
	clientX: number;
	elementRect: DOMRect;
	zoomLevel: number;
}): number {
	const clickOffsetX = clientX - elementRect.left;
	return clickOffsetX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);
}

function getVerticalDragDirection({
	startMouseY,
	currentMouseY,
}: {
	startMouseY: number;
	currentMouseY: number;
}): "up" | "down" | null {
	if (currentMouseY < startMouseY) return "up";
	if (currentMouseY > startMouseY) return "down";
	return null;
}

function getDragDropTarget({
	clientX,
	clientY,
	elementId,
	trackId,
	tracks,
	tracksContainerRef,
	tracksScrollRef,
	headerRef,
	zoomLevel,
	snappedTime,
	verticalDragDirection,
}: {
	clientX: number;
	clientY: number;
	elementId: string;
	trackId: string;
	tracks: TimelineTrack[];
	tracksContainerRef: RefObject<HTMLDivElement | null>;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	headerRef?: RefObject<HTMLElement | null>;
	zoomLevel: number;
	snappedTime: number;
	verticalDragDirection?: "up" | "down" | null;
}): DropTarget | null {
	const containerRect = tracksContainerRef.current?.getBoundingClientRect();
	const scrollContainer = tracksScrollRef.current;
	if (!containerRect || !scrollContainer) return null;

	const sourceTrack = tracks.find(({ id }) => id === trackId);
	const movingElement = sourceTrack?.elements.find(
		({ id }) => id === elementId,
	);
	if (!movingElement) return null;

	const elementDuration = movingElement.duration;
	const scrollLeft = scrollContainer.scrollLeft;
	const scrollTop = scrollContainer.scrollTop;
	const scrollContainerRect = scrollContainer.getBoundingClientRect();
	const headerHeight = headerRef?.current?.getBoundingClientRect().height ?? 0;
	const mouseX = clientX - scrollContainerRect.left + scrollLeft;
	const mouseY = clientY - scrollContainerRect.top + scrollTop - headerHeight;

	return computeDropTarget({
		elementType: movingElement.type,
		mouseX,
		mouseY,
		tracks,
		playheadTime: snappedTime,
		isExternalDrop: false,
		elementDuration,
		pixelsPerSecond: TIMELINE_CONSTANTS.PIXELS_PER_SECOND,
		zoomLevel,
		startTimeOverride: snappedTime,
		excludeElementId: movingElement.id,
		verticalDragDirection,
	});
}

interface StartDragParams
	extends Omit<
		ElementDragState,
		"isDragging" | "currentTime" | "currentMouseY"
	> {
	initialCurrentTime: number;
	initialCurrentMouseY: number;
}

export function useElementInteraction({
	zoomLevel,
	timelineRef,
	tracksContainerRef,
	tracksScrollRef,
	headerRef,
	snappingEnabled,
	onSnapPointChange,
}: UseElementInteractionProps) {
	const editor = useEditor({ subscribeTo: ["timeline", "project"] });
	const rippleEditingEnabled = useTimelineStore((s) => s.rippleEditingEnabled);
	const isShiftHeldRef = useShiftKey();
	const tracks = editor.timeline.getTracks();
	const {
		isElementSelected,
		selectElement,
		handleElementClick: handleSelectionClick,
	} = useElementSelection();

	const [dragState, setDragState] =
		useState<ElementDragState>(initialDragState);
	const [dragDropTarget, setDragDropTarget] = useState<DropTarget | null>(null);
	const [isPendingDrag, setIsPendingDrag] = useState(false);
	const pendingDragRef = useRef<PendingDragState | null>(null);
	const lastMouseXRef = useRef(0);
	const mouseDownLocationRef = useRef<{ x: number; y: number } | null>(null);

	const startDrag = useCallback(
		({
			elementId,
			trackId,
			startMouseX,
			startMouseY,
			startElementTime,
			clickOffsetTime,
			initialCurrentTime,
			initialCurrentMouseY,
			currentFreezeFrameStart,
			currentFreezeFrameEnd,
		}: StartDragParams) => {
			setDragState({
				isDragging: true,
				elementId,
				trackId,
				startMouseX,
				startMouseY,
				startElementTime,
				clickOffsetTime,
				currentTime: initialCurrentTime,
				currentMouseY: initialCurrentMouseY,
				currentFreezeFrameStart,
				currentFreezeFrameEnd,
			});
		},
		[],
	);

	const endDrag = useCallback(() => {
		setDragState(initialDragState);
		setDragDropTarget(null);
	}, []);

	const getDragSnapResult = useCallback(
		({
			frameSnappedTime,
			movingElement,
		}: {
			frameSnappedTime: number;
			movingElement: TimelineElement | null | undefined;
		}): DragSnapPreview => {
			const baseFreezePreview =
				movingElement?.type === "video"
					? {
							freezeFrameStart: movingElement.freezeFrameStart ?? 0,
							freezeFrameEnd: movingElement.freezeFrameEnd ?? 0,
						}
					: {};
			const shouldSnap = snappingEnabled && !isShiftHeldRef.current;
			if (!shouldSnap || !movingElement) {
				return {
					snappedTime: frameSnappedTime,
					snapPoint: null,
					...baseFreezePreview,
				};
			}

			const elementDuration = movingElement.duration;
			const playheadTime = editor.playback.getCurrentTime();
			const snapPoints = findSnapPoints({
				tracks,
				playheadTime,
				excludeElementId: movingElement.id,
			});

			const startSnap = snapElementEdge({
				targetTime: frameSnappedTime,
				elementDuration,
				tracks,
				playheadTime,
				zoomLevel,
				excludeElementId: movingElement.id,
				snapToStart: true,
			});

			const endSnap = snapElementEdge({
				targetTime: frameSnappedTime,
				elementDuration,
				tracks,
				playheadTime,
				zoomLevel,
				excludeElementId: movingElement.id,
				snapToStart: false,
			});

			const candidates = [
				{
					snappedTime: startSnap.snappedTime,
					snapPoint: startSnap.snapPoint,
					snapDistance: startSnap.snapDistance,
					...baseFreezePreview,
				},
				{
					snappedTime: endSnap.snappedTime,
					snapPoint: endSnap.snapPoint,
					snapDistance: endSnap.snapDistance,
					...baseFreezePreview,
				},
			].filter((candidate) => candidate.snapPoint);

			if (movingElement.type === "video") {
				const totalFreeze =
					(movingElement.freezeFrameStart ?? 0) +
					(movingElement.freezeFrameEnd ?? 0);

				if (totalFreeze > 0) {
					const visibleStartSnap = snapToNearestPoint({
						targetTime:
							frameSnappedTime + (movingElement.freezeFrameStart ?? 0),
						snapPoints,
						zoomLevel,
					});
					if (visibleStartSnap.snapPoint) {
						const nextFreezeFrameStart =
							visibleStartSnap.snappedTime - frameSnappedTime;
						if (
							nextFreezeFrameStart >= 0 &&
							nextFreezeFrameStart <= totalFreeze
						) {
							candidates.push({
								snappedTime: frameSnappedTime,
								snapPoint: visibleStartSnap.snapPoint,
								snapDistance: visibleStartSnap.snapDistance,
								freezeFrameStart: nextFreezeFrameStart,
								freezeFrameEnd: totalFreeze - nextFreezeFrameStart,
							});
						}
					}

					const visibleEndSnap = snapToNearestPoint({
						targetTime:
							frameSnappedTime +
							movingElement.duration -
							(movingElement.freezeFrameEnd ?? 0),
						snapPoints,
						zoomLevel,
					});
					if (visibleEndSnap.snapPoint) {
						const nextFreezeFrameEnd =
							frameSnappedTime + movingElement.duration - visibleEndSnap.snappedTime;
						if (nextFreezeFrameEnd >= 0 && nextFreezeFrameEnd <= totalFreeze) {
							candidates.push({
								snappedTime: frameSnappedTime,
								snapPoint: visibleEndSnap.snapPoint,
								snapDistance: visibleEndSnap.snapDistance,
								freezeFrameStart: totalFreeze - nextFreezeFrameEnd,
								freezeFrameEnd: nextFreezeFrameEnd,
							});
						}
					}
				}
			}

			if (candidates.length === 0) {
				return {
					snappedTime: frameSnappedTime,
					snapPoint: null,
					...baseFreezePreview,
				};
			}

			candidates.sort((left, right) => left.snapDistance - right.snapDistance);
			return candidates[0];
		},
		[snappingEnabled, editor.playback, tracks, zoomLevel, isShiftHeldRef],
	);

	useEffect(() => {
		if (!dragState.isDragging && !isPendingDrag) return;

		const handleMouseMove = ({ clientX, clientY }: MouseEvent) => {
			let startedDragThisEvent = false;
			const timeline = timelineRef.current;
			const scrollContainer = tracksScrollRef.current;
			if (!timeline || !scrollContainer) return;
			lastMouseXRef.current = clientX;

			if (isPendingDrag && pendingDragRef.current) {
				const deltaX = Math.abs(clientX - pendingDragRef.current.startMouseX);
				const deltaY = Math.abs(clientY - pendingDragRef.current.startMouseY);
				if (deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX) {
					const activeProject = editor.project.getActive();
					if (!activeProject) return;
					const scrollLeft = scrollContainer.scrollLeft;
					const mouseTime = getMouseTimeFromClientX({
						clientX,
						containerRect: scrollContainer.getBoundingClientRect(),
						zoomLevel,
						scrollLeft,
					});
					const adjustedTime = Math.max(
						0,
						mouseTime - pendingDragRef.current.clickOffsetTime,
					);
					const snappedTime = snapTimeToFrame({
						time: adjustedTime,
						fps: activeProject.settings.fps,
					});
					startDrag({
						...pendingDragRef.current,
						initialCurrentTime: snappedTime,
						initialCurrentMouseY: clientY,
						currentFreezeFrameStart:
							pendingDragRef.current.initialFreezeFrameStart,
						currentFreezeFrameEnd:
							pendingDragRef.current.initialFreezeFrameEnd,
					});
					startedDragThisEvent = true;
					pendingDragRef.current = null;
					setIsPendingDrag(false);
				} else {
					return;
				}
			}

			if (startedDragThisEvent) {
				return;
			}

			if (dragState.elementId && dragState.trackId) {
				const alreadySelected = isElementSelected({
					trackId: dragState.trackId,
					elementId: dragState.elementId,
				});
				if (!alreadySelected) {
					selectElement({
						trackId: dragState.trackId,
						elementId: dragState.elementId,
					});
				}
			}

			const activeProject = editor.project.getActive();
			if (!activeProject) return;

			const scrollLeft = scrollContainer.scrollLeft;
			const mouseTime = getMouseTimeFromClientX({
				clientX,
				containerRect: scrollContainer.getBoundingClientRect(),
				zoomLevel,
				scrollLeft,
			});
			const adjustedTime = Math.max(0, mouseTime - dragState.clickOffsetTime);
			const fps = activeProject.settings.fps;
			const frameSnappedTime = snapTimeToFrame({ time: adjustedTime, fps });

			const sourceTrack = tracks.find(({ id }) => id === dragState.trackId);
			const movingElement = sourceTrack?.elements.find(
				({ id }) => id === dragState.elementId,
			);
			const { snappedTime, snapPoint, freezeFrameStart, freezeFrameEnd } =
				getDragSnapResult({
				frameSnappedTime,
				movingElement,
			});
			setDragState((previousDragState) => ({
				...previousDragState,
				currentTime: snappedTime,
				currentMouseY: clientY,
				currentFreezeFrameStart: freezeFrameStart,
				currentFreezeFrameEnd: freezeFrameEnd,
			}));
			onSnapPointChange?.(snapPoint);

			if (dragState.elementId && dragState.trackId) {
				const verticalDragDirection = getVerticalDragDirection({
					startMouseY: dragState.startMouseY,
					currentMouseY: clientY,
				});
				const dropTarget = getDragDropTarget({
					clientX,
					clientY,
					elementId: dragState.elementId,
					trackId: dragState.trackId,
					tracks,
					tracksContainerRef,
					tracksScrollRef,
					headerRef,
					zoomLevel,
					snappedTime,
					verticalDragDirection,
				});
				setDragDropTarget(dropTarget?.isNewTrack ? dropTarget : null);
			}
		};

		document.addEventListener("mousemove", handleMouseMove);
		return () => document.removeEventListener("mousemove", handleMouseMove);
	}, [
		dragState.isDragging,
		dragState.clickOffsetTime,
		dragState.elementId,
		dragState.startMouseY,
		dragState.trackId,
		zoomLevel,
		isElementSelected,
		selectElement,
		editor.project,
		timelineRef,
		tracksScrollRef,
		tracksContainerRef,
		headerRef,
		tracks,
		isPendingDrag,
		startDrag,
		getDragSnapResult,
		onSnapPointChange,
	]);

	useEffect(() => {
		if (!dragState.isDragging) return;

		const handleMouseUp = ({ clientX, clientY }: MouseEvent) => {
			if (!dragState.elementId || !dragState.trackId) return;

			if (mouseDownLocationRef.current) {
				const deltaX = Math.abs(clientX - mouseDownLocationRef.current.x);
				const deltaY = Math.abs(clientY - mouseDownLocationRef.current.y);
				if (deltaX <= DRAG_THRESHOLD_PX && deltaY <= DRAG_THRESHOLD_PX) {
					mouseDownLocationRef.current = null;
					endDrag();
					onSnapPointChange?.(null);
					return;
				}
			}

			const dropTarget = getDragDropTarget({
				clientX,
				clientY,
				elementId: dragState.elementId,
				trackId: dragState.trackId,
				tracks,
				tracksContainerRef,
				tracksScrollRef,
				headerRef,
				zoomLevel,
				snappedTime: dragState.currentTime,
				verticalDragDirection: getVerticalDragDirection({
					startMouseY: dragState.startMouseY,
					currentMouseY: clientY,
				}),
			});
			if (!dropTarget) {
				endDrag();
				onSnapPointChange?.(null);
				return;
			}
			const snappedTime = dragState.currentTime;

			const sourceTrack = tracks.find(({ id }) => id === dragState.trackId);
			if (!sourceTrack) {
				endDrag();
				onSnapPointChange?.(null);
				return;
			}

			const movedElement = sourceTrack.elements.find(
				({ id }) => id === dragState.elementId,
			);
			if (!movedElement) {
				endDrag();
				onSnapPointChange?.(null);
				return;
			}

			const targetTrackId = dropTarget.isNewTrack
				? generateUUID()
				: tracks[dropTarget.trackIndex]?.id;
			if (!targetTrackId) {
				endDrag();
				onSnapPointChange?.(null);
				return;
			}

			const commands: Command[] = [
				new MoveElementCommand({
					sourceTrackId: dragState.trackId,
					targetTrackId,
					elementId: dragState.elementId,
					newStartTime: snappedTime,
					createTrack: dropTarget.isNewTrack
						? { type: sourceTrack.type, index: dropTarget.trackIndex }
						: undefined,
					rippleEnabled: rippleEditingEnabled,
				}),
			];

			if (movedElement.type === "video") {
				const currentFreezeFrameStart =
					dragState.currentFreezeFrameStart ?? movedElement.freezeFrameStart ?? 0;
				const currentFreezeFrameEnd =
					dragState.currentFreezeFrameEnd ?? movedElement.freezeFrameEnd ?? 0;
				if (
					currentFreezeFrameStart !== (movedElement.freezeFrameStart ?? 0) ||
					currentFreezeFrameEnd !== (movedElement.freezeFrameEnd ?? 0)
				) {
					commands.push(
						new UpdateElementTrimCommand({
							elementId: dragState.elementId,
							trimStart: movedElement.trimStart,
							trimEnd: movedElement.trimEnd,
							freezeFrameStart: currentFreezeFrameStart,
							freezeFrameEnd: currentFreezeFrameEnd,
						}),
					);
				}
			}

			editor.command.execute({
				command:
					commands.length === 1 ? commands[0] : new BatchCommand(commands),
			});

			if (targetTrackId !== dragState.trackId) {
				selectElement({ trackId: targetTrackId, elementId: dragState.elementId });
			}

			endDrag();
			onSnapPointChange?.(null);
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [
		dragState.isDragging,
		dragState.elementId,
		dragState.startMouseY,
		dragState.trackId,
		dragState.currentTime,
		zoomLevel,
		tracks,
		endDrag,
		onSnapPointChange,
		editor.timeline,
		tracksContainerRef,
		tracksScrollRef,
		headerRef,
		rippleEditingEnabled,
		selectElement,
	]);

	useEffect(() => {
		if (!isPendingDrag) return;

		const handleMouseUp = () => {
			pendingDragRef.current = null;
			setIsPendingDrag(false);
			onSnapPointChange?.(null);
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [isPendingDrag, onSnapPointChange]);

	const handleElementMouseDown = useCallback(
		({
			event,
			element,
			track,
		}: {
			event: ReactMouseEvent;
			element: TimelineElement;
			track: TimelineTrack;
		}) => {
		const isRightClick = event.button === MOUSE_BUTTON_RIGHT;

		// right-click: don't stop propagation so ContextMenu can open
		if (isRightClick) {
				const alreadySelected = isElementSelected({
					trackId: track.id,
					elementId: element.id,
				});
				if (!alreadySelected) {
					handleSelectionClick({
						trackId: track.id,
						elementId: element.id,
						isMultiKey: false,
					});
				}
				return;
			}

		event.stopPropagation();
		mouseDownLocationRef.current = { x: event.clientX, y: event.clientY };

		const isMultiSelect = event.metaKey || event.ctrlKey || event.shiftKey;

		if (isMultiSelect) {
				handleSelectionClick({
					trackId: track.id,
					elementId: element.id,
					isMultiKey: true,
				});
			}

		const clickOffsetTime = getClickOffsetTime({
				clientX: event.clientX,
				elementRect: event.currentTarget.getBoundingClientRect(),
				zoomLevel,
			});
			pendingDragRef.current = {
				elementId: element.id,
				trackId: track.id,
				startMouseX: event.clientX,
				startMouseY: event.clientY,
				startElementTime: element.startTime,
				clickOffsetTime,
				initialFreezeFrameStart:
					element.type === "video" ? element.freezeFrameStart ?? 0 : undefined,
				initialFreezeFrameEnd:
					element.type === "video" ? element.freezeFrameEnd ?? 0 : undefined,
			};
			setIsPendingDrag(true);
		},
		[zoomLevel, isElementSelected, handleSelectionClick],
	);

	const handleElementClick = useCallback(
		({
			event,
			element,
			track,
		}: {
			event: ReactMouseEvent;
			element: TimelineElement;
			track: TimelineTrack;
		}) => {
		event.stopPropagation();

		if (mouseDownLocationRef.current) {
				const deltaX = Math.abs(event.clientX - mouseDownLocationRef.current.x);
				const deltaY = Math.abs(event.clientY - mouseDownLocationRef.current.y);
				if (deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX) {
					mouseDownLocationRef.current = null;
					return;
				}
			}

			// modifier keys already handled in mousedown
			if (event.metaKey || event.ctrlKey || event.shiftKey) return;

		const alreadySelected = isElementSelected({
				trackId: track.id,
				elementId: element.id,
			});
			if (!alreadySelected) {
				selectElement({ trackId: track.id, elementId: element.id });
				return;
			}

			editor.selection.clearKeyframeSelection();
		},
		[editor.selection, isElementSelected, selectElement],
	);

	return {
		dragState,
		dragDropTarget,
		handleElementMouseDown,
		handleElementClick,
		lastMouseXRef,
	};
}
