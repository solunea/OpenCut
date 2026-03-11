"use client";

import { useMemo, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/hooks/use-editor";
import { useElementSelection } from "@/hooks/timeline/element/use-element-selection";
import { invokeAction } from "@/lib/actions";
import {
	getTransitionCandidate,
	TRANSITION_DEFINITIONS,
	type TransitionType,
} from "@/lib/transitions";
import { cn } from "@/utils/ui";

const DURATION_OPTIONS = [0.25, 0.5, 1];

function TransitionPreview() {
	return (
		<div className="bg-muted/40 flex h-14 items-center gap-1 rounded-md border p-2">
			<div className="from-primary/90 to-background/20 h-full flex-1 rounded-sm bg-gradient-to-r" />
			<div className="from-background/20 to-primary/90 h-full flex-1 rounded-sm bg-gradient-to-r" />
		</div>
	);
}

export function TransitionsView() {
	const editor = useEditor();
	const { selectedElements } = useElementSelection();
	const [durationSeconds, setDurationSeconds] = useState(0.5);

	const tracks = editor.timeline.getTracks();
	const selectedItems = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});

	const candidate = useMemo(
		() =>
			getTransitionCandidate({
				tracks,
				selectedElements,
				requestedDurationSeconds: durationSeconds,
			}),
		[durationSeconds, selectedElements, tracks],
	);

	const handleApply = ({ transitionType }: { transitionType: TransitionType }) => {
		invokeAction(
			"apply-transition",
			{ transitionType, durationSeconds },
			"mouseclick",
		);
	};

	return (
		<PanelView title="Transitions" contentClassName="space-y-3 pb-3">
			<div className="text-muted-foreground px-1 text-xs">
				Select 2 adjacent visual clips on the same track.
			</div>

			<div className="space-y-2 rounded-md border p-3">
				<div className="text-sm font-medium">Selection</div>
				<div
					className={cn(
						"text-xs",
						candidate.isValid ? "text-emerald-500" : "text-muted-foreground",
					)}
				>
					{candidate.reason}
				</div>
				{selectedItems.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{selectedItems.map(({ element }) => (
							<div
								key={element.id}
								className="bg-muted text-muted-foreground rounded px-2 py-1 text-[11px]"
							>
								{element.name}
							</div>
						))}
					</div>
				)}
			</div>

			<div className="space-y-2 rounded-md border p-3">
				<div className="text-sm font-medium">Duration</div>
				<div className="flex flex-wrap gap-2">
					{DURATION_OPTIONS.map((value) => (
						<Button
							key={value}
							variant={durationSeconds === value ? "default" : "outline"}
							size="sm"
							onClick={() => setDurationSeconds(value)}
						>
							{value}s
						</Button>
					))}
				</div>
			</div>

			<div className="grid gap-2">
				{TRANSITION_DEFINITIONS.map((transition) => (
					<div key={transition.type} className="space-y-3 rounded-md border p-3">
						<div className="space-y-2">
							<div>
								<div className="text-sm font-medium">{transition.name}</div>
								<div className="text-muted-foreground text-xs">
									{transition.description}
								</div>
							</div>
							<TransitionPreview />
						</div>
						<Button
							className="w-full"
							disabled={!candidate.isValid}
							onClick={() => handleApply({ transitionType: transition.type })}
						>
							Apply transition
						</Button>
					</div>
				))}
			</div>
		</PanelView>
	);
}
