"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import type { EffectDefinition } from "@/types/effects";
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

		for (const param of definition.params) {
			if (
				effectType === ZOOM_EFFECT_TYPE &&
				(param.key === "focusX" || param.key === "focusY")
			) {
				if (!hasInsertedZoomFocusField) {
					items.push(
						<ZoomFocusField
							key="zoom-focus"
							focusX={resolveNumericValue({ value: values.focusX, fallback: 50 })}
							focusY={resolveNumericValue({ value: values.focusY, fallback: 50 })}
							onPreviewFocus={zoomFocusControls?.onPreviewFocus ?? onPreviewParams}
							onCommit={zoomFocusControls?.onCommitFocus ?? onCommit}
							zoomFocusControls={zoomFocusControls}
						/>,
					);
					hasInsertedZoomFocusField = true;
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

function ZoomFocusField({
	focusX,
	focusY,
	onPreviewFocus,
	onCommit,
	zoomFocusControls,
}: {
	focusX: number;
	focusY: number;
	onPreviewFocus: (params: Record<string, number | string | boolean>) => void;
	onCommit: () => void;
	zoomFocusControls?: ZoomFocusControls;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const isDraggingRef = useRef(false);

	const previewFocus = useCallback(
		({ x, y }: { x: number; y: number }) => {
			onPreviewFocus({
				focusX: Math.round(clamp({ value: x, min: 0, max: 100 })),
				focusY: Math.round(clamp({ value: 100 - y, min: 0, max: 100 })),
			});
		},
		[onPreviewFocus],
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

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			if (!isDraggingRef.current) {
				return;
			}
			updateFromClientPosition({ clientX: event.clientX, clientY: event.clientY });
		};

		const handlePointerUp = () => {
			if (!isDraggingRef.current) {
				return;
			}
			isDraggingRef.current = false;
			onCommit();
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
		};
	}, [onCommit, updateFromClientPosition]);

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
				<div
					ref={boxRef}
					className="relative aspect-video w-full cursor-crosshair overflow-hidden rounded-md border bg-muted/30 select-none touch-none"
					onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
						event.preventDefault();
						isDraggingRef.current = true;
						event.currentTarget.setPointerCapture(event.pointerId);
						updateFromClientPosition({
							clientX: event.clientX,
							clientY: event.clientY,
						});
					}}
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
				<div className="flex items-center justify-between gap-2">
					<div className="text-muted-foreground text-xs">
						Drag in the focus window to move the zoom target.
					</div>
					{zoomFocusControls && (
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
				<div className="flex items-center gap-2">
					<div className="flex flex-1 items-center gap-1">
						{zoomFocusControls && (
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
							value={focusXDraft.displayValue}
							onFocus={focusXDraft.onFocus}
							onChange={focusXDraft.onChange}
							onBlur={focusXDraft.onBlur}
						/>
					</div>
					<div className="flex flex-1 items-center gap-1">
						{zoomFocusControls && (
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
