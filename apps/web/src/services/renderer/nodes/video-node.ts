import type { CanvasRenderer } from "../canvas-renderer";
import { nativeVideoPreview } from "../native-video-preview";
import { VisualNode, type VisualNodeParams } from "./visual-node";
import { resolveEffectParamsAtTime } from "@/lib/animation/effect-param-channel";
import { resolveZoomRenderState } from "@/lib/effects/definitions/zoom";
import { videoCache } from "@/services/video-cache/service";

export interface VideoNodeParams extends VisualNodeParams {
	url: string;
	file: File;
	mediaId: string;
}

export class VideoNode extends VisualNode<VideoNodeParams> {
	private previewFallbackStaticDecision: boolean | null = null;

	private previewFallbackFrameDecisions = new Map<number, boolean>();

	private getPreviewFallbackFrameKey({
		animationLocalTime,
		fps,
	}: {
		animationLocalTime: number;
		fps: number;
	}): number {
		return Math.max(0, Math.floor(animationLocalTime * Math.max(fps, 1)));
	}

	private cachePreviewFallbackDecision({
		frameKey,
		decision,
	}: {
		frameKey: number;
		decision: boolean;
	}): void {
		this.previewFallbackFrameDecisions.set(frameKey, decision);
		if (this.previewFallbackFrameDecisions.size <= 24) {
			return;
		}
		const oldestFrameKey = this.previewFallbackFrameDecisions.keys().next().value;
		if (typeof oldestFrameKey === "number") {
			this.previewFallbackFrameDecisions.delete(oldestFrameKey);
		}
	}

	private hasPreviewNativeFallbackEffects({
		renderer,
		time,
	}: {
		renderer: CanvasRenderer;
		time: number;
	}): boolean {
		if (this.previewFallbackStaticDecision !== null) {
			return this.previewFallbackStaticDecision;
		}

		const enabledZoomEffects =
			this.params.effects?.filter(
				(effect) => effect.enabled && effect.type === "zoom",
			) ?? [];
		if (enabledZoomEffects.length === 0) {
			this.previewFallbackStaticDecision = false;
			return false;
		}

		const animationLocalTime = this.getAnimationLocalTime({ time });
		const frameKey = this.getPreviewFallbackFrameKey({
			animationLocalTime,
			fps: renderer.fps,
		});
		const cachedDecision = this.previewFallbackFrameDecisions.get(frameKey);
		if (cachedDecision !== undefined) {
			return cachedDecision;
		}

		const progress =
			this.params.duration <= 0
				? 1
				: Math.min(animationLocalTime / this.params.duration, 1);
		let shouldFallback = false;

		for (const effect of enabledZoomEffects) {
			const resolvedParams = resolveEffectParamsAtTime({
				effect,
				animations: this.params.animations,
				localTime: animationLocalTime,
			});
			const renderState = resolveZoomRenderState({
				effectParams: resolvedParams,
				progress,
				duration: this.params.duration,
			});

			if (renderState.keepFrameFixed) {
				shouldFallback = true;
				break;
			}

			if (
				Math.abs(renderState.tiltX) > 0.0001 ||
				Math.abs(renderState.tiltY) > 0.0001 ||
				Math.abs(renderState.rotationX) > 0.0001 ||
				renderState.perspective > 0.0001
			) {
				shouldFallback = true;
				break;
			}
		}

		if (Object.keys(this.params.animations?.channels ?? {}).length === 0) {
			this.previewFallbackStaticDecision = shouldFallback;
			return shouldFallback;
		}

		this.cachePreviewFallbackDecision({
			frameKey,
			decision: shouldFallback,
		});
		return shouldFallback;
	}

	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const videoTime = this.getSourceLocalTime({ time });
		if (
			renderer.mode === "preview" &&
			!this.hasPreviewNativeFallbackEffects({ renderer, time })
		) {
			const nativeSource = await nativeVideoPreview.getFrameSource({
				mediaId: this.params.mediaId,
				url: this.params.url,
				time: videoTime,
				isPlaying: renderer.isPlaying,
				playbackRate:
					typeof this.params.playbackRate === "number" &&
					Number.isFinite(this.params.playbackRate) &&
					this.params.playbackRate > 0
						? this.params.playbackRate
						: 1,
			});
			if (nativeSource && nativeSource.videoWidth > 0 && nativeSource.videoHeight > 0) {
				this.renderVisual({
					renderer,
					source: nativeSource,
					sourceWidth: nativeSource.videoWidth,
					sourceHeight: nativeSource.videoHeight,
					timelineTime: time,
				});
				return;
			}
		}

		const frame = await videoCache.getFrameAt({
			mediaId: this.params.mediaId,
			file: this.params.file,
			time: videoTime,
		});

		if (frame) {
			this.renderVisual({
				renderer,
				source: frame.canvas,
				sourceWidth: frame.canvas.width,
				sourceHeight: frame.canvas.height,
				timelineTime: time,
			});
		}
	}
}
