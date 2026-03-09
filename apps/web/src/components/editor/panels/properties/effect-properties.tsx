"use client";

import type { EffectElement } from "@/types/timeline";
import { getEffect } from "@/lib/effects/registry";
import { useEditor } from "@/hooks/use-editor";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "./section";
import { EffectFields } from "./effect-fields";

export function EffectProperties({
	element,
	trackId,
}: {
	element: EffectElement;
	trackId: string;
}) {
	const editor = useEditor();
	const definition = getEffect({ effectType: element.effectType });

	const previewParam =
		(key: string) =>
		(value: number | string | boolean) =>
			editor.timeline.previewElements({
				updates: [
					{
						trackId,
						elementId: element.id,
						updates: { params: { ...element.params, [key]: value } },
					},
				],
			});

	const previewParams = (params: Record<string, number | string | boolean>) =>
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: { params: { ...element.params, ...params } },
				},
			],
		});

	return (
		<Section showTopBorder={false}>
			<SectionHeader>
				<SectionTitle>{definition.name}</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<EffectFields
					effectType={element.effectType}
					definition={definition}
					values={element.params}
					onPreviewParam={previewParam}
					onPreviewParams={previewParams}
					onCommit={() => editor.timeline.commitPreview()}
				/>
			</SectionContent>
		</Section>
	);
}
