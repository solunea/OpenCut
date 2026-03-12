import { useEffect } from "react";
import { toast } from "sonner";
import { useEditor } from "@/hooks/use-editor";
import { isLottieJsonFile } from "@/lib/media/lottie";
import {
	getMediaTypeFromFile,
	getTrackTypeFromMediaType,
} from "@/lib/media/media-utils";
import { processMediaAssets } from "@/lib/media/processing";
import { buildElementFromMedia } from "@/lib/timeline/element-utils";
import { AddMediaAssetCommand } from "@/lib/commands/media";
import { InsertElementCommand } from "@/lib/commands/timeline";
import { BatchCommand } from "@/lib/commands";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { isTypableDOMElement } from "@/utils/browser";

async function extractMediaFilesFromClipboard({
	clipboardData,
}: {
	clipboardData: DataTransfer | null;
}): Promise<File[]> {
	if (!clipboardData?.items) return [];

	const files: File[] = [];
	for (const item of clipboardData.items) {
		if (item.kind !== "file") continue;

		const file = item.getAsFile();
		if (!file) continue;

		const mediaType = getMediaTypeFromFile({ file });
		if (mediaType || (await isLottieJsonFile({ file }))) {
			files.push(file);
		}
	}
	return files;
}

export function usePasteMedia() {
	const editor = useEditor();

	useEffect(() => {
		const handlePaste = async (event: ClipboardEvent) => {
			const activeElement = document.activeElement as HTMLElement;
			if (activeElement && isTypableDOMElement({ element: activeElement })) {
				return;
			}

			const files = await extractMediaFilesFromClipboard({
				clipboardData: event.clipboardData,
			});
			if (files.length === 0) return;

			event.preventDefault();

			const activeProject = editor.project.getActive();
			if (!activeProject) return;

			try {
				const processedAssets = await processMediaAssets({ files });
				const startTime = editor.playback.getCurrentTime();

				for (const asset of processedAssets) {
					const addMediaCmd = new AddMediaAssetCommand(
						activeProject.metadata.id,
						asset,
					);
					const assetId = addMediaCmd.getAssetId();
					const duration =
						asset.duration ?? TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION;
					const trackType = getTrackTypeFromMediaType({
						mediaType: asset.type,
					});

					const element = buildElementFromMedia({
						mediaId: assetId,
						mediaType: asset.type,
						name: asset.name,
						duration,
						startTime,
						buffer:
							asset.type === "audio"
								? new AudioBuffer({ length: 1, sampleRate: 44100 })
								: undefined,
					});

					const insertCmd = new InsertElementCommand({
						element,
						placement: { mode: "auto", trackType },
					});
					const batchCmd = new BatchCommand([addMediaCmd, insertCmd]);
					editor.command.execute({ command: batchCmd });
				}
			} catch (error) {
				console.error("Failed to paste media:", error);
				toast.error("Failed to paste media");
			}
		};

		window.addEventListener("paste", handlePaste);
		return () => window.removeEventListener("paste", handlePaste);
	}, [editor]);
}
