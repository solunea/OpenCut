"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/hooks/use-editor";
import type { TextElement } from "@/types/timeline";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	positionToOverlay,
	getDisplayScale,
} from "@/lib/preview/preview-coords";
import {
	DEFAULT_LINE_HEIGHT,
	FONT_SIZE_SCALE_REFERENCE,
} from "@/constants/text-constants";
import {
	AlignLeftIcon,
	AlignRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlignCenter } from "lucide-react";

const TEXT_BACKGROUND_PADDING = "4px 8px";
const TEXT_EDIT_VERTICAL_OFFSET_EM = 0.06;

const TEXT_ALIGN_OPTIONS: Array<{
	value: TextElement["textAlign"];
	label: string;
	icon: React.ReactNode;
}> = [
	{
		value: "left",
		label: "Align left",
		icon: <HugeiconsIcon icon={AlignLeftIcon} className="size-4" />,
	},
	{
		value: "center",
		label: "Align center",
		icon: <AlignCenter className="size-4" />,
	},
	{
		value: "right",
		label: "Align right",
		icon: <HugeiconsIcon icon={AlignRightIcon} className="size-4" />,
	},
];

function getOverlayHorizontalTransform({
	textAlign,
}: {
	textAlign: TextElement["textAlign"];
}) {
	if (textAlign === "left") return "0%";
	if (textAlign === "right") return "-100%";
	return "-50%";
}

function getOverlayTransformOrigin({
	textAlign,
}: {
	textAlign: TextElement["textAlign"];
}) {
	if (textAlign === "left") return "left center";
	if (textAlign === "right") return "right center";
	return "center center";
}

export function TextEditOverlay({
	canvasRef,
	containerRef,
	trackId,
	elementId,
	element,
	onCommit,
	onCancel,
}: {
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
	containerRef: React.RefObject<HTMLDivElement | null>;
	trackId: string;
	elementId: string;
	element: TextElement;
	onCommit: () => void;
	onCancel: () => void;
}) {
	const editor = useEditor();
	const divRef = useRef<HTMLDivElement>(null);
	const [textAlign, setTextAlign] = useState<TextElement["textAlign"]>(
		element.textAlign,
	);

	useEffect(() => {
		const div = divRef.current;
		if (!div) return;
		div.focus();
		const range = document.createRange();
		range.selectNodeContents(div);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}, []);

	useEffect(() => {
		setTextAlign(element.textAlign);
	}, [element.textAlign]);

	const handleInput = useCallback(() => {
		const div = divRef.current;
		if (!div) return;
		const text = div.innerText;
		editor.timeline.previewElements({
			updates: [{ trackId, elementId, updates: { content: text } }],
		});
	}, [editor.timeline, trackId, elementId]);

	const handleKeyDown = useCallback(
		({ event }: { event: React.KeyboardEvent }) => {
			const { key } = event;
			if (key === "Escape") {
				event.preventDefault();
				onCancel();
				return;
			}
		},
		[onCancel],
	);

	const handleTextAlignChange = useCallback(
		(value: string) => {
			if (!value) return;

			const nextTextAlign = value as TextElement["textAlign"];
			setTextAlign(nextTextAlign);
			editor.timeline.previewElements({
				updates: [{ trackId, elementId, updates: { textAlign: nextTextAlign } }],
			});
			requestAnimationFrame(() => {
				divRef.current?.focus();
			});
		},
		[editor.timeline, trackId, elementId],
	);

	const canvasRect = canvasRef.current?.getBoundingClientRect();
	const containerRect = containerRef.current?.getBoundingClientRect();
	const canvasSize = editor.project.getActive().settings.canvasSize;

	if (!canvasRect || !containerRect || !canvasSize) return null;

	const { x: posX, y: posY } = positionToOverlay({
		positionX: element.transform.position.x,
		positionY: element.transform.position.y,
		canvasRect,
		containerRect,
		canvasSize,
	});

	const { x: displayScaleX } = getDisplayScale({
		canvasRect,
		canvasSize,
	});

	const displayFontSize =
		element.fontSize *
		(canvasSize.height / FONT_SIZE_SCALE_REFERENCE) *
		displayScaleX;

	const verticalAlignmentOffset =
		displayFontSize * TEXT_EDIT_VERTICAL_OFFSET_EM;

	const lineHeight = element.lineHeight ?? DEFAULT_LINE_HEIGHT;
	const fontWeight = element.fontWeight === "bold" ? "bold" : "normal";
	const fontStyle = element.fontStyle === "italic" ? "italic" : "normal";
	const letterSpacing = element.letterSpacing ?? 0;
	const shouldShowBackground =
		element.background.enabled &&
		element.background.color &&
		element.background.color !== "transparent";
	const backgroundColor = shouldShowBackground
		? element.background.color
		: "transparent";
	const translateX = getOverlayHorizontalTransform({
		textAlign,
	});
	const transformOrigin = getOverlayTransformOrigin({
		textAlign,
	});

	return (
		<div
			className="absolute"
			style={{
				left: posX,
				top: posY - verticalAlignmentOffset,
				transform: `translate(${translateX}, -50%) scale(${element.transform.scale}) rotate(${element.transform.rotate}deg)`,
				transformOrigin,
			}}
		>
			<div className="mb-2 flex justify-center">
				<ToggleGroup
					type="single"
					value={textAlign}
					variant="outline"
					size="sm"
					className="rounded-md bg-background/90 p-1 shadow-sm backdrop-blur"
					onMouseDown={(event) => event.preventDefault()}
					onValueChange={handleTextAlignChange}
				>
					{TEXT_ALIGN_OPTIONS.map((option) => (
						<ToggleGroupItem
							key={option.value}
							value={option.value}
							aria-label={option.label}
							title={option.label}
						>
							{option.icon}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: contenteditable required for multiline, IME, paste */}
			<div
				ref={divRef}
				contentEditable
				suppressContentEditableWarning
				tabIndex={0}
				role="textbox"
				aria-label="Edit text"
				className="cursor-text select-text outline-none whitespace-pre"
				style={{
					fontSize: displayFontSize,
					fontFamily: element.fontFamily,
					fontWeight,
					fontStyle,
					textAlign,
					letterSpacing: `${letterSpacing}px`,
					lineHeight,
					color: element.color,
					backgroundColor,
					minHeight: displayFontSize * lineHeight,
					textDecoration: element.textDecoration ?? "none",
					padding: shouldShowBackground ? TEXT_BACKGROUND_PADDING : 0,
					minWidth: 1,
				}}
				onInput={handleInput}
				onBlur={onCommit}
				onKeyDown={(event) => handleKeyDown({ event })}
			>
				{element.content || ""}
			</div>
		</div>
	);
}
