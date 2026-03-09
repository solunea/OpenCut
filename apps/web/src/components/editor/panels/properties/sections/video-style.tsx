import { NumberField } from "@/components/ui/number-field";
import { useEditor } from "@/hooks/use-editor";
import type { VideoElement, VideoFrameStyle } from "@/types/timeline";
import { clamp } from "@/utils/math";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "../section";
import { usePropertyDraft } from "../hooks/use-property-draft";

const DEFAULT_VIDEO_FRAME: Required<VideoFrameStyle> = {
	cornerRadius: 0,
	shadowBlur: 0,
	shadowOffsetX: 0,
	shadowOffsetY: 0,
	shadowOpacity: 35,
	shadowColor: "rgba(0, 0, 0, 0.35)",
};

function resolveFrame(frame: VideoElement["frame"]): Required<VideoFrameStyle> {
	return {
		cornerRadius: frame?.cornerRadius ?? DEFAULT_VIDEO_FRAME.cornerRadius,
		shadowBlur: frame?.shadowBlur ?? DEFAULT_VIDEO_FRAME.shadowBlur,
		shadowOffsetX: frame?.shadowOffsetX ?? DEFAULT_VIDEO_FRAME.shadowOffsetX,
		shadowOffsetY: frame?.shadowOffsetY ?? DEFAULT_VIDEO_FRAME.shadowOffsetY,
		shadowOpacity: frame?.shadowOpacity ?? DEFAULT_VIDEO_FRAME.shadowOpacity,
		shadowColor: frame?.shadowColor ?? DEFAULT_VIDEO_FRAME.shadowColor,
	};
}

function parseBoundedNumber({
	input,
	min,
	max,
}: {
	input: string;
	min: number;
	max: number;
}) {
	const parsed = Number.parseFloat(input);
	if (Number.isNaN(parsed)) {
		return null;
	}
	return clamp({ value: parsed, min, max });
}

export function VideoStyleSection({
	element,
	trackId,
}: {
	element: VideoElement;
	trackId: string;
}) {
	const editor = useEditor();
	const frame = resolveFrame(element.frame);

	const previewFrame = (patch: Partial<VideoFrameStyle>) =>
		editor.timeline.previewElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						frame: {
							...frame,
							...patch,
						},
					},
				},
			],
		});

	const commitFrame = (patch: Partial<VideoFrameStyle>) => {
		if (editor.timeline.isPreviewActive()) {
			editor.timeline.commitPreview();
			return;
		}
		editor.timeline.updateElements({
			updates: [
				{
					trackId,
					elementId: element.id,
					updates: {
						frame: {
							...frame,
							...patch,
						},
					},
				},
			],
		});
	};

	const cornerRadius = usePropertyDraft({
		displayValue: Math.round(frame.cornerRadius).toString(),
		parse: (input) => parseBoundedNumber({ input, min: 0, max: 100 }),
		onPreview: (value) => previewFrame({ cornerRadius: value }),
		onCommit: () => editor.timeline.commitPreview(),
	});

	const shadowBlur = usePropertyDraft({
		displayValue: Math.round(frame.shadowBlur).toString(),
		parse: (input) => parseBoundedNumber({ input, min: 0, max: 100 }),
		onPreview: (value) => previewFrame({ shadowBlur: value }),
		onCommit: () => editor.timeline.commitPreview(),
	});

	const shadowOffsetX = usePropertyDraft({
		displayValue: Math.round(frame.shadowOffsetX).toString(),
		parse: (input) => parseBoundedNumber({ input, min: -200, max: 200 }),
		onPreview: (value) => previewFrame({ shadowOffsetX: value }),
		onCommit: () => editor.timeline.commitPreview(),
	});

	const shadowOffsetY = usePropertyDraft({
		displayValue: Math.round(frame.shadowOffsetY).toString(),
		parse: (input) => parseBoundedNumber({ input, min: -200, max: 200 }),
		onPreview: (value) => previewFrame({ shadowOffsetY: value }),
		onCommit: () => editor.timeline.commitPreview(),
	});

	const shadowOpacity = usePropertyDraft({
		displayValue: Math.round(frame.shadowOpacity).toString(),
		parse: (input) => parseBoundedNumber({ input, min: 0, max: 100 }),
		onPreview: (value) => previewFrame({ shadowOpacity: value }),
		onCommit: () => editor.timeline.commitPreview(),
	});

	return (
		<Section collapsible sectionKey="video:style">
			<SectionHeader>
				<SectionTitle>Style</SectionTitle>
			</SectionHeader>
			<SectionContent>
				<SectionFields>
					<SectionField label="Corner radius">
						<NumberField
							icon="R"
							value={cornerRadius.displayValue}
							min={0}
							max={100}
							onFocus={cornerRadius.onFocus}
							onChange={cornerRadius.onChange}
							onBlur={cornerRadius.onBlur}
							onScrub={cornerRadius.scrubTo}
							onScrubEnd={cornerRadius.commitScrub}
							onReset={() => commitFrame({ cornerRadius: DEFAULT_VIDEO_FRAME.cornerRadius })}
							isDefault={frame.cornerRadius === DEFAULT_VIDEO_FRAME.cornerRadius}
							dragSensitivity="slow"
						/>
					</SectionField>
					<SectionField label="Shadow opacity">
						<NumberField
							icon="O"
							value={shadowOpacity.displayValue}
							min={0}
							max={100}
							onFocus={shadowOpacity.onFocus}
							onChange={shadowOpacity.onChange}
							onBlur={shadowOpacity.onBlur}
							onScrub={shadowOpacity.scrubTo}
							onScrubEnd={shadowOpacity.commitScrub}
							onReset={() => commitFrame({ shadowOpacity: DEFAULT_VIDEO_FRAME.shadowOpacity })}
							isDefault={frame.shadowOpacity === DEFAULT_VIDEO_FRAME.shadowOpacity}
							dragSensitivity="slow"
						/>
					</SectionField>
					<div className="grid grid-cols-2 gap-3.5">
						<SectionField label="Shadow blur">
							<NumberField
								icon="B"
								value={shadowBlur.displayValue}
								min={0}
								max={100}
								onFocus={shadowBlur.onFocus}
								onChange={shadowBlur.onChange}
								onBlur={shadowBlur.onBlur}
								onScrub={shadowBlur.scrubTo}
								onScrubEnd={shadowBlur.commitScrub}
								onReset={() => commitFrame({ shadowBlur: DEFAULT_VIDEO_FRAME.shadowBlur })}
								isDefault={frame.shadowBlur === DEFAULT_VIDEO_FRAME.shadowBlur}
								dragSensitivity="slow"
							/>
						</SectionField>
						<SectionField label="Shadow X">
							<NumberField
								icon="X"
								value={shadowOffsetX.displayValue}
								min={-200}
								max={200}
								onFocus={shadowOffsetX.onFocus}
								onChange={shadowOffsetX.onChange}
								onBlur={shadowOffsetX.onBlur}
								onScrub={shadowOffsetX.scrubTo}
								onScrubEnd={shadowOffsetX.commitScrub}
								onReset={() => commitFrame({ shadowOffsetX: DEFAULT_VIDEO_FRAME.shadowOffsetX })}
								isDefault={frame.shadowOffsetX === DEFAULT_VIDEO_FRAME.shadowOffsetX}
								dragSensitivity="slow"
							/>
						</SectionField>
						<SectionField label="Shadow Y">
							<NumberField
								icon="Y"
								value={shadowOffsetY.displayValue}
								min={-200}
								max={200}
								onFocus={shadowOffsetY.onFocus}
								onChange={shadowOffsetY.onChange}
								onBlur={shadowOffsetY.onBlur}
								onScrub={shadowOffsetY.scrubTo}
								onScrubEnd={shadowOffsetY.commitScrub}
								onReset={() => commitFrame({ shadowOffsetY: DEFAULT_VIDEO_FRAME.shadowOffsetY })}
								isDefault={frame.shadowOffsetY === DEFAULT_VIDEO_FRAME.shadowOffsetY}
								dragSensitivity="slow"
							/>
						</SectionField>
					</div>
				</SectionFields>
			</SectionContent>
		</Section>
	);
}
