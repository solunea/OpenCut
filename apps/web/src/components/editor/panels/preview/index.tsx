"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import useDeepCompareEffect from "use-deep-compare-effect";
import { useEditor } from "@/hooks/use-editor";
import { useRafLoop } from "@/hooks/use-raf-loop";
import { useContainerSize } from "@/hooks/use-container-size";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { nativeVideoPreview } from "@/services/renderer/native-video-preview";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import { buildScene } from "@/services/renderer/scene-builder";
import { getLastFrameTime } from "@/lib/time";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { BookmarkNoteOverlay } from "./bookmark-note-overlay";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { usePreviewStore } from "@/stores/preview-store";
import { PreviewContextMenu } from "./context-menu";
import { PreviewToolbar } from "./toolbar";

function usePreviewSize() {
	const editor = useEditor({ subscribeTo: ["project"] });
	const activeProject = editor.project.getActive();

	return {
		width: activeProject?.settings.canvasSize.width,
		height: activeProject?.settings.canvasSize.height,
	};
}

const PREVIEW_RENDER_SCALES = [1, 0.85, 0.7, 0.55, 0.4] as const;
const PREVIEW_IDLE_FULL_SCALE_DELAY_MS = 180;

export function PreviewPanel() {
	const containerRef = useRef<HTMLDivElement>(null);
	const { isFullscreen, toggleFullscreen } = useFullscreen({ containerRef });

	return (
		<div
			ref={containerRef}
			className="panel bg-background relative flex size-full min-h-0 min-w-0 flex-col rounded-sm border"
		>
			<div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-2 pb-0">
				<PreviewCanvas
					onToggleFullscreen={toggleFullscreen}
					containerRef={containerRef}
				/>
				<RenderTreeController />
			</div>
			<PreviewToolbar
				isFullscreen={isFullscreen}
				onToggleFullscreenAction={toggleFullscreen}
			/>
		</div>
	);
}

function RenderTreeController() {
	const editor = useEditor({ subscribeTo: ["timeline", "media", "project", "scenes"] });
	const tracks = editor.timeline.getTracks();
	const mediaAssets = editor.media.getAssets();
	const activeProject = editor.project.getActive();

	const { width, height } = usePreviewSize();

	useDeepCompareEffect(() => {
		if (!activeProject) return;

		const duration = editor.timeline.getTotalDuration();
		const renderTree = buildScene({
			tracks,
			mediaAssets,
			duration,
			canvasSize: { width, height },
			background: activeProject.settings.background,
			isPreview: true,
		});

		editor.renderer.setRenderTree({ renderTree });
	}, [tracks, mediaAssets, activeProject?.settings.background, width, height]);

	return null;
}

function PreviewCanvas({
	onToggleFullscreen,
	containerRef,
}: {
	onToggleFullscreen: () => void;
	containerRef: React.RefObject<HTMLElement | null>;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const outerContainerRef = useRef<HTMLDivElement>(null);
	const canvasBoundsRef = useRef<HTMLDivElement>(null);
	const lastFrameRef = useRef(-1);
	const lastSceneRef = useRef<RootNode | null>(null);
	const renderingRef = useRef(false);
	const adaptiveScaleIndexRef = useRef(0);
	const slowFrameCountRef = useRef(0);
	const fastFrameCountRef = useRef(0);
	const idleFullScaleTimeoutRef = useRef<number | null>(null);
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const containerSize = useContainerSize({ containerRef: outerContainerRef });
	const editor = useEditor({ subscribeTo: ["project", "renderer"] });
	const activeProject = editor.project.getActive();
	const { overlays } = usePreviewStore();

	const renderer = useMemo(() => {
		return new CanvasRenderer({
			width: nativeWidth,
			height: nativeHeight,
			fps: activeProject.settings.fps,
			mode: "preview",
		});
	}, [nativeWidth, nativeHeight, activeProject.settings.fps]);

	const applyAdaptiveRenderScale = useCallback(
		({ nextIndex }: { nextIndex: number }) => {
			const boundedIndex = Math.min(
				Math.max(nextIndex, 0),
				PREVIEW_RENDER_SCALES.length - 1,
			);
			if (boundedIndex === adaptiveScaleIndexRef.current) {
				return;
			}
			adaptiveScaleIndexRef.current = boundedIndex;
			slowFrameCountRef.current = 0;
			fastFrameCountRef.current = 0;
			if (
				renderer.setRenderScale({
					renderScale: PREVIEW_RENDER_SCALES[boundedIndex],
				})
			) {
				lastFrameRef.current = -1;
			}
		},
		[renderer],
	);

	const clearIdleFullScaleTimeout = useCallback(() => {
		if (idleFullScaleTimeoutRef.current !== null) {
			window.clearTimeout(idleFullScaleTimeoutRef.current);
			idleFullScaleTimeoutRef.current = null;
		}
	}, []);

	const scheduleIdleFullScaleRestore = useCallback(() => {
		clearIdleFullScaleTimeout();
		if (adaptiveScaleIndexRef.current === 0) {
			return;
		}
		idleFullScaleTimeoutRef.current = window.setTimeout(() => {
			idleFullScaleTimeoutRef.current = null;
			applyAdaptiveRenderScale({ nextIndex: 0 });
		}, PREVIEW_IDLE_FULL_SCALE_DELAY_MS);
	}, [applyAdaptiveRenderScale, clearIdleFullScaleTimeout]);

	const handleRenderDuration = useCallback(
		({ durationMs }: { durationMs: number }) => {
			clearIdleFullScaleTimeout();
			const frameBudgetMs = 1000 / Math.max(renderer.fps, 1);
			const currentIndex = adaptiveScaleIndexRef.current;

			if (durationMs > frameBudgetMs * 2.2) {
				applyAdaptiveRenderScale({ nextIndex: currentIndex + 2 });
				return;
			}

			if (durationMs > frameBudgetMs * 1.15) {
				slowFrameCountRef.current += 1;
				fastFrameCountRef.current = 0;
				if (slowFrameCountRef.current >= 2) {
					applyAdaptiveRenderScale({ nextIndex: currentIndex + 1 });
				}
				return;
			}

			slowFrameCountRef.current = 0;

			if (currentIndex === 0) {
				fastFrameCountRef.current = 0;
				return;
			}

			if (durationMs < frameBudgetMs * 0.65) {
				fastFrameCountRef.current += 1;
				if (fastFrameCountRef.current >= 24) {
					applyAdaptiveRenderScale({ nextIndex: currentIndex - 1 });
				}
				return;
			}

			fastFrameCountRef.current = 0;
		},
		[applyAdaptiveRenderScale, clearIdleFullScaleTimeout, renderer.fps],
	);

	useEffect(() => {
		adaptiveScaleIndexRef.current = 0;
		slowFrameCountRef.current = 0;
		fastFrameCountRef.current = 0;
		clearIdleFullScaleTimeout();
		renderer.setRenderScale({ renderScale: PREVIEW_RENDER_SCALES[0] });
		lastFrameRef.current = -1;
		return () => {
			clearIdleFullScaleTimeout();
			nativeVideoPreview.clearAll();
		};
	}, [clearIdleFullScaleTimeout, renderer]);

	const displaySize = useMemo(() => {
		if (
			!nativeWidth ||
			!nativeHeight ||
			containerSize.width === 0 ||
			containerSize.height === 0
		) {
			return { width: nativeWidth ?? 0, height: nativeHeight ?? 0 };
		}

		const paddingBuffer = 4;
		const availableWidth = containerSize.width - paddingBuffer;
		const availableHeight = containerSize.height - paddingBuffer;

		const aspectRatio = nativeWidth / nativeHeight;
		const containerAspect = availableWidth / availableHeight;

		const displayWidth =
			containerAspect > aspectRatio
				? availableHeight * aspectRatio
				: availableWidth;
		const displayHeight =
			containerAspect > aspectRatio
				? availableHeight
				: availableWidth / aspectRatio;

		return { width: displayWidth, height: displayHeight };
	}, [nativeWidth, nativeHeight, containerSize.width, containerSize.height]);

	const renderTree = editor.renderer.getRenderTree();

	const render = useCallback(() => {
		if (canvasRef.current && renderTree && !renderingRef.current) {
			const time = editor.playback.getCurrentTime();
			renderer.setPlaybackState({
				isPlaying: editor.playback.getIsPlaying(),
			});
			const lastFrameTime = getLastFrameTime({
				duration: renderTree.duration,
				fps: renderer.fps,
			});
			const renderTime = Math.min(time, lastFrameTime);
			const frame = Math.floor(renderTime * renderer.fps);

			if (
				frame !== lastFrameRef.current ||
				renderTree !== lastSceneRef.current
			) {
				clearIdleFullScaleTimeout();
				renderingRef.current = true;
				const renderStartedAt = performance.now();
				lastSceneRef.current = renderTree;
				lastFrameRef.current = frame;
				renderer
					.renderToCanvas({
						node: renderTree,
						time: renderTime,
						targetCanvas: canvasRef.current,
					})
					.catch((error) => {
						console.error("Failed to render preview frame", error);
					})
					.finally(() => {
						handleRenderDuration({
							durationMs: performance.now() - renderStartedAt,
						});
						renderingRef.current = false;
					});
			} else {
				scheduleIdleFullScaleRestore();
			}
		}
	}, [
		clearIdleFullScaleTimeout,
		renderer,
		renderTree,
		editor.playback,
		handleRenderDuration,
		scheduleIdleFullScaleRestore,
	]);

	useRafLoop(render);

	return (
		<div
			ref={outerContainerRef}
			className="relative flex size-full items-center justify-center"
		>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						ref={canvasBoundsRef}
						className="relative"
						style={{ width: displaySize.width, height: displaySize.height }}
					>
						<canvas
							ref={canvasRef}
							width={nativeWidth}
							height={nativeHeight}
							className="block border"
							style={{
								width: displaySize.width,
								height: displaySize.height,
								background:
									activeProject.settings.background.type === "blur" ||
									activeProject.settings.background.type === "image"
										? "transparent"
										: activeProject?.settings.background.color,
							}}
						/>
						<PreviewInteractionOverlay
							canvasRef={canvasRef}
							containerRef={canvasBoundsRef}
						/>
						{overlays.bookmarks && <BookmarkNoteOverlay />}
					</div>
				</ContextMenuTrigger>
				<PreviewContextMenu
					onToggleFullscreen={onToggleFullscreen}
					containerRef={containerRef}
				/>
			</ContextMenu>
		</div>
	);
}
