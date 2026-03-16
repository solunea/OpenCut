"use client";

import { useEffect, useState, type DragEvent } from "react";
import { invokeAction } from "@/lib/actions";
import type { Effect } from "@/types/effects";
import type { VisualElement } from "@/types/timeline";
import { getChannel } from "@/lib/animation";
import {
	resolveEffectParamsAtTime,
	upsertEffectParamKeyframe as previewEffectParamKeyframe,
} from "@/lib/animation/effect-param-channel";
import { TIME_EPSILON_SECONDS } from "@/constants/animation-constants";
import { getEffect } from "@/lib/effects/registry";
import { useEditor } from "@/hooks/use-editor";
import { usePropertiesStore } from "@/stores/properties-store";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "./section";
import { EffectFields } from "./effect-fields";
import { Button } from "@/components/ui/button";
import { useElementPlayhead } from "./hooks/use-element-playhead";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	ArrowLeft01Icon,
	Delete02Icon,
	ViewIcon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/utils/ui";
export function ClipEffectsProperties({
	element,
	trackId,
}: {
	element: VisualElement;
	trackId: string;
}) {
	const closeClipEffects = usePropertiesStore(
		(state) => state.closeClipEffects,
	);
	const editor = useEditor();
	const effects = element.effects ?? [];

	useEffect(() => {
		if (effects.length === 0) closeClipEffects();
	}, [effects.length, closeClipEffects]);

	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);

	const handleDragStart = ({ index }: { index: number }) => {
		setDragIndex(index);
	};

	const handleDragOver = ({ event, index }: { event: DragEvent; index: number }) => {
		event.preventDefault();
		if (index !== dropIndex) setDropIndex(index);
	};

	const handleDrop = ({ toIndex }: { toIndex: number }) => {
		if (dragIndex !== null && dragIndex !== toIndex) {
			editor.timeline.reorderClipEffects({
				trackId,
				elementId: element.id,
				fromIndex: dragIndex,
				toIndex,
			});
		}
		setDragIndex(null);
		setDropIndex(null);
	};

	const handleDragEnd = () => {
		setDragIndex(null);
		setDropIndex(null);
	};

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-11 shrink-0 items-center gap-2 border-b px-1.5">
				<Button
					variant="ghost"
					size="icon"
					onClick={closeClipEffects}
					aria-label="Back to properties"
				>
					<HugeiconsIcon icon={ArrowLeft01Icon} />
				</Button>
				<span className="text-sm font-medium">Effects</span>
			</div>
			<ScrollArea className="flex-1 scrollbar-hidden">
				{effects.map((effect, index) => (
					// biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop list reorder
					<div
						key={effect.id}
						draggable
						onDragStart={() => handleDragStart({ index })}
						onDragOver={(event) => handleDragOver({ event, index })}
						onDrop={() => handleDrop({ toIndex: index })}
						onDragEnd={handleDragEnd}
						className={cn(
							"group",
							dragIndex === index && "opacity-40",
							dropIndex === index &&
								dragIndex !== null &&
								dragIndex !== index &&
								(index < dragIndex
									? "border-t-2 border-primary"
									: "border-b-2 border-primary"),
						)}
					>
						<ClipEffectSection
							effect={effect}
							element={element}
							trackId={trackId}
						/>
					</div>
				))}
			</ScrollArea>
		</div>
	);
}

function ClipEffectSection({
	effect,
	element,
	trackId,
}: {
	effect: Effect;
	element: VisualElement;
	trackId: string;
}) {
	const editor = useEditor();
	const definition = getEffect({ effectType: effect.type });
	const mediaAsset =
		element.type === "video"
			? editor.media.getAssets().find((asset) => asset.id === element.mediaId) ?? null
			: null;
	const hasReadyCursorTracking =
		mediaAsset?.cursorTracking?.status === "ready" &&
		mediaAsset.cursorTracking.samples.length > 0;
	const { localTime, isPlayheadWithinElementRange } = useElementPlayhead({
		startTime: element.startTime,
		duration: element.duration,
	});
	const resolvedValues =
		effect.type === "zoom"
			? resolveEffectParamsAtTime({
					effect,
					animations: element.animations,
					localTime,
				})
			: effect.params;

	const buildEffectParamPath = (paramKey: string) =>
		`effects.${effect.id}.params.${paramKey}`;
	const getEffectParamChannel = (paramKey: string) =>
		getChannel({
			animations: element.animations,
			propertyPath: buildEffectParamPath(paramKey),
		});
	const getEffectParamKeyframeIdAtTime = (paramKey: string) =>
		getEffectParamChannel(paramKey)?.keyframes.find(
			(keyframe) => Math.abs(keyframe.time - localTime) <= TIME_EPSILON_SECONDS,
		)?.id ?? null;
	const hasEffectParamKeyframes = (paramKey: string) =>
		Boolean(getEffectParamChannel(paramKey)?.keyframes.length);

	const commitPreview = () => editor.timeline.commitPreview();

	const previewZoomFocus = (params: Record<string, number | string | boolean>) => {
		const nextParams: Record<string, number> = {};
		if ("focusX" in params) {
			const focusX = Number(params.focusX);
			if (Number.isFinite(focusX)) {
				nextParams.focusX = focusX;
			}
		}
		if ("focusY" in params) {
			const focusY = Number(params.focusY);
			if (Number.isFinite(focusY)) {
				nextParams.focusY = focusY;
			}
		}

		const shouldAnimateX =
			typeof nextParams.focusX === "number" &&
			isPlayheadWithinElementRange &&
			hasEffectParamKeyframes("focusX");
		const shouldAnimateY =
			typeof nextParams.focusY === "number" &&
			isPlayheadWithinElementRange &&
			hasEffectParamKeyframes("focusY");

		let nextAnimations = element.animations;
		if (shouldAnimateX) {
			nextAnimations = previewEffectParamKeyframe({
				animations: nextAnimations,
				effectId: effect.id,
				paramKey: "focusX",
				time: localTime,
				value: nextParams.focusX,
			});
		}
		if (shouldAnimateY) {
			nextAnimations = previewEffectParamKeyframe({
				animations: nextAnimations,
				effectId: effect.id,
				paramKey: "focusY",
				time: localTime,
				value: nextParams.focusY,
			});
		}

		const updatedEffects = (element.effects ?? []).map((existing) =>
			existing.id !== effect.id
				? existing
				: {
						...existing,
						params: {
							...existing.params,
							...(shouldAnimateX ? {} : { focusX: nextParams.focusX ?? existing.params.focusX }),
							...(shouldAnimateY ? {} : { focusY: nextParams.focusY ?? existing.params.focusY }),
						},
					},
		);

		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						effects: updatedEffects,
						...(shouldAnimateX || shouldAnimateY ? { animations: nextAnimations } : {}),
					},
				},
			],
		});
	};

	const toggleFocusKeyframe = ({
		paramKey,
		value,
	}: {
		paramKey: "focusX" | "focusY";
		value: number;
	}) => {
		if (!isPlayheadWithinElementRange) {
			return;
		}

		const keyframeIdAtTime = getEffectParamKeyframeIdAtTime(paramKey);
		if (keyframeIdAtTime) {
			editor.timeline.removeEffectParamKeyframe({
				trackId,
				elementId: element.id,
				effectId: effect.id,
				paramKey,
				keyframeId: keyframeIdAtTime,
			});
			return;
		}

		editor.timeline.upsertEffectParamKeyframe({
			trackId,
			elementId: element.id,
			effectId: effect.id,
			paramKey,
			time: localTime,
			value,
		});
	};

	const addFocusKeyframes = () => {
		if (!isPlayheadWithinElementRange || effect.type !== "zoom") {
			return;
		}

		editor.timeline.upsertEffectParamKeyframe({
			trackId,
			elementId: element.id,
			effectId: effect.id,
			paramKey: "focusX",
			time: localTime,
			value: Number(resolvedValues.focusX ?? effect.params.focusX ?? 50),
		});
		editor.timeline.upsertEffectParamKeyframe({
			trackId,
			elementId: element.id,
			effectId: effect.id,
			paramKey: "focusY",
			time: localTime,
			value: Number(resolvedValues.focusY ?? effect.params.focusY ?? 50),
		});
	};

	const previewParam = (key: string) => (value: number | string | boolean) => {
		const updatedEffects = (element.effects ?? []).map((existing) =>
			existing.id !== effect.id
				? existing
				: { ...existing, params: { ...existing.params, [key]: value } },
		);
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: { effects: updatedEffects },
				},
			],
		});
	};

	const previewParams = (params: Record<string, number | string | boolean>) => {
		const updatedEffects = (element.effects ?? []).map((existing) =>
			existing.id !== effect.id
				? existing
				: { ...existing, params: { ...existing.params, ...params } },
		);
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: { effects: updatedEffects },
				},
			],
		});
	};

	const commitParam = () => editor.timeline.commitPreview();

	const toggleEffect = () =>
		editor.timeline.toggleClipEffect({
			trackId,
			elementId: element.id,
			effectId: effect.id,
		});

	const removeEffect = () =>
		editor.timeline.removeClipEffect({
			trackId,
			elementId: element.id,
			effectId: effect.id,
		});

	return (
		<Section sectionKey={`clip-effect:${effect.id}`} showTopBorder={false}>
			<SectionHeader
				className="cursor-move"
				trailing={
					<div className="flex items-center gap-1">
						<Button
							variant={effect.enabled ? "secondary" : "ghost"}
							size="icon"
							aria-label={`Toggle ${definition.name}`}
							onClick={toggleEffect}
						>
							<HugeiconsIcon
								icon={effect.enabled ? ViewIcon : ViewOffSlashIcon}
							/>
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Remove ${definition.name}`}
							onClick={removeEffect}
						>
							<HugeiconsIcon icon={Delete02Icon} />
						</Button>
					</div>
				}
			>
				<SectionTitle
					className={cn(!effect.enabled && "text-muted-foreground")}
				>
					{definition.name}
				</SectionTitle>
			</SectionHeader>
			{effect.enabled && (
				<SectionContent>
					<EffectFields
						effectType={effect.type}
						definition={definition}
						values={resolvedValues}
						onPreviewParam={previewParam}
						onPreviewParams={previewParams}
						onCommit={commitParam}
						zoomFocusControls={
							effect.type === "zoom"
								? {
										canKeyframe: isPlayheadWithinElementRange,
										focusXIsKeyframedAtTime:
											getEffectParamKeyframeIdAtTime("focusX") !== null,
										focusYIsKeyframedAtTime:
											getEffectParamKeyframeIdAtTime("focusY") !== null,
										onPreviewFocus: previewZoomFocus,
										onCommitFocus: commitPreview,
										onToggleFocusXKeyframe: () =>
											toggleFocusKeyframe({
												paramKey: "focusX",
												value: Number(resolvedValues.focusX ?? effect.params.focusX ?? 50),
											}),
										onToggleFocusYKeyframe: () =>
											toggleFocusKeyframe({
												paramKey: "focusY",
												value: Number(resolvedValues.focusY ?? effect.params.focusY ?? 50),
											}),
										onAddFocusKeyframes: addFocusKeyframes,
									}
								: undefined
						}
					/>
					{effect.type === "zoom" && element.type === "video" ? (
						<div className="mt-3 flex">
							<Button
								variant="outline"
								size="sm"
								disabled={!hasReadyCursorTracking}
								onClick={() =>
									invokeAction(
										"apply-cursor-follow",
										{
											trackId,
											elementId: element.id,
											effectId: effect.id,
										},
										"mouseclick",
									)
								}
							>
								Apply cursor follow
							</Button>
						</div>
					) : null}
				</SectionContent>
			)}
		</Section>
	);
}
