"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	cancelCursorTrackingCaptureSession,
	startCursorTrackingCaptureSession,
	stopAndExportCursorTrackingCaptureSession,
} from "@/lib/media/cursor-tracking-extension";
import type { RecordedCursorData } from "@/types/cursor-tracking";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

type CaptureState = "idle" | "recording" | "finalizing";

interface TabCaptureDialogProps {
	disabled?: boolean;
	isOpen: boolean;
	onImport: ({
		files,
		recordedCursor,
	}: {
		files: File[];
		recordedCursor?: RecordedCursorData;
	}) => Promise<void>;
	onOpenChange: (open: boolean) => void;
}

type CursorCaptureConstraint = "always" | "motion" | "never";
type DisplayMediaVideoConstraints = MediaTrackConstraints & {
	cursor?: CursorCaptureConstraint;
};
type DisplayCaptureTrackSettings = MediaTrackSettings & {
	cursor?: CursorCaptureConstraint;
};

async function applyCursorVisibilityConstraint({
	stream,
	shouldHideNativeCursor,
}: {
	stream: MediaStream;
	shouldHideNativeCursor: boolean;
}): Promise<CursorCaptureConstraint | undefined> {
	const [videoTrack] = stream.getVideoTracks();
	if (!videoTrack) {
		return undefined;
	}

	const cursor: CursorCaptureConstraint = shouldHideNativeCursor ? "never" : "always";
	try {
		await videoTrack.applyConstraints({
			cursor,
		} as MediaTrackConstraints);
	} catch (error) {
		console.warn("Failed to apply cursor visibility constraint to tab capture", error);
	}

	return (videoTrack.getSettings() as DisplayCaptureTrackSettings).cursor;
}

function getSupportedRecorderMimeType(): string | undefined {
	const candidates = [
		"video/webm;codecs=vp9,opus",
		"video/webm;codecs=vp8,opus",
		"video/webm;codecs=h264,opus",
		"video/webm",
	];

	for (const candidate of candidates) {
		if (MediaRecorder.isTypeSupported(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

function buildCaptureFile({ mimeType }: { mimeType: string }): File {
	const timestamp = new Date().toISOString().replaceAll(":", "-");
	const extension = mimeType.includes("mp4") ? "mp4" : "webm";
	return new File([], `tab-capture-${timestamp}.${extension}`, {
		type: mimeType,
		lastModified: Date.now(),
	});
}

function stopStream(stream: MediaStream | null): void {
	stream?.getTracks().forEach((track) => track.stop());
}

export function TabCaptureDialog({
	disabled,
	isOpen,
	onImport,
	onOpenChange,
}: TabCaptureDialogProps) {
	const [captureState, setCaptureState] = useState<CaptureState>("idle");
	const [shouldHideNativeCursor, setShouldHideNativeCursor] = useState(true);
	const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
	const videoRef = useRef<HTMLVideoElement>(null);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const mimeTypeRef = useRef<string>("video/webm");
	const hasCursorTrackingSessionRef = useRef(false);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		video.srcObject = previewStream;
		if (previewStream) {
			void video.play().catch(() => undefined);
		}

		return () => {
			video.pause();
			video.srcObject = null;
		};
	}, [previewStream]);

	useEffect(() => {
		return () => {
			stopStream(streamRef.current);
			if (hasCursorTrackingSessionRef.current) {
				void cancelCursorTrackingCaptureSession();
				hasCursorTrackingSessionRef.current = false;
			}
		};
	}, []);

	const cancelTrackingSessionIfNeeded = async () => {
		if (!hasCursorTrackingSessionRef.current) {
			return;
		}
		hasCursorTrackingSessionRef.current = false;
		await cancelCursorTrackingCaptureSession();
	};

	const resetCapture = () => {
		chunksRef.current = [];
		recorderRef.current = null;
		stopStream(streamRef.current);
		streamRef.current = null;
		setPreviewStream(null);
	};

	const finalizeCapture = async () => {
		const mimeType = mimeTypeRef.current;
		const blob = new Blob(chunksRef.current, { type: mimeType });

		if (blob.size === 0) {
			await cancelTrackingSessionIfNeeded();
			resetCapture();
			setCaptureState("idle");
			toast.error("No video was recorded");
			return;
		}

		setCaptureState("finalizing");

		try {
			let recordedCursor: RecordedCursorData | undefined;
			if (hasCursorTrackingSessionRef.current) {
				try {
					recordedCursor = await stopAndExportCursorTrackingCaptureSession();
				} catch (error) {
					toast.error("Cursor tracking was not attached", {
						description:
							error instanceof Error
								? error.message
								: "The extension did not return any tracking data",
					});
				} finally {
					hasCursorTrackingSessionRef.current = false;
				}
			}

			const templateFile = buildCaptureFile({ mimeType });
			const file = new File([blob], templateFile.name, {
				type: mimeType,
				lastModified: templateFile.lastModified,
			});
			await onImport({ files: [file], recordedCursor });
			toast.success(
				recordedCursor
					? "Tab capture imported with cursor tracking"
					: "Tab capture imported",
			);
			resetCapture();
			setCaptureState("idle");
			onOpenChange(false);
		} catch (error) {
			console.error("Failed to import tab capture", error);
			toast.error("Failed to import tab capture", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
			await cancelTrackingSessionIfNeeded();
			resetCapture();
			setCaptureState("idle");
		}
	};

	const stopCapture = () => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.stop();
		}
		stopStream(streamRef.current);
		setPreviewStream(null);
	};

	const startCapture = async () => {
		if (typeof window === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
			toast.error("Tab capture is not supported in this browser");
			return;
		}

		if (typeof MediaRecorder === "undefined") {
			toast.error("Recording is not supported in this browser");
			return;
		}

		try {
			const videoConstraints: DisplayMediaVideoConstraints = {
				frameRate: 30,
				cursor: shouldHideNativeCursor ? "never" : "always",
			};
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: videoConstraints,
				audio: true,
			});
			const appliedCursor = await applyCursorVisibilityConstraint({
				stream,
				shouldHideNativeCursor,
			});
			if (shouldHideNativeCursor && appliedCursor !== undefined && appliedCursor !== "never") {
				toast.warning("Browser did not fully hide the native cursor", {
					description:
						"The capture track is using cursor mode \"" +
						appliedCursor +
						'" instead of "never".',
				});
			}
			await startCursorTrackingCaptureSession({
				shouldHideNativeCursor,
			});
			hasCursorTrackingSessionRef.current = true;
			const mimeType = getSupportedRecorderMimeType();
			const recorder = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);

			chunksRef.current = [];
			mimeTypeRef.current = recorder.mimeType || mimeType || "video/webm";
			streamRef.current = stream;
			recorderRef.current = recorder;
			setPreviewStream(stream);
			setCaptureState("recording");

			recorder.addEventListener("dataavailable", (event) => {
				if (event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			});

			recorder.addEventListener("stop", () => {
				void finalizeCapture();
			});

			stream.getTracks().forEach((track) => {
				track.addEventListener("ended", () => {
					if (recorderRef.current?.state === "recording") {
						stopCapture();
					}
				});
			});

			recorder.start(250);
		} catch (error) {
			console.error("Failed to start tab capture", error);
			await cancelTrackingSessionIfNeeded();
			resetCapture();
			setCaptureState("idle");
			toast.error("Failed to start tab capture", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
		}
	};

	const handleOpenChange = (open: boolean) => {
		if (!open && captureState !== "idle") {
			return;
		}

		if (!open) {
			void cancelTrackingSessionIfNeeded();
			resetCapture();
			setCaptureState("idle");
		}

		onOpenChange(open);
	};

	const isRecording = captureState === "recording";
	const isFinalizing = captureState === "finalizing";

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Capture tab</DialogTitle>
					<DialogDescription>
						Open your browser picker, choose the tab you want to record, then stop the capture to import it directly into Assets with automatic cursor tracking from the OpenCut extension.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<div className="flex flex-col gap-3">
						<div className="bg-muted/30 flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border">
							{previewStream ? (
								<video
									ref={videoRef}
									className="size-full object-cover"
									playsInline
									muted
								/>
							) : (
								<div className="text-muted-foreground flex max-w-sm flex-col items-center gap-2 px-6 text-center text-sm">
									<span>Record a browser tab and import the resulting clip directly into your media library.</span>
									<span>The browser picker will still let you choose the exact tab.</span>
									<span>The OpenCut Cursor Tracker extension will record cursor events in parallel and attach them automatically.</span>
								</div>
							)}
						</div>
						<div className="text-muted-foreground text-sm">
							{isRecording
								? "Recording in progress. Stop when you want to import the clip."
								: isFinalizing
									? "Finalizing, importing capture, and attaching cursor tracking..."
									: "Tip: choose a browser tab in the system picker for the cleanest result."}
						</div>
						<div className="flex items-center justify-between rounded-lg border px-3 py-2">
							<div className="flex flex-col gap-0.5">
								<Label htmlFor="hide-native-cursor">Hide mouse cursor in tab capture</Label>
								<span className="text-muted-foreground text-xs">
									Disable this if you want the browser to include the native cursor in the recording.
								</span>
							</div>
							<Switch
								id="hide-native-cursor"
								checked={shouldHideNativeCursor}
								onCheckedChange={setShouldHideNativeCursor}
								disabled={isRecording || isFinalizing}
							/>
						</div>
					</div>
				</DialogBody>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => handleOpenChange(false)}
						disabled={isRecording || isFinalizing}
					>
						Cancel
					</Button>
					{isRecording ? (
						<Button onClick={stopCapture} disabled={disabled || isFinalizing}>
							Stop and import
						</Button>
					) : (
						<Button onClick={() => void startCapture()} disabled={disabled || isFinalizing}>
							Start capture
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
