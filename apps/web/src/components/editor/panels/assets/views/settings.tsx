"use client";

import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	DEFAULT_BLUR_INTENSITY,
	DEFAULT_COLOR,
	FPS_PRESETS,
} from "@/constants/project-constants";
import { useEditor } from "@/hooks/use-editor";
import { useEditorStore } from "@/stores/editor-store";
import { dimensionToAspectRatio } from "@/utils/geometry";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
	SectionHeader,
	SectionTitle,
} from "@/components/editor/panels/properties/section";
import { Label } from "@/components/ui/label";
import { NumberField } from "@/components/ui/number-field";
import { useFileUpload } from "@/hooks/use-file-upload";
import { processMediaAssets } from "@/lib/media/processing";
import { usePropertyDraft } from "@/components/editor/panels/properties/hooks/use-property-draft";
import { toast } from "sonner";
import { useMemo, useRef } from "react";

const ORIGINAL_PRESET_VALUE = "original";
const BACKGROUND_MODE_OPTIONS = [
	{ value: "color", label: "Color" },
	{ value: "blur", label: "Blur" },
	{ value: "image", label: "Image" },
] as const;

export function findPresetIndexByAspectRatio({
	presets,
	targetAspectRatio,
}: {
	presets: Array<{ width: number; height: number }>;
	targetAspectRatio: string;
}) {
	for (let index = 0; index < presets.length; index++) {
		const preset = presets[index];
		const presetAspectRatio = dimensionToAspectRatio({
			width: preset.width,
			height: preset.height,
		});
		if (presetAspectRatio === targetAspectRatio) {
			return index;
		}
	}
	return -1;
}

export function SettingsView() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const mediaAssets = editor.media.getAssets();
	const imageAssets = useMemo(
		() => mediaAssets.filter((asset) => asset.type === "image" && asset.url),
		[mediaAssets],
	);
	const lastBlurValueRef = useRef(
		activeProject.settings.background.type === "blur"
			? activeProject.settings.background.blurIntensity
			: DEFAULT_BLUR_INTENSITY,
	);

	const handleBackgroundImageFiles = async ({ files }: { files: FileList }) => {
		if (!activeProject || files.length === 0) {
			return;
		}

		const processedAssets = await processMediaAssets({ files });
		const firstImageAsset = processedAssets.find((asset) => asset.type === "image");
		if (!firstImageAsset) {
			toast.error("No valid image selected");
			return;
		}

		const createdAsset = await editor.media.addMediaAsset({
			projectId: activeProject.metadata.id,
			asset: firstImageAsset,
		});

		if (!createdAsset) {
			toast.error("Failed to import background image");
			return;
		}

		editor.project.updateSettings({
			settings: {
				background: { type: "image", mediaId: createdAsset.id },
			},
		});
	};

	const {
		openFilePicker: openBackgroundImagePicker,
		fileInputProps: backgroundImageInputProps,
	} = useFileUpload({
		accept: "image/*",
		multiple: false,
		onFilesSelected: (files) => handleBackgroundImageFiles({ files }),
	});

	const blurDraft = usePropertyDraft({
		displayValue: String(lastBlurValueRef.current),
		parse: (input) => {
			const parsed = Number.parseFloat(input);
			if (Number.isNaN(parsed)) {
				return null;
			}
			return Math.min(Math.max(parsed, 0), 100);
		},
		onPreview: (value) => {
			lastBlurValueRef.current = value;
			editor.project.updateSettings({
				settings: { background: { type: "blur", blurIntensity: value } },
				pushHistory: false,
			});
		},
		onCommit: () => {
			editor.project.updateSettings({
				settings: {
					background: {
						type: "blur",
						blurIntensity: lastBlurValueRef.current,
					},
				},
			});
		},
	});

	const setBackgroundMode = (value: string) => {
		if (value === "color") {
			const currentColor =
				activeProject.settings.background.type === "color"
					? activeProject.settings.background.color
					: DEFAULT_COLOR;
			editor.project.updateSettings({
				settings: { background: { type: "color", color: currentColor } },
			});
			return;
		}

		if (value === "blur") {
			editor.project.updateSettings({
				settings: {
					background: {
						type: "blur",
						blurIntensity: lastBlurValueRef.current,
					},
				},
			});
			return;
		}

		editor.project.updateSettings({
			settings: {
				background: {
					type: "image",
					mediaId:
						activeProject.settings.background.type === "image"
							? activeProject.settings.background.mediaId ?? imageAssets[0]?.id ?? null
							: imageAssets[0]?.id ?? null,
				},
			},
		});
	};

	const setBackgroundColor = (color: string) => {
		editor.project.updateSettings({
			settings: { background: { type: "color", color } },
		});
	};

	const setBackgroundImage = (mediaId: string) => {
		editor.project.updateSettings({
			settings: { background: { type: "image", mediaId } },
		});
	};

	return (
		<PanelView contentClassName="px-0" hideHeader>
			<input {...backgroundImageInputProps} />
			<div className="flex flex-col">
				<Section showTopBorder={false}>
					<SectionContent>
						<ProjectInfoContent />
					</SectionContent>
				</Section>
				<Section>
					<SectionHeader>
						<SectionTitle>Background</SectionTitle>
					</SectionHeader>
					<SectionContent>
						<SectionFields>
							<SectionField label="Mode">
								<Select
									value={activeProject.settings.background.type}
									onValueChange={setBackgroundMode}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select background mode" />
									</SelectTrigger>
									<SelectContent>
										{BACKGROUND_MODE_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</SectionField>
							{activeProject.settings.background.type === "color" && (
								<SectionField label="Color">
									<input
										type="color"
										className="bg-accent border-border h-9 w-full rounded-md border px-2"
										value={activeProject.settings.background.color}
										onChange={(event) => setBackgroundColor(event.target.value)}
									/>
								</SectionField>
							)}
							{activeProject.settings.background.type === "blur" && (
								<SectionField label="Blur intensity">
									<NumberField
										icon="B"
										value={blurDraft.displayValue}
										min={0}
										max={100}
										onFocus={blurDraft.onFocus}
										onChange={blurDraft.onChange}
										onBlur={blurDraft.onBlur}
										onScrub={blurDraft.scrubTo}
										onScrubEnd={blurDraft.commitScrub}
										dragSensitivity="slow"
									/>
								</SectionField>
							)}
							{activeProject.settings.background.type === "image" && (
								<SectionField label="Background image">
									<div className="flex flex-col gap-2">
										<Button variant="outline" className="w-full" onClick={openBackgroundImagePicker}>
											Import image
										</Button>
										{imageAssets.length > 0 ? (
											<Select
												value={activeProject.settings.background.mediaId ?? undefined}
												onValueChange={setBackgroundImage}
											>
												<SelectTrigger className="w-full">
													<SelectValue placeholder="Select an image" />
												</SelectTrigger>
												<SelectContent>
													{imageAssets.map((asset) => (
														<SelectItem key={asset.id} value={asset.id}>
															{asset.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										) : (
											<div className="text-muted-foreground text-xs">
												Import an image to use it as the background.
											</div>
										)}
									</div>
								</SectionField>
							)}
						</SectionFields>
					</SectionContent>
				</Section>
			</div>
		</PanelView>
	);
}

function ProjectInfoContent() {
	const editor = useEditor();
	const activeProject = editor.project.getActive();
	const { canvasPresets } = useEditorStore();

	const currentCanvasSize = activeProject.settings.canvasSize;
	const currentAspectRatio = dimensionToAspectRatio(currentCanvasSize);
	const originalCanvasSize = activeProject.settings.originalCanvasSize ?? null;
	const presetIndex = findPresetIndexByAspectRatio({
		presets: canvasPresets,
		targetAspectRatio: currentAspectRatio,
	});
	const selectedPresetValue =
		presetIndex !== -1 ? presetIndex.toString() : ORIGINAL_PRESET_VALUE;

	const handleAspectRatioChange = ({ value }: { value: string }) => {
		if (value === ORIGINAL_PRESET_VALUE) {
			const canvasSize = originalCanvasSize ?? currentCanvasSize;
			editor.project.updateSettings({
				settings: { canvasSize },
			});
			return;
		}
		const index = parseInt(value, 10);
		const preset = canvasPresets[index];
		if (preset) {
			editor.project.updateSettings({ settings: { canvasSize: preset } });
		}
	};

	const handleFpsChange = ({ value }: { value: string }) => {
		const fps = parseFloat(value);
		editor.project.updateSettings({ settings: { fps } });
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label>Name</Label>
				<span className="leading-none text-sm">
					{activeProject.metadata.name}
				</span>
			</div>
			<div className="flex flex-col gap-2">
				<Label>Aspect ratio</Label>
				<Select
					value={selectedPresetValue}
					onValueChange={(value: string) => handleAspectRatioChange({ value })}
				>
					<SelectTrigger className="w-fit">
						<SelectValue placeholder="Select an aspect ratio" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ORIGINAL_PRESET_VALUE}>Original</SelectItem>
						{canvasPresets.map((preset: { width: number; height: number }, index: number) => {
							const label = dimensionToAspectRatio({
								width: preset.width,
								height: preset.height,
							});
							return (
								<SelectItem key={label} value={index.toString()}>
									{label}
								</SelectItem>
							);
						})}
					</SelectContent>
				</Select>
			</div>
			<div className="flex flex-col gap-2">
				<Label>Frame rate</Label>
				<Select
					value={activeProject.settings.fps.toString()}
					onValueChange={(value: string) => handleFpsChange({ value })}
				>
					<SelectTrigger className="w-fit">
						<SelectValue placeholder="Select a frame rate" />
					</SelectTrigger>
					<SelectContent>
						{FPS_PRESETS.map((preset) => (
							<SelectItem key={preset.value} value={preset.value}>
								{preset.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}
