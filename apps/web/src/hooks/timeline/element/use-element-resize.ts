import { useState, useEffect, useRef, useCallback } from "react";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { snapTimeToFrame } from "@/lib/time";
import type { TimelineElement, TimelineTrack } from "@/types/timeline";
import { useEditor } from "@/hooks/use-editor";
import { useShiftKey } from "@/hooks/use-shift-key";
import {
	findSnapPoints,
	snapToNearestPoint,
	type SnapPoint,
} from "@/lib/timeline/snap-utils";
import {
	getSourceDuration,
	normalizePlaybackRate,
} from "@/lib/timeline/clip-speed";
import { useTimelineStore } from "@/stores/timeline-store";

export interface ResizeState {
	elementId: string;
	side: "left" | "right";
	startX: number;
	initialTrimStart: number;
	initialTrimEnd: number;
	initialFreezeFrameStart: number;
	initialFreezeFrameEnd: number;
	initialStartTime: number;
	initialDuration: number;
}

interface UseTimelineElementResizeProps {
	element: TimelineElement;
	track: TimelineTrack;
	zoomLevel: number;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
	onResizeStateChange?: (params: { isResizing: boolean }) => void;
}

export function useTimelineElementResize({
	element,
	track,
	zoomLevel,
	onSnapPointChange,
	onResizeStateChange,
}: UseTimelineElementResizeProps) {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const isShiftHeldRef = useShiftKey();
	const snappingEnabled = useTimelineStore((state) => state.snappingEnabled);
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	const [resizing, setResizing] = useState<ResizeState | null>(null);
	const [currentTrimStart, setCurrentTrimStart] = useState(element.trimStart);
	const [currentTrimEnd, setCurrentTrimEnd] = useState(element.trimEnd);
	const [currentFreezeFrameStart, setCurrentFreezeFrameStart] = useState(
		element.type === "video" ? element.freezeFrameStart ?? 0 : 0,
	);
	const [currentFreezeFrameEnd, setCurrentFreezeFrameEnd] = useState(
		element.type === "video" ? element.freezeFrameEnd ?? 0 : 0,
	);
	const [currentStartTime, setCurrentStartTime] = useState(element.startTime);
	const [currentDuration, setCurrentDuration] = useState(element.duration);
	const currentTrimStartRef = useRef(element.trimStart);
	const currentTrimEndRef = useRef(element.trimEnd);
	const currentFreezeFrameStartRef = useRef(
		element.type === "video" ? element.freezeFrameStart ?? 0 : 0,
	);
	const currentFreezeFrameEndRef = useRef(
		element.type === "video" ? element.freezeFrameEnd ?? 0 : 0,
	);
	const currentStartTimeRef = useRef(element.startTime);
	const currentDurationRef = useRef(element.duration);

	const handleResizeStart = ({
		event,
		elementId,
		side,
	}: {
		event: React.MouseEvent;
		elementId: string;
		side: "left" | "right";
	}) => {
		event.stopPropagation();
		event.preventDefault();

		setResizing({
			elementId,
			side,
			startX: event.clientX,
			initialTrimStart: element.trimStart,
			initialTrimEnd: element.trimEnd,
			initialFreezeFrameStart:
				element.type === "video" ? element.freezeFrameStart ?? 0 : 0,
			initialFreezeFrameEnd:
				element.type === "video" ? element.freezeFrameEnd ?? 0 : 0,
			initialStartTime: element.startTime,
			initialDuration: element.duration,
		});

		setCurrentTrimStart(element.trimStart);
		setCurrentTrimEnd(element.trimEnd);
		setCurrentFreezeFrameStart(
			element.type === "video" ? element.freezeFrameStart ?? 0 : 0,
		);
		setCurrentFreezeFrameEnd(
			element.type === "video" ? element.freezeFrameEnd ?? 0 : 0,
		);
		setCurrentStartTime(element.startTime);
		setCurrentDuration(element.duration);
		currentTrimStartRef.current = element.trimStart;
		currentTrimEndRef.current = element.trimEnd;
		currentFreezeFrameStartRef.current =
			element.type === "video" ? element.freezeFrameStart ?? 0 : 0;
		currentFreezeFrameEndRef.current =
			element.type === "video" ? element.freezeFrameEnd ?? 0 : 0;
		currentStartTimeRef.current = element.startTime;
		currentDurationRef.current = element.duration;
		onResizeStateChange?.({ isResizing: true });
	};

	const canExtendElementDuration = useCallback(() => {
		return element.sourceDuration == null || element.type === "video";
	}, [element.sourceDuration, element.type]);

	const updateTrimFromMouseMove = useCallback(
		({ clientX }: { clientX: number }) => {
			if (!resizing) return;

			const deltaX = clientX - resizing.startX;
			let deltaTime =
				deltaX / (TIMELINE_CONSTANTS.PIXELS_PER_SECOND * zoomLevel);
			let resizeSnapPoint: SnapPoint | null = null;

			const projectFps = activeProject.settings.fps;
			const minDurationSeconds = 1 / projectFps;
			const shouldSnap = snappingEnabled && !isShiftHeldRef.current;
			if (shouldSnap) {
				const tracks = editor.timeline.getTracks();
				const playheadTime = editor.playback.getCurrentTime();
				const snapPoints = findSnapPoints({
					tracks,
					playheadTime,
					excludeElementId: element.id,
				});
				if (resizing.side === "left") {
					const targetStartTime = resizing.initialStartTime + deltaTime;
					const snapResult = snapToNearestPoint({
						targetTime: targetStartTime,
						snapPoints,
						zoomLevel,
					});
					resizeSnapPoint = snapResult.snapPoint;
					if (snapResult.snapPoint) {
						deltaTime = snapResult.snappedTime - resizing.initialStartTime;
					}
				} else {
					const baseEndTime =
						resizing.initialStartTime + resizing.initialDuration;
					const targetEndTime = baseEndTime + deltaTime;
					const snapResult = snapToNearestPoint({
						targetTime: targetEndTime,
						snapPoints,
						zoomLevel,
					});
					resizeSnapPoint = snapResult.snapPoint;
					if (snapResult.snapPoint) {
						deltaTime = snapResult.snappedTime - baseEndTime;
					}
				}
			}
			onSnapPointChange?.(resizeSnapPoint);

			const otherElements = track.elements.filter(({ id }) => id !== element.id);
			const initialEndTime = resizing.initialStartTime + resizing.initialDuration;
			const playbackRate =
				"playbackRate" in element
					? normalizePlaybackRate({ playbackRate: element.playbackRate })
					: 1;
			const sourceDuration = getSourceDuration({
				sourceDuration: element.sourceDuration,
				trimStart: resizing.initialTrimStart,
				trimEnd: resizing.initialTrimEnd,
				duration: resizing.initialDuration,
				playbackRate,
			});

			const rightNeighborBound =
				resizing.side === "right"
					? otherElements
							.filter(({ startTime }) => startTime >= initialEndTime)
							.reduce((min, { startTime }) => Math.min(min, startTime), Infinity)
					: Infinity;

			const leftNeighborBound =
				resizing.side === "left"
					? otherElements
							.filter(
								({ startTime, duration }) =>
									startTime + duration <= resizing.initialStartTime,
							)
							.reduce(
								(max, { startTime, duration }) =>
									Math.max(max, startTime + duration),
								-Infinity,
							)
					: -Infinity;

			if (element.type === "video") {
				if (resizing.side === "left") {
					const minStartTime = Number.isFinite(leftNeighborBound)
						? Math.max(0, leftNeighborBound)
						: 0;
					const maxTrimStart =
						sourceDuration -
						resizing.initialTrimEnd -
						minDurationSeconds * playbackRate;
					const maxPositiveShift =
						resizing.initialFreezeFrameStart +
						Math.max(0, maxTrimStart - resizing.initialTrimStart) / playbackRate;
					const targetStartTime = Math.min(
						resizing.initialStartTime + maxPositiveShift,
						Math.max(minStartTime, resizing.initialStartTime + deltaTime),
					);
					const nextStartTime = snapTimeToFrame({
						time: targetStartTime,
						fps: projectFps,
					});
					const actualShift = nextStartTime - resizing.initialStartTime;
					const consumeFreeze = Math.min(
						resizing.initialFreezeFrameStart,
						Math.max(0, actualShift),
					);
					const trimIncreaseTimeline = Math.max(0, actualShift - consumeFreeze);
					const revealTimeline = Math.min(
						resizing.initialTrimStart / playbackRate,
						Math.max(0, -actualShift),
					);
					const freezeIncrease = Math.max(0, -actualShift - revealTimeline);
					const newFreezeFrameStart = Math.max(
						0,
						resizing.initialFreezeFrameStart - consumeFreeze + freezeIncrease,
					);
					const newTrimStart = Math.min(
						maxTrimStart,
						Math.max(
							0,
							resizing.initialTrimStart +
								(trimIncreaseTimeline - revealTimeline) * playbackRate,
						),
					);
					const newDuration = snapTimeToFrame({
						time: resizing.initialStartTime + resizing.initialDuration - nextStartTime,
						fps: projectFps,
					});

					setCurrentTrimStart(newTrimStart);
					setCurrentFreezeFrameStart(newFreezeFrameStart);
					setCurrentStartTime(nextStartTime);
					setCurrentDuration(newDuration);
					currentTrimStartRef.current = newTrimStart;
					currentFreezeFrameStartRef.current = newFreezeFrameStart;
					currentStartTimeRef.current = nextStartTime;
					currentDurationRef.current = newDuration;
					return;
				}

				const maxAllowedDuration = Number.isFinite(rightNeighborBound)
					? rightNeighborBound - resizing.initialStartTime
					: Infinity;
				const maxTrimEnd =
					sourceDuration -
					resizing.initialTrimStart -
					minDurationSeconds * playbackRate;
				const maxShrink =
					resizing.initialFreezeFrameEnd +
					Math.max(0, maxTrimEnd - resizing.initialTrimEnd) / playbackRate;
				const minDuration = Math.max(
					minDurationSeconds,
					resizing.initialDuration - maxShrink,
				);
				const targetDuration = Math.min(
					maxAllowedDuration,
					Math.max(minDuration, resizing.initialDuration + deltaTime),
				);
				const nextDuration = snapTimeToFrame({
					time: targetDuration,
					fps: projectFps,
				});
				const actualDelta = nextDuration - resizing.initialDuration;
				const revealTimeline = Math.min(
					resizing.initialTrimEnd / playbackRate,
					Math.max(0, actualDelta),
				);
				const freezeIncrease = Math.max(0, actualDelta - revealTimeline);
				const consumeFreeze = Math.min(
					resizing.initialFreezeFrameEnd,
					Math.max(0, -actualDelta),
				);
				const trimIncreaseTimeline = Math.max(0, -actualDelta - consumeFreeze);
				const newFreezeFrameEnd = Math.max(
					0,
					resizing.initialFreezeFrameEnd + freezeIncrease - consumeFreeze,
				);
				const newTrimEnd = Math.min(
					maxTrimEnd,
					Math.max(
						0,
						resizing.initialTrimEnd +
							(trimIncreaseTimeline - revealTimeline) * playbackRate,
					),
				);

				setCurrentTrimEnd(newTrimEnd);
				setCurrentFreezeFrameEnd(newFreezeFrameEnd);
				setCurrentDuration(nextDuration);
				currentTrimEndRef.current = newTrimEnd;
				currentFreezeFrameEndRef.current = newFreezeFrameEnd;
				currentDurationRef.current = nextDuration;
				return;
			}

			if (resizing.side === "left") {
				const minVisibleSourceDuration = minDurationSeconds * playbackRate;
				const minTrimStartForNeighbor = Number.isFinite(leftNeighborBound)
					? Math.max(
							0,
							resizing.initialTrimStart +
								(leftNeighborBound - resizing.initialStartTime) * playbackRate,
						)
					: 0;
				const maxAllowed =
					sourceDuration - resizing.initialTrimEnd - minVisibleSourceDuration;
				const calculated = resizing.initialTrimStart + deltaTime * playbackRate;

				if (calculated >= 0 && calculated <= maxAllowed) {
					const nextTrimStart = Math.min(
						maxAllowed,
						Math.max(minTrimStartForNeighbor, calculated),
					);
					const trimDelta =
						(nextTrimStart - resizing.initialTrimStart) / playbackRate;
					const newStartTime = snapTimeToFrame({
						time: resizing.initialStartTime + trimDelta,
						fps: projectFps,
					});
					const newDuration = snapTimeToFrame({
						time: resizing.initialDuration - trimDelta,
						fps: projectFps,
					});
					const newTrimStart =
						resizing.initialTrimStart +
						(newStartTime - resizing.initialStartTime) * playbackRate;

					setCurrentTrimStart(newTrimStart);
					setCurrentStartTime(newStartTime);
					setCurrentDuration(newDuration);
					currentTrimStartRef.current = newTrimStart;
					currentStartTimeRef.current = newStartTime;
					currentDurationRef.current = newDuration;
				} else if (calculated < 0) {
					if (canExtendElementDuration()) {
						const extensionAmount = Math.abs(calculated) / playbackRate;
						const maxExtension = resizing.initialStartTime;
						const actualExtension = Math.max(
							0,
							Number.isFinite(leftNeighborBound)
								? Math.min(
										extensionAmount,
										maxExtension,
										resizing.initialStartTime - leftNeighborBound,
									)
								: Math.min(extensionAmount, maxExtension),
						);
						const newStartTime = snapTimeToFrame({
							time: resizing.initialStartTime - actualExtension,
							fps: projectFps,
						});
						const newDuration = snapTimeToFrame({
							time: resizing.initialDuration + actualExtension,
							fps: projectFps,
						});

						setCurrentTrimStart(0);
						setCurrentStartTime(newStartTime);
						setCurrentDuration(newDuration);
						currentTrimStartRef.current = 0;
						currentStartTimeRef.current = newStartTime;
						currentDurationRef.current = newDuration;
					} else {
						const trimDelta =
							(minTrimStartForNeighbor - resizing.initialTrimStart) /
							playbackRate;
						const newStartTime = snapTimeToFrame({
							time: resizing.initialStartTime + trimDelta,
							fps: projectFps,
						});
						const newDuration = snapTimeToFrame({
							time: resizing.initialDuration - trimDelta,
							fps: projectFps,
						});
						const newTrimStart =
							resizing.initialTrimStart +
							(newStartTime - resizing.initialStartTime) * playbackRate;

						setCurrentTrimStart(newTrimStart);
						setCurrentStartTime(newStartTime);
						setCurrentDuration(newDuration);
						currentTrimStartRef.current = newTrimStart;
						currentStartTimeRef.current = newStartTime;
						currentDurationRef.current = newDuration;
					}
				}
			} else {
				const newTrimEnd = resizing.initialTrimEnd - deltaTime * playbackRate;
				const maxAllowedDuration = Number.isFinite(rightNeighborBound)
					? rightNeighborBound - resizing.initialStartTime
					: Infinity;

				if (newTrimEnd < 0) {
					if (canExtendElementDuration()) {
						const extensionNeeded = Math.abs(newTrimEnd) / playbackRate;
						const baseDuration =
							resizing.initialDuration +
							resizing.initialTrimEnd / playbackRate;
						const newDuration = snapTimeToFrame({
							time: Math.min(baseDuration + extensionNeeded, maxAllowedDuration),
							fps: projectFps,
						});

						setCurrentDuration(newDuration);
						setCurrentTrimEnd(0);
						currentDurationRef.current = newDuration;
						currentTrimEndRef.current = 0;
					} else {
						const extensionToLimit = resizing.initialTrimEnd / playbackRate;
						const newDuration = snapTimeToFrame({
							time: Math.min(
								resizing.initialDuration + extensionToLimit,
								maxAllowedDuration,
							),
							fps: projectFps,
						});

						setCurrentDuration(newDuration);
						setCurrentTrimEnd(0);
						currentDurationRef.current = newDuration;
						currentTrimEndRef.current = 0;
					}
				} else {
					const minTrimEndForNeighbor = Number.isFinite(maxAllowedDuration)
						? Math.max(
								0,
								sourceDuration -
									resizing.initialTrimStart -
									maxAllowedDuration * playbackRate,
							)
						: 0;
					const maxTrimEnd =
						sourceDuration -
						resizing.initialTrimStart -
						minDurationSeconds * playbackRate;
					const clampedTrimEnd = Math.min(
						maxTrimEnd,
						Math.max(minTrimEndForNeighbor, newTrimEnd),
					);
					const nextDuration = snapTimeToFrame({
						time:
							(sourceDuration - resizing.initialTrimStart - clampedTrimEnd) /
							playbackRate,
						fps: projectFps,
					});
					const finalTrimEnd =
						sourceDuration -
						resizing.initialTrimStart -
						nextDuration * playbackRate;
					const newDuration = snapTimeToFrame({
						time: nextDuration,
						fps: projectFps,
					});

					setCurrentTrimEnd(finalTrimEnd);
					setCurrentDuration(newDuration);
					currentTrimEndRef.current = finalTrimEnd;
					currentDurationRef.current = newDuration;
				}
			}
		},
		[
			resizing,
			zoomLevel,
			activeProject.settings.fps,
			snappingEnabled,
			editor,
			element.id,
			track.elements,
			onSnapPointChange,
			canExtendElementDuration,
			isShiftHeldRef,
		],
	);

	const handleResizeEnd = useCallback(() => {
		if (!resizing) return;

		const finalTrimStart = currentTrimStartRef.current;
		const finalTrimEnd = currentTrimEndRef.current;
		const finalFreezeFrameStart = currentFreezeFrameStartRef.current;
		const finalFreezeFrameEnd = currentFreezeFrameEndRef.current;
		const finalStartTime = currentStartTimeRef.current;
		const finalDuration = currentDurationRef.current;
		const trimStartChanged = finalTrimStart !== resizing.initialTrimStart;
		const trimEndChanged = finalTrimEnd !== resizing.initialTrimEnd;
		const freezeFrameStartChanged =
			finalFreezeFrameStart !== resizing.initialFreezeFrameStart;
		const freezeFrameEndChanged =
			finalFreezeFrameEnd !== resizing.initialFreezeFrameEnd;
		const startTimeChanged = finalStartTime !== resizing.initialStartTime;
		const durationChanged = finalDuration !== resizing.initialDuration;

		if (
			trimStartChanged ||
			trimEndChanged ||
			freezeFrameStartChanged ||
			freezeFrameEndChanged ||
			startTimeChanged ||
			durationChanged
		) {
			editor.timeline.updateElementTrim({
				elementId: element.id,
				trimStart: finalTrimStart,
				trimEnd: finalTrimEnd,
				freezeFrameStart:
					element.type === "video" ? finalFreezeFrameStart : undefined,
				freezeFrameEnd:
					element.type === "video" ? finalFreezeFrameEnd : undefined,
				startTime: startTimeChanged ? finalStartTime : undefined,
				duration: durationChanged ? finalDuration : undefined,
				rippleEnabled: rippleEditingEnabled,
			});
		}

		setResizing(null);
		onResizeStateChange?.({ isResizing: false });
		onSnapPointChange?.(null);
	}, [
		resizing,
		editor.timeline,
		element.id,
		onResizeStateChange,
		onSnapPointChange,
		rippleEditingEnabled,
	]);

	useEffect(() => {
		if (!resizing) return;

		const handleDocumentMouseMove = ({ clientX }: MouseEvent) => {
			updateTrimFromMouseMove({ clientX });
		};

		const handleDocumentMouseUp = () => {
			handleResizeEnd();
		};

		document.addEventListener("mousemove", handleDocumentMouseMove);
		document.addEventListener("mouseup", handleDocumentMouseUp);

		return () => {
			document.removeEventListener("mousemove", handleDocumentMouseMove);
			document.removeEventListener("mouseup", handleDocumentMouseUp);
		};
	}, [resizing, handleResizeEnd, updateTrimFromMouseMove]);

	return {
		resizing,
		isResizing: resizing !== null,
		handleResizeStart,
		currentTrimStart,
		currentTrimEnd,
		currentFreezeFrameStart,
		currentFreezeFrameEnd,
		currentStartTime,
		currentDuration,
	};
}
