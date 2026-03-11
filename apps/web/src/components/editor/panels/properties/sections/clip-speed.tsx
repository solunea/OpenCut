import { useEffect, useState } from "react";
import { NumberField } from "@/components/ui/number-field";
import { useEditor } from "@/hooks/use-editor";
import type { AudioElement, VideoElement } from "@/types/timeline";
import {
	DEFAULT_PLAYBACK_RATE,
	MAX_PLAYBACK_RATE,
	MIN_PLAYBACK_RATE,
	normalizePlaybackRate,
} from "@/lib/timeline/clip-speed";
import {
	Section,
	SectionContent,
	SectionField,
	SectionHeader,
	SectionTitle,
} from "../section";

function formatPlaybackRate({ playbackRate }: { playbackRate: number }): string {
	const rounded = Math.round(playbackRate * 100) / 100;
	return Number.isInteger(rounded) ? `${rounded.toFixed(0)}` : rounded.toFixed(2);
}

function parsePlaybackRate({ input }: { input: string }): number | null {
	const parsed = Number.parseFloat(input.replace(",", "."));
	if (!Number.isFinite(parsed)) {
		return null;
	}

	return normalizePlaybackRate({ playbackRate: parsed });
}

export function ClipSpeedSection({
	element,
	trackId,
}: {
	element: AudioElement | VideoElement;
	trackId: string;
}) {
	const editor = useEditor();
	const playbackRate = normalizePlaybackRate({ playbackRate: element.playbackRate });
	const [draftValue, setDraftValue] = useState(formatPlaybackRate({ playbackRate }));
	const [isEditing, setIsEditing] = useState(false);

	useEffect(() => {
		if (!isEditing) {
			setDraftValue(formatPlaybackRate({ playbackRate }));
		}
	}, [isEditing, playbackRate]);

	const isDefault = playbackRate === DEFAULT_PLAYBACK_RATE;

	const commitPlaybackRate = ({ value }: { value: number }) => {
		const nextPlaybackRate = normalizePlaybackRate({ playbackRate: value });
		editor.timeline.updateElementPlaybackRate({
			trackId,
			elementId: element.id,
			playbackRate: nextPlaybackRate,
		});
		setDraftValue(formatPlaybackRate({ playbackRate: nextPlaybackRate }));
	};

	return (
		<Section collapsible sectionKey={`${element.type}:${element.id}:speed`}>
			<SectionHeader>
				<SectionTitle>Speed</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionField label="Playback rate">
					<NumberField
						className="w-full"
						value={draftValue}
						min={MIN_PLAYBACK_RATE}
						max={MAX_PLAYBACK_RATE}
						onFocus={() => setIsEditing(true)}
						onChange={(event) => setDraftValue(event.currentTarget.value)}
						onBlur={() => {
							setIsEditing(false);
							const parsed = parsePlaybackRate({ input: draftValue });
							if (parsed === null) {
								setDraftValue(formatPlaybackRate({ playbackRate }));
								return;
							}
							if (parsed !== playbackRate) {
								commitPlaybackRate({ value: parsed });
							}
						}}
						onReset={() => commitPlaybackRate({ value: DEFAULT_PLAYBACK_RATE })}
						isDefault={isDefault}
					/>
					<div className="text-muted-foreground mt-2 text-xs">0.25x to 4x</div>
				</SectionField>
			</SectionContent>
		</Section>
	);
}
