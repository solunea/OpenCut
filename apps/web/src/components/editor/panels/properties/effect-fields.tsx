"use client";

import {
	useCallback,
	useMemo,
	useRef,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import type {
	EffectDefinition,
	NumberEffectParamDefinition,
} from "@/types/effects";
import { Button } from "@/components/ui/button";
import { clamp } from "@/utils/math";
import { cn } from "@/utils/ui";
import { NumberField } from "@/components/ui/number-field";
import { EffectParamField } from "./effect-param-field";
import { KeyframeToggle } from "./keyframe-toggle";
import { SectionField, SectionFields } from "./section";
import { usePropertyDraft } from "./hooks/use-property-draft";

const ZOOM_EFFECT_TYPE = "zoom";

type ZoomFocusControls = {
	canKeyframe: boolean;
	focusXIsKeyframedAtTime: boolean;
	focusYIsKeyframedAtTime: boolean;
	focusSource: string;
	hasReadyCursorTracking: boolean;
	onPreviewFocus: (params: Record<string, number | string | boolean>) => void;
	onCommitFocus: () => void;
	onToggleFocusXKeyframe: () => void;
	onToggleFocusYKeyframe: () => void;
	onAddFocusKeyframes: () => void;
};

function resolveNumericValue({
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

export function EffectFields({
	effectType,
	definition,
	values,
	onPreviewParam,
	onPreviewParams,
	onCommit,
	zoomFocusControls,
}: {
	effectType: string;
	definition: EffectDefinition;
	values: Record<string, number | string | boolean>;
	onPreviewParam: (key: string) => (value: number | string | boolean) => void;
	onPreviewParams: (params: Record<string, number | string | boolean>) => void;
	onCommit: () => void;
	zoomFocusControls?: ZoomFocusControls;
}) {
	const fields = useMemo(() => {
		const items: ReactNode[] = [];
		let hasInsertedZoomFocusField = false;
		const zoomFocusSource =
			effectType === ZOOM_EFFECT_TYPE && values.focusSource === "media-tracking"
				? "media-tracking"
				: "manual";

		for (const param of definition.params) {
			if (effectType === ZOOM_EFFECT_TYPE && (param.key === "focusX" || param.key === "focusY")) {
				if (!hasInsertedZoomFocusField) {
					items.push(
						<ZoomFocusField
							key="zoom-focus"
							focusX={resolveNumericValue({ value: values.focusX, fallback: 50 })}
							focusY={resolveNumericValue({ value: values.focusY, fallback: 50 })}
							focusSource={zoomFocusSource}
							onPreviewFocus={zoomFocusControls?.onPreviewFocus ?? onPreviewParams}
							onCommit={zoomFocusControls?.onCommitFocus ?? onCommit}
							zoomFocusControls={zoomFocusControls}
						/>,
					);
					hasInsertedZoomFocusField = true;
				}
				continue;
			}

			if (
				effectType === ZOOM_EFFECT_TYPE &&
				!Boolean(values.tiltEnabled) &&
				(param.key === "tiltX" ||
					param.key === "tiltY" ||
					param.key === "rotationX" ||
					param.key === "perspective")
			) {
				continue;
			}

			if (
				effectType === ZOOM_EFFECT_TYPE &&
				(param.key === "tiltX" || param.key === "tiltY")
			) {
				if (param.key === "tiltX") {
					const tiltXParam = param as NumberEffectParamDefinition;
					const tiltYParam = definition.params.find(
						(candidate) => candidate.key === "tiltY",
					) as NumberEffectParamDefinition | undefined;

					if (tiltYParam) {
						items.push(
							<TiltAxesField
								key="tilt-axes"
								tiltXParam={tiltXParam}
								tiltYParam={tiltYParam}
								tiltXValue={resolveNumericValue({
									value: values.tiltX,
									fallback: tiltXParam.default,
								})}
								tiltYValue={resolveNumericValue({
									value: values.tiltY,
									fallback: tiltYParam.default,
								})}
								onPreviewTiltX={onPreviewParam("tiltX")}
								onPreviewTiltY={onPreviewParam("tiltY")}
								onCommit={onCommit}
							/>,
						);
					}
				}
				continue;
			}

			items.push(
				<EffectParamField
					key={param.key}
					param={param}
					value={values[param.key] ?? param.default}
					onPreview={onPreviewParam(param.key)}
					onCommit={onCommit}
				/>,
			);
		}

		return items;
	}, [
		definition.params,
		effectType,
		onCommit,
		onPreviewParam,
		onPreviewParams,
		values,
		zoomFocusControls,
	]);

	return <SectionFields>{fields}</SectionFields>;
}

function TiltAxesField({
	tiltXParam,
	tiltYParam,
	tiltXValue,
	tiltYValue,
	onPreviewTiltX,
	onPreviewTiltY,
	onCommit,
}: {
	tiltXParam: NumberEffectParamDefinition;
	tiltYParam: NumberEffectParamDefinition;
	tiltXValue: number;
	tiltYValue: number;
	onPreviewTiltX: (value: number | string | boolean) => void;
	onPreviewTiltY: (value: number | string | boolean) => void;
	onCommit: () => void;
}) {
	const tiltXDraft = usePropertyDraft({
		displayValue: String(tiltXValue),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}
			return clamp({ value: parsed, min: tiltXParam.min, max: tiltXParam.max });
		},
		onPreview: (value) => onPreviewTiltX(value),
		onCommit,
	});

	const tiltYDraft = usePropertyDraft({
		displayValue: String(tiltYValue),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}
			return clamp({ value: parsed, min: tiltYParam.min, max: tiltYParam.max });
		},
		onPreview: (value) => onPreviewTiltY(value),
		onCommit,
	});

	return (
		<SectionField label="Tilt">
			<div className="flex items-center gap-3">
				<NumberField
					className="flex-1"
					icon="X"
					value={tiltXDraft.displayValue}
					onScrub={(value) =>
						onPreviewTiltX(
							clamp({ value, min: tiltXParam.min, max: tiltXParam.max }),
						)
					}
					onScrubEnd={onCommit}
					onFocus={tiltXDraft.onFocus}
					onChange={tiltXDraft.onChange}
					onBlur={tiltXDraft.onBlur}
				/>
				<NumberField
					className="flex-1"
					icon="Y"
					value={tiltYDraft.displayValue}
					onScrub={(value) =>
						onPreviewTiltY(
							clamp({ value, min: tiltYParam.min, max: tiltYParam.max }),
						)
					}
					onScrubEnd={onCommit}
					onFocus={tiltYDraft.onFocus}
					onChange={tiltYDraft.onChange}
					onBlur={tiltYDraft.onBlur}
				/>
			</div>
		</SectionField>
	);
}

function ZoomFocusField({
	focusX,
	focusY,
	focusSource,
	onPreviewFocus,
	onCommit,
	zoomFocusControls,
}: {
	focusX: number;
	focusY: number;
	focusSource: string;
	onPreviewFocus: (params: Record<string, number | string | boolean>) => void;
	onCommit: () => void;
	zoomFocusControls?: ZoomFocusControls;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const activePointerIdRef = useRef<number | null>(null);
	const isDraggingRef = useRef(false);
	const usesMediaTracking = focusSource === "media-tracking";
	const hasReadyCursorTracking = zoomFocusControls?.hasReadyCursorTracking ?? false;

	const previewFocus = useCallback(
		({ x, y }: { x: number; y: number }) => {
			if (usesMediaTracking) {
				return;
			}
			onPreviewFocus({
				focusX: Math.round(clamp({ value: x, min: 0, max: 100 })),
				focusY: Math.round(clamp({ value: 100 - y, min: 0, max: 100 })),
			});
		},
		[onPreviewFocus, usesMediaTracking],
	);

	const updateFromClientPosition = useCallback(
		({ clientX, clientY }: { clientX: number; clientY: number }) => {
			const box = boxRef.current;
			if (!box) {
				return;
			}

			const rect = box.getBoundingClientRect();
			const x = ((clientX - rect.left) / rect.width) * 100;
			const y = ((clientY - rect.top) / rect.height) * 100;

			previewFocus({ x, y });
		},
		[previewFocus],
	);

	const stopDragging = useCallback(() => {
		if (!isDraggingRef.current) {
			return;
		}
		isDraggingRef.current = false;
		activePointerIdRef.current = null;
		onCommit();
	}, [onCommit]);

	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			isDraggingRef.current = true;
			activePointerIdRef.current = event.pointerId;
			event.currentTarget.setPointerCapture(event.pointerId);
			updateFromClientPosition({
				clientX: event.clientX,
				clientY: event.clientY,
			});
		},
		[updateFromClientPosition],
	);

	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (
				!isDraggingRef.current ||
				activePointerIdRef.current !== event.pointerId
			) {
				return;
			}
			updateFromClientPosition({
				clientX: event.clientX,
				clientY: event.clientY,
			});
		},
		[updateFromClientPosition],
	);

	const handlePointerUp = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (activePointerIdRef.current !== event.pointerId) {
				return;
			}
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			stopDragging();
		},
		[stopDragging],
	);

	const handleLostPointerCapture = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (
				activePointerIdRef.current !== null &&
				activePointerIdRef.current !== event.pointerId
			) {
				return;
			}
			stopDragging();
		},
		[stopDragging],
	);

	const focusXDraft = usePropertyDraft({
		displayValue: String(Math.round(focusX)),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}
			return clamp({ value: parsed, min: 0, max: 100 });
		},
		onPreview: (value) => onPreviewFocus({ focusX: value }),
		onCommit,
	});

	const focusYDraft = usePropertyDraft({
		displayValue: String(Math.round(focusY)),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}
			return clamp({ value: parsed, min: 0, max: 100 });
		},
		onPreview: (value) => onPreviewFocus({ focusY: value }),
		onCommit,
	});

	return (
		<SectionField label="Focus">
			<div className="flex flex-col gap-3">
				{usesMediaTracking ? (
					<div className="rounded-md border bg-muted/20 px-3 py-3 text-sm">
						<div className="font-medium">Media tracking focus</div>
						<div className="text-muted-foreground mt-1 text-xs">
							{hasReadyCursorTracking
								? "The zoom focus follows the tracked mouse position from this media."
								: "No ready media tracking data was found. Manual focus values stay as fallback until tracking is available."}
						</div>
					</div>
				) : (
					<div
						ref={boxRef}
						className="relative aspect-video w-full cursor-crosshair overflow-hidden rounded-md border bg-muted/30 select-none touch-none"
						onPointerDown={handlePointerDown}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onPointerCancel={handlePointerUp}
						onLostPointerCapture={handleLostPointerCapture}
					>
						<div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
							{Array.from({ length: 9 }).map((_, index) => (
								<div
									key={index}
									className={cn(
										"border-border/50",
										index % 3 !== 2 && "border-r",
										index < 6 && "border-b",
									)}
								/>
							))}
						</div>
						<div
							className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow-sm"
							style={{
								left: `${focusX}%`,
								top: `${100 - focusY}%`,
							}}
						/>
					</div>
				)}
				<div className="flex items-center justify-between gap-2">
					<div className="text-muted-foreground text-xs">
						{usesMediaTracking
							? "Switch Focus Source back to Manual to edit the zoom target yourself."
							: "Drag in the focus window to move the zoom target."}
					</div>
					{zoomFocusControls && !usesMediaTracking && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={zoomFocusControls.onAddFocusKeyframes}
							disabled={!zoomFocusControls.canKeyframe}
						>
							Add keyframes
						</Button>
					)}
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="flex items-center gap-1">
						{zoomFocusControls && !usesMediaTracking && (
							<KeyframeToggle
								isActive={zoomFocusControls.focusXIsKeyframedAtTime}
								isDisabled={!zoomFocusControls.canKeyframe}
								title="Toggle focus X keyframe"
								onToggle={zoomFocusControls.onToggleFocusXKeyframe}
							/>
						)}
						<NumberField
							icon="X"
							className="flex-1"
							disabled={usesMediaTracking}
							value={focusXDraft.displayValue}
							onFocus={focusXDraft.onFocus}
							onChange={focusXDraft.onChange}
							onBlur={focusXDraft.onBlur}
						/>
					</div>
					<div className="flex items-center gap-1">
						{zoomFocusControls && !usesMediaTracking && (
							<KeyframeToggle
								isActive={zoomFocusControls.focusYIsKeyframedAtTime}
								isDisabled={!zoomFocusControls.canKeyframe}
								title="Toggle focus Y keyframe"
								onToggle={zoomFocusControls.onToggleFocusYKeyframe}
							/>
						)}
						<NumberField
							icon="Y"
							className="flex-1"
							disabled={usesMediaTracking}
							value={focusYDraft.displayValue}
							onFocus={focusYDraft.onFocus}
							onChange={focusYDraft.onChange}
							onBlur={focusYDraft.onBlur}
						/>
					</div>
				</div>
			</div>
		</SectionField>
	);
}
