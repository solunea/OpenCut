"use client";

import { toast } from "sonner";
import { applyCursorTrackingToZoomEffect } from "@/lib/effects/cursor-follow";
import { parseRecordedCursorFile } from "@/lib/media/recorded-cursor";
import { buildReplaceMediaUpdates } from "@/lib/timeline/replace-media";
import { buildTransitionApplication } from "@/lib/transitions";
import { useActionHandler } from "@/hooks/actions/use-action-handler";
import { useKeyframeSelection } from "../timeline/element/use-keyframe-selection";
import { useElementSelection } from "../timeline/element/use-element-selection";
import { useEditor } from "../use-editor";
import { getElementsAtTime } from "@/lib/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import { useAssetsPanelStore } from "@/stores/assets-panel-store";
import { downloadBlob } from "@/utils/browser";

export function useEditorActions() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const { selectedElements, setElementSelection } = useElementSelection();
	const { selectedKeyframes, clearKeyframeSelection } = useKeyframeSelection();
	const clipboard = useTimelineStore((s) => s.clipboard);
	const setClipboard = useTimelineStore((s) => s.setClipboard);
	const toggleSnapping = useTimelineStore((s) => s.toggleSnapping);
	const rippleEditingEnabled = useTimelineStore((s) => s.rippleEditingEnabled);
	const toggleRippleEditing = useTimelineStore((s) => s.toggleRippleEditing);
	const clearReplaceMediaRequest = useAssetsPanelStore(
		(s) => s.clearReplaceMediaRequest,
	);

	useActionHandler(
		"toggle-play",
		() => {
			editor.playback.toggle();
		},
		undefined,
	);

	useActionHandler(
		"stop-playback",
		() => {
			if (editor.playback.getIsPlaying()) {
				editor.playback.toggle();
			}
			editor.playback.seek({ time: 0 });
		},
		undefined,
	);

	useActionHandler(
		"seek-forward",
		(args) => {
			const seconds = args?.seconds ?? 1;
			editor.playback.seek({
				time: Math.min(
					editor.timeline.getTotalDuration(),
					editor.playback.getCurrentTime() + seconds,
				),
			});
		},
		undefined,
	);

	useActionHandler(
		"seek-backward",
		(args) => {
			const seconds = args?.seconds ?? 1;
			editor.playback.seek({
				time: Math.max(0, editor.playback.getCurrentTime() - seconds),
			});
		},
		undefined,
	);

	useActionHandler(
		"frame-step-forward",
		() => {
			const fps = activeProject.settings.fps;
			editor.playback.seek({
				time: Math.min(
					editor.timeline.getTotalDuration(),
					editor.playback.getCurrentTime() + 1 / fps,
				),
			});
		},
		undefined,
	);

	useActionHandler(
		"frame-step-backward",
		() => {
			const fps = activeProject.settings.fps;
			editor.playback.seek({
				time: Math.max(0, editor.playback.getCurrentTime() - 1 / fps),
			});
		},
		undefined,
	);

	useActionHandler(
		"jump-forward",
		(args) => {
			const seconds = args?.seconds ?? 5;
			editor.playback.seek({
				time: Math.min(
					editor.timeline.getTotalDuration(),
					editor.playback.getCurrentTime() + seconds,
				),
			});
		},
		undefined,
	);

	useActionHandler(
		"jump-backward",
		(args) => {
			const seconds = args?.seconds ?? 5;
			editor.playback.seek({
				time: Math.max(0, editor.playback.getCurrentTime() - seconds),
			});
		},
		undefined,
	);

	useActionHandler(
		"goto-start",
		() => {
			editor.playback.seek({ time: 0 });
		},
		undefined,
	);

	useActionHandler(
		"goto-end",
		() => {
			editor.playback.seek({ time: editor.timeline.getTotalDuration() });
		},
		undefined,
	);

	useActionHandler(
		"split",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const elementsToSplit =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});

			if (elementsToSplit.length === 0) return;

			editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
			});
		},
		undefined,
	);

	useActionHandler(
		"split-left",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const elementsToSplit =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});

			if (elementsToSplit.length === 0) return;

			const rightSideElements = editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
				retainSide: "right",
				rippleEnabled: rippleEditingEnabled,
			});

			if (rippleEditingEnabled && rightSideElements.length > 0) {
				const firstRightElement = editor.timeline.getElementsWithTracks({
					elements: [rightSideElements[0]],
				})[0];
				if (firstRightElement) {
					editor.playback.seek({ time: firstRightElement.element.startTime });
				}
			}
		},
		undefined,
	);

	useActionHandler(
		"split-right",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const elementsToSplit =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});

			if (elementsToSplit.length === 0) return;

			editor.timeline.splitElements({
				elements: elementsToSplit,
				splitTime: currentTime,
				retainSide: "left",
			});
		},
		undefined,
	);

	useActionHandler(
		"freeze-frame",
		() => {
			const currentTime = editor.playback.getCurrentTime();
			const candidateElements =
				selectedElements.length > 0
					? selectedElements
					: getElementsAtTime({
							tracks: editor.timeline.getTracks(),
							time: currentTime,
						});
			const freezeTarget = editor.timeline
				.getElementsWithTracks({
					elements: candidateElements,
				})
				.find(
					({ element }) =>
						element.type === "video" &&
						currentTime > element.startTime &&
						currentTime < element.startTime + element.duration,
				);

			if (!freezeTarget || freezeTarget.element.type !== "video") {
				toast.error("Failed to freeze frame", {
					description: "Place the playhead inside a video clip.",
				});
				return;
			}

			const freezeDuration = 1;
			const rightSideElements = editor.timeline.splitElements({
				elements: [
					{
						trackId: freezeTarget.track.id,
						elementId: freezeTarget.element.id,
					},
				],
				splitTime: currentTime,
			});

			if (rightSideElements.length === 0) {
				toast.error("Failed to freeze frame", {
					description: "Move the playhead away from the clip edge.",
				});
				return;
			}

			const [rightClip] = editor.timeline.getElementsWithTracks({
				elements: rightSideElements,
			});

			if (!rightClip || rightClip.element.type !== "video") {
				toast.error("Failed to freeze frame", {
					description: "The target clip could not be updated.",
				});
				return;
			}

			editor.timeline.updateElementTrim({
				elementId: rightClip.element.id,
				trimStart: rightClip.element.trimStart,
				trimEnd: rightClip.element.trimEnd,
				freezeFrameStart:
					(rightClip.element.freezeFrameStart ?? 0) + freezeDuration,
				freezeFrameEnd: rightClip.element.freezeFrameEnd ?? 0,
				duration: rightClip.element.duration + freezeDuration,
				rippleEnabled: rippleEditingEnabled,
			});

			toast.success("Freeze frame added");
		},
		undefined,
	);
useActionHandler(
"apply-cursor-follow",
(args) => {
const [target] = editor.timeline.getElementsWithTracks({
elements: [{ trackId: args.trackId, elementId: args.elementId }],
});
if (!target || target.element.type !== "video") {
toast.error("Failed to apply cursor follow", {
description: "Select a video clip with a zoom effect.",
});
return;
}

const element = target.element;
const effect = (element.effects ?? []).find(
(candidate) => candidate.id === args.effectId,
);
if (!effect || effect.type !== "zoom") {
toast.error("Failed to apply cursor follow", {
description: "The selected effect is not a zoom effect.",
});
return;
}

const mediaAsset = editor
.media
.getAssets()
.find((asset) => asset.id === element.mediaId);
const cursorTracking = mediaAsset?.cursorTracking;
const sourceDuration =
typeof target.element.sourceDuration === "number" &&
Number.isFinite(target.element.sourceDuration)
? target.element.sourceDuration
: mediaAsset?.duration;

if (
!cursorTracking ||
cursorTracking.status !== "ready" ||
cursorTracking.samples.length === 0
) {
toast.error("Failed to apply cursor follow", {
description: "Attach a ready cursor tracking file to this video asset first.",
});
return;
}

if (
typeof sourceDuration !== "number" ||
!Number.isFinite(sourceDuration) ||
sourceDuration <= 0
) {
toast.error("Failed to apply cursor follow", {
description: "The source video duration is unavailable.",
});
return;
}

try {
const applied = applyCursorTrackingToZoomEffect({
animations: element.animations,
effect,
element,
cursorTracking,
sourceDuration,
});
const updatedEffects = (element.effects ?? []).map((existing) =>
existing.id !== effect.id
? existing
: {
...existing,
params: {
...existing.params,
focusX: applied.focusX,
focusY: applied.focusY,
},
},
);

editor.timeline.updateElements({
updates: [
{
trackId: target.track.id,
elementId: element.id,
updates: {
animations: applied.animations,
effects: updatedEffects,
},
},
],
});

toast.success("Cursor follow applied", {
description: applied.sampleCount + " focus keyframes added to the zoom effect.",
});
} catch (error) {
toast.error("Failed to apply cursor follow", {
description:
error instanceof Error ? error.message : "Please try again",
});
}
},
undefined,
);


	useActionHandler(
		"delete-selected",
		() => {
			if (selectedKeyframes.length > 0) {
				editor.timeline.removeKeyframes({ keyframes: selectedKeyframes });
				clearKeyframeSelection();
				return;
			}
			if (selectedElements.length === 0) {
				return;
			}
			editor.timeline.deleteElements({
				elements: selectedElements,
				rippleEnabled: rippleEditingEnabled,
			});
			editor.selection.clearSelection();
		},
		undefined,
	);

	useActionHandler(
		"select-all",
		() => {
			const allElements = editor.timeline.getTracks().flatMap((track) =>
				track.elements.map((element) => ({
					trackId: track.id,
					elementId: element.id,
				})),
			);
			setElementSelection({ elements: allElements });
		},
		undefined,
	);

	useActionHandler(
		"deselect-all",
		() => {
			setElementSelection({ elements: [] });
			clearKeyframeSelection();
			const activeElement = document.activeElement;
			if (activeElement instanceof HTMLButtonElement) {
				activeElement.blur();
			}
		},
		undefined,
	);

	useActionHandler(
		"duplicate-selected",
		() => {
			editor.timeline.duplicateElements({
				elements: selectedElements,
			});
		},
		undefined,
	);

	useActionHandler(
		"toggle-elements-muted-selected",
		() => {
			editor.timeline.toggleElementsMuted({ elements: selectedElements });
		},
		undefined,
	);

	useActionHandler(
		"toggle-elements-visibility-selected",
		() => {
			editor.timeline.toggleElementsVisibility({ elements: selectedElements });
		},
		undefined,
	);

	useActionHandler(
		"toggle-bookmark",
		() => {
			editor.scenes.toggleBookmark({ time: editor.playback.getCurrentTime() });
		},
		undefined,
	);

	useActionHandler(
		"export-project",
		(args) => {
			void (async () => {
				try {
					const { blob, filename } = await editor.project.exportProjectTransfer({
						id: args.id,
					});
					downloadBlob({ blob, filename });
				} catch (error) {
					toast.error("Failed to export project", {
						description:
							error instanceof Error ? error.message : "Please try again",
					});
				}
			})();
		},
		undefined,
	);
useActionHandler(
"attach-cursor-tracking",
(args) => {
void (async () => {
if (!activeProject) {
toast.error("Failed to attach cursor tracking", {
description: "No active project is available.",
});
return;
}

const mediaAsset = editor
.media
.getAssets()
.find((asset) => asset.id === args.mediaId);
if (!mediaAsset || mediaAsset.type !== "video") {
toast.error("Failed to attach cursor tracking", {
description: "Choose a video asset in the Assets panel.",
});
return;
}

try {
const recordedCursor = await parseRecordedCursorFile({
file: args.file,
});
const cursorTracking = recordedCursor.cursorTracking;

if (
!cursorTracking ||
cursorTracking.status !== "ready" ||
cursorTracking.samples.length === 0
) {
throw new Error(
"The tracking file does not contain usable cursor samples",
);
}

const updatedAsset = await editor.media.updateMediaAsset({
projectId: activeProject.metadata.id,
id: mediaAsset.id,
updates: {
cursorTracking,
recordedCursor,
},
});

if (!updatedAsset) {
throw new Error("The tracking file could not be saved");
}

toast.success("Cursor tracking attached", {
description:
cursorTracking.samples.length + " samples are ready for zoom focus.",
});
} catch (error) {
toast.error("Failed to attach cursor tracking", {
description:
error instanceof Error ? error.message : "Please try again",
});
}
})();
},
undefined,
);

	useActionHandler(
		"replace-media",
		(args) => {
			const [target] = editor.timeline.getElementsWithTracks({
				elements: [{ trackId: args.trackId, elementId: args.elementId }],
			});
			if (!target) {
				toast.error("Failed to replace media", {
					description: "The selected clip could not be found.",
				});
				return;
			}

			const mediaAsset = editor
				.media
				.getAssets()
				.find((asset) => asset.id === args.mediaId);
			if (!mediaAsset) {
				toast.error("Failed to replace media", {
					description: "The selected media asset could not be found.",
				});
				return;
			}

			try {
				const updates = buildReplaceMediaUpdates({
					element: target.element,
					mediaAsset,
				});
				editor.timeline.updateElements({
					updates: [
						{
							trackId: target.track.id,
							elementId: target.element.id,
							updates,
						},
					],
				});
				clearReplaceMediaRequest();
				toast.success("Media replaced", {
					description: "The clip source has been updated.",
				});
			} catch (error) {
				toast.error("Failed to replace media", {
					description:
						error instanceof Error ? error.message : "Please try again",
				});
			}
		},
		undefined,
	);


	useActionHandler(
		"copy-selected",
		() => {
			if (selectedElements.length === 0) return;

			const results = editor.timeline.getElementsWithTracks({
				elements: selectedElements,
			});
			const items = results.map(({ track, element }) => {
				const { id: _, ...elementWithoutId } = element;
				return {
					trackId: track.id,
					trackType: track.type,
					element: elementWithoutId,
				};
			});

			setClipboard({ items });
		},
		undefined,
	);

	useActionHandler(
		"paste-copied",
		() => {
			if (!clipboard?.items.length) return;

			editor.timeline.pasteAtTime({
				time: editor.playback.getCurrentTime(),
				clipboardItems: clipboard.items,
			});
		},
		undefined,
	);

	useActionHandler(
		"toggle-snapping",
		() => {
			toggleSnapping();
		},
		undefined,
	);

	useActionHandler(
		"toggle-ripple-editing",
		() => {
			toggleRippleEditing();
		},
		undefined,
	);

	useActionHandler(
		"apply-transition",
		(args) => {
			const result = buildTransitionApplication({
				tracks: editor.timeline.getTracks(),
				selectedElements,
				transitionType: args.transitionType,
				requestedDurationSeconds: args.durationSeconds,
			});

			if (!result.ok) {
				toast.error("Failed to apply transition", {
					description: result.message,
				});
				return;
			}

			editor.timeline.upsertKeyframes({
				keyframes: result.keyframes,
			});

			toast.success("Transition applied", {
				description: result.message,
			});
		},
		undefined,
	);

	useActionHandler(
		"undo",
		() => {
			editor.command.undo();
		},
		undefined,
	);

	useActionHandler(
		"redo",
		() => {
			editor.command.redo();
		},
		undefined,
	);
}
