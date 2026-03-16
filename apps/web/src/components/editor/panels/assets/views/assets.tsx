"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PanelView } from "@/components/editor/panels/assets/views/base-view";
import { MediaDragOverlay } from "@/components/editor/panels/assets/drag-overlay";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { TIMELINE_CONSTANTS } from "@/constants/timeline-constants";
import { useEditor } from "@/hooks/use-editor";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useRevealItem } from "@/hooks/use-reveal-item";
import { invokeAction } from "@/lib/actions";
import { processMediaAssets } from "@/lib/media/processing";
import { buildElementFromMedia, hasMediaId } from "@/lib/timeline/element-utils";
import {
	canReplaceTimelineElementWithMediaType,
	type ReplaceMediaTarget,
} from "@/lib/timeline/replace-media";
import { TabCaptureDialog } from "@/components/editor/panels/assets/tab-capture-dialog";
import {
	type MediaSortKey,
	type MediaSortOrder,
	type MediaViewMode,
	useAssetsPanelStore,
} from "@/stores/assets-panel-store";
import type { MediaAsset } from "@/types/assets";
import type { RecordedCursorData } from "@/types/cursor-tracking";
import { cn } from "@/utils/ui";
import {
	CloudUploadIcon,
	GridViewIcon,
	LeftToRightListDashIcon,
	SortingOneNineIcon,
	Image02Icon,
	MusicNote03Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

const CURSOR_TRACKING_EXTENSION_DOWNLOAD_PATH =
	"/downloads/opencut-cursor-tracker.zip";

export function MediaView() {
	const editor = useEditor();
	const mediaFiles = editor.media.getAssets();
	const activeProject = editor.project.getActive();

	const {
		mediaViewMode,
		setMediaViewMode,
		highlightMediaId,
		clearHighlight,
		mediaSortBy,
		mediaSortOrder,
		setMediaSort,
		replaceMediaTarget,
		clearReplaceMediaRequest,
	} = useAssetsPanelStore();
	const { highlightedId, registerElement } = useRevealItem(
		highlightMediaId,
		clearHighlight,
	);

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [isCaptureDialogOpen, setIsCaptureDialogOpen] = useState(false);
	const [assetToRename, setAssetToRename] = useState<MediaAsset | null>(null);

	const handleDownloadExtension = () => {
		const anchor = document.createElement("a");
		anchor.href = CURSOR_TRACKING_EXTENSION_DOWNLOAD_PATH;
		anchor.download = "opencut-cursor-tracker.zip";
		anchor.click();
	};

	const processFiles = async ({
		files,
		recordedCursor,
	}: {
		files: FileList | File[];
		recordedCursor?: RecordedCursorData;
	}): Promise<void> => {
		if (!files || files.length === 0) return;
		if (!activeProject) {
			toast.error("No active project");
			throw new Error("No active project");
		}

		setIsProcessing(true);
		setProgress(0);
		try {
			const processedAssets = await processMediaAssets({
				files,
				onProgress: (progress: { progress: number }) =>
					setProgress(progress.progress),
			});
			for (const asset of processedAssets) {
				const recordedCursorTracking = recordedCursor?.cursorTracking;
				const shouldAttachRecordedCursor =
					asset.type === "video" &&
					recordedCursorTracking?.status === "ready" &&
					recordedCursorTracking.samples.length > 0;
				const savedAsset = await editor.media.addMediaAsset({
					projectId: activeProject.metadata.id,
					asset: shouldAttachRecordedCursor
						? {
								...asset,
								cursorTracking: recordedCursorTracking,
								recordedCursor,
							}
						: asset,
				});
				if (savedAsset && shouldAttachRecordedCursor && savedAsset.type === "video") {
					toast.success("Cursor tracking attached", {
						description:
							recordedCursorTracking.samples.length +
							" samples were attached to the captured video.",
					});
				}
			}
		} catch (error) {
			console.error("Error processing files:", error);
			toast.error("Failed to process files");
			throw error instanceof Error ? error : new Error("Failed to process files");
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: "image/*,video/*,audio/*,.lottie,.json,application/json",
			multiple: true,
			onFilesSelected: (files) => {
				void processFiles({ files }).catch(() => undefined);
			},
		});

	const handleRemove = async ({
		event,
		id,
	}: {
		event: React.MouseEvent;
		id: string;
	}) => {
		event.stopPropagation();

		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		await editor.media.removeMediaAsset({
			projectId: activeProject.metadata.id,
			id,
		});
	};

	const handleRename = async ({ id, name }: { id: string; name: string }) => {
		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		const trimmedName = name.trim();
		if (!trimmedName) {
			toast.error("File name cannot be empty");
			return;
		}

		const updatedAsset = await editor.media.updateMediaAsset({
			projectId: activeProject.metadata.id,
			id,
			updates: { name: trimmedName },
		});

		if (!updatedAsset) {
			toast.error("Failed to rename file");
			return;
		}

		const timelineElementUpdates = editor.timeline
			.getTracks()
			.flatMap((track) =>
				track.elements
					.filter((element) => hasMediaId(element) && element.mediaId === id)
					.map((element) => ({
						trackId: track.id,
						elementId: element.id,
						updates: { name: trimmedName },
					})),
			);

		if (timelineElementUpdates.length > 0) {
			editor.timeline.updateElements({
				updates: timelineElementUpdates,
			});
		}

		toast.success("File renamed");
		setAssetToRename(null);
	};

	const handleSort = ({ key }: { key: MediaSortKey }) => {
		if (mediaSortBy === key) {
			setMediaSort(key, mediaSortOrder === "asc" ? "desc" : "asc");
		} else {
			setMediaSort(key, "asc");
		}
	};

	const handleReplaceMedia = ({ mediaId }: { mediaId: string }) => {
		if (!replaceMediaTarget) {
			toast.error("No clip selected for replacement");
			return;
		}

		invokeAction(
			"replace-media",
			{
				trackId: replaceMediaTarget.trackId,
				elementId: replaceMediaTarget.elementId,
				mediaId,
			},
			"mouseclick",
		);
	};

	const filteredMediaItems = useMemo(() => {
		const filtered = mediaFiles.filter((item) => !item.ephemeral);

		filtered.sort((a, b) => {
			let valueA: string | number;
			let valueB: string | number;

			switch (mediaSortBy) {
				case "name":
					valueA = a.name.toLowerCase();
					valueB = b.name.toLowerCase();
					break;
				case "type":
					valueA = a.type;
					valueB = b.type;
					break;
				case "duration":
					valueA = a.duration || 0;
					valueB = b.duration || 0;
					break;
				case "size":
					valueA = a.file.size;
					valueB = b.file.size;
					break;
				default:
					return 0;
			}

			if (valueA < valueB) return mediaSortOrder === "asc" ? -1 : 1;
			if (valueA > valueB) return mediaSortOrder === "asc" ? 1 : -1;
			return 0;
		});

		return filtered;
	}, [mediaFiles, mediaSortBy, mediaSortOrder]);

	return (
		<>
			<input {...fileInputProps} />
			<TabCaptureDialog
				disabled={isProcessing}
				isOpen={isCaptureDialogOpen}
				onOpenChange={setIsCaptureDialogOpen}
				onImport={({ files, recordedCursor }) => processFiles({ files, recordedCursor })}
			/>

			<PanelView
				title="Assets"
				actions={
					<MediaActions
						mediaViewMode={mediaViewMode}
						setMediaViewMode={setMediaViewMode}
						isProcessing={isProcessing}
						sortBy={mediaSortBy}
						sortOrder={mediaSortOrder}
						onSort={handleSort}
						onDownloadExtension={handleDownloadExtension}
						onImportFiles={openFilePicker}
						onCaptureTab={() => setIsCaptureDialogOpen(true)}
					/>
				}
				className={cn(isDragOver && "bg-accent/30")}
				{...dragProps}
			>
				{replaceMediaTarget ? (
					<div className="bg-accent/60 mb-3 flex items-center justify-between rounded-md px-3 py-2 text-sm">
						<span>Choose a compatible media asset to replace the selected clip.</span>
						<Button variant="ghost" size="sm" onClick={clearReplaceMediaRequest}>
							Cancel
						</Button>
					</div>
				) : null}
				{isDragOver || filteredMediaItems.length === 0 ? (
					<MediaDragOverlay
						isVisible={true}
						isProcessing={isProcessing}
						progress={progress}
						onClick={openFilePicker}
					/>
				) : (
					<MediaItemList
						items={filteredMediaItems}
						mode={mediaViewMode}
						onRemove={handleRemove}
						onRename={setAssetToRename}
						replaceMediaTarget={replaceMediaTarget}
						onReplaceMedia={handleReplaceMedia}
						highlightedId={highlightedId}
						registerElement={registerElement}
					/>
				)}
			</PanelView>
			<RenameMediaDialog
				asset={assetToRename}
				isOpen={assetToRename !== null}
				onOpenChange={(open) => {
					if (!open) {
						setAssetToRename(null);
					}
				}}
				onConfirm={({ id, name }) => void handleRename({ id, name })}
			/>
		</>
	);
}

function MediaAssetDraggable({
	item,
	preview,
	isHighlighted,
	variant,
	isRounded,
	replaceMediaTarget,
	onReplaceMedia,
}: {
	item: MediaAsset;
	preview: React.ReactNode;
	isHighlighted: boolean;
	variant: "card" | "compact";
	isRounded?: boolean;
	replaceMediaTarget?: ReplaceMediaTarget | null;
	onReplaceMedia?: ({ mediaId }: { mediaId: string }) => void;
}) {
	const editor = useEditor();

	const addElementAtTime = ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: number;
	}) => {
		const duration =
			asset.duration ?? TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION;
		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration,
			startTime,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	const canReplaceSelectedClip =
		replaceMediaTarget &&
		replaceMediaTarget.currentMediaId !== item.id &&
		canReplaceTimelineElementWithMediaType({
			elementType: replaceMediaTarget.elementType,
			mediaType: item.type,
		});

	return (
		<DraggableItem
			name={item.name}
			preview={preview}
			dragData={{
				id: item.id,
				type: "media",
				mediaType: item.type,
				name: item.name,
				targetElementTypes:
					item.type === "audio"
						? (["audio"] as const)
						: item.type === "video"
							? (["video"] as const)
							: (["image"] as const),
			}}
			shouldShowPlusOnDrag={false}
			onAddToTimeline={({ currentTime }) =>
				canReplaceSelectedClip && onReplaceMedia
					? onReplaceMedia({ mediaId: item.id })
					: addElementAtTime({ asset: item, startTime: currentTime })
			}
			variant={variant}
			isRounded={isRounded}
			isHighlighted={isHighlighted}
		/>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
	onRename,
	replaceMediaTarget,
	onReplaceMedia,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
	onRename: (asset: MediaAsset) => void;
	replaceMediaTarget?: ReplaceMediaTarget | null;
	onReplaceMedia?: ({ mediaId }: { mediaId: string }) => void;
}) {
	const hasReadyCursorTracking = item.cursorTracking?.status === "ready";
	const canReplaceSelectedClip =
		replaceMediaTarget &&
		replaceMediaTarget.currentMediaId !== item.id &&
		canReplaceTimelineElementWithMediaType({
			elementType: replaceMediaTarget.elementType,
			mediaType: item.type,
		});
	const handleAttachCursorTracking = () => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json,application/json";
		input.multiple = false;
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (!file) {
				return;
			}
			invokeAction("attach-cursor-tracking", { mediaId: item.id, file }, "mouseclick");
		});
		input.click();
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={() => onRename(item)}>Rename</ContextMenuItem>
				{replaceMediaTarget ? (
					<ContextMenuItem
						disabled={!canReplaceSelectedClip}
						onClick={() => onReplaceMedia?.({ mediaId: item.id })}
					>
						Replace selected clip
					</ContextMenuItem>
				) : null}
				{item.type === "video" ? (
					<ContextMenuItem onClick={handleAttachCursorTracking}>
						{hasReadyCursorTracking
							? "Replace cursor tracking"
							: "Attach cursor tracking"}
					</ContextMenuItem>
				) : null}
				<ContextMenuItem>Export clips</ContextMenuItem>
				<ContextMenuItem
					variant="destructive"
					onClick={(event) => onRemove({ event, id: item.id })}
				>
					Delete
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MediaItemList({
	items,
	mode,
	onRemove,
	onRename,
	replaceMediaTarget,
	onReplaceMedia,
	highlightedId,
	registerElement,
}: {
	items: MediaAsset[];
	mode: MediaViewMode;
	onRemove: ({ event, id }: { event: React.MouseEvent; id: string }) => void;
	onRename: (asset: MediaAsset) => void;
	replaceMediaTarget?: ReplaceMediaTarget | null;
	onReplaceMedia?: ({ mediaId }: { mediaId: string }) => void;
	highlightedId: string | null;
	registerElement: (id: string, element: HTMLElement | null) => void;
}) {
	const isGrid = mode === "grid";

	return (
		<div
			className={cn(isGrid ? "grid gap-2" : "flex flex-col gap-1")}
			style={
				isGrid ? { gridTemplateColumns: "repeat(auto-fill, 160px)" } : undefined
			}
		>
			{items.map((item) => (
				<div key={item.id} ref={(element) => registerElement(item.id, element)}>
					<MediaItemWithContextMenu
						item={item}
						onRemove={onRemove}
						onRename={onRename}
						replaceMediaTarget={replaceMediaTarget}
						onReplaceMedia={onReplaceMedia}
					>
						<MediaAssetDraggable
							item={item}
							preview={
								<MediaPreview
									item={item}
									variant={isGrid ? "grid" : "compact"}
								/>
							}
							variant={isGrid ? "card" : "compact"}
							isRounded={isGrid ? false : undefined}
							isHighlighted={highlightedId === item.id}
							replaceMediaTarget={replaceMediaTarget}
							onReplaceMedia={onReplaceMedia}
						/>
					</MediaItemWithContextMenu>
				</div>
			))}
		</div>
	);
}

function RenameMediaDialog({
	asset,
	isOpen,
	onOpenChange,
	onConfirm,
}: {
	asset: MediaAsset | null;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: ({ id, name }: { id: string; name: string }) => void;
}) {
	const [name, setName] = useState("");

	const handleOpenChange = (open: boolean) => {
		if (open && asset) {
			setName(asset.name);
		}
		onOpenChange(open);
	};

	if (!asset) {
		return null;
	}

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename file</DialogTitle>
				</DialogHeader>
				<DialogBody className="gap-3">
					<Label htmlFor="rename-media-input">New name</Label>
					<Input
						id="rename-media-input"
						value={name}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								onConfirm({ id: asset.id, name });
							}
						}}
						placeholder="Enter a new file name"
					/>
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => onConfirm({ id: asset.id, name })}>Rename</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function formatDuration({ duration }: { duration: number }) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function CursorTrackingBadge() {
return (
<div className="absolute top-1 left-1 rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
Tracked
</div>
);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

function MediaPreview({
	item,
	variant = "grid",
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
}) {
	const shouldShowDurationBadge = variant === "grid";

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center">
				<Image
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
			</div>
		);
	}

	if (item.type === "video") {
		const hasReadyCursorTracking = item.cursorTracking?.status === "ready";

		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{hasReadyCursorTracking ? <CursorTrackingBadge /> : null}
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		if (item.url) {
			return (
				<div className="relative size-full">
					<video
						src={item.url}
						className="size-full rounded object-cover"
						muted
						playsInline
						preload="metadata"
					/>
					{hasReadyCursorTracking ? <CursorTrackingBadge /> : null}
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<div className="relative size-full">
				<MediaTypePlaceholder
					icon={Video01Icon}
					label="Video"
					duration={item.duration}
					variant="muted"
				/>
				{hasReadyCursorTracking ? <CursorTrackingBadge /> : null}
			</div>
		);
	}

if (item.type === "lottie") {
		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-contain"
						loading="lazy"
						unoptimized
					/>
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<MediaTypePlaceholder
				icon={Image02Icon}
				label="Lottie"
				duration={item.duration}
				variant="muted"
			/>
		);
	}

	if (item.type === "audio") {
		return (
			<MediaTypePlaceholder
				icon={MusicNote03Icon}
				label="Audio"
				duration={item.duration}
				variant="bordered"
			/>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="Unknown" variant="muted" />
	);
}

function MediaActions({
	mediaViewMode,
	setMediaViewMode,
	isProcessing,
	sortBy,
	sortOrder,
	onSort,
	onDownloadExtension,
	onImportFiles,
	onCaptureTab,
}: {
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	isProcessing: boolean;
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
	onDownloadExtension: () => void;
	onImportFiles: () => void;
	onCaptureTab: () => void;
}) {
	return (
		<div className="flex gap-1.5">
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							size="icon"
							variant="ghost"
							onClick={() =>
								setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")
							}
							disabled={isProcessing}
							className="items-center justify-center"
						>
							{mediaViewMode === "grid" ? (
								<HugeiconsIcon icon={LeftToRightListDashIcon} />
							) : (
								<HugeiconsIcon icon={GridViewIcon} />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>
							{mediaViewMode === "grid"
								? "Switch to list view"
								: "Switch to grid view"}
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<DropdownMenu>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									disabled={isProcessing}
									className="items-center justify-center"
								>
									<HugeiconsIcon icon={SortingOneNineIcon} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<DropdownMenuContent align="end">
							<SortMenuItem
								label="Name"
								sortKey="name"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Type"
								sortKey="type"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Duration"
								sortKey="duration"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="File size"
								sortKey="size"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
					<TooltipContent>
						<p>
							Sort by {sortBy} (
							{sortOrder === "asc" ? "ascending" : "descending"})
						</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<Button
				variant="outline"
				disabled={isProcessing}
				size="sm"
				onClick={onDownloadExtension}
			>
				Download extension
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						disabled={isProcessing}
						size="sm"
						className="items-center justify-center gap-1.5"
					>
						<HugeiconsIcon icon={CloudUploadIcon} />
						Import
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						icon={<HugeiconsIcon icon={CloudUploadIcon} />}
						onClick={onImportFiles}
					>
						Import files
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						icon={<HugeiconsIcon icon={Video01Icon} />}
						onClick={onCaptureTab}
					>
						Capture tab
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: MediaSortKey;
	currentSortBy: MediaSortKey;
	currentSortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
