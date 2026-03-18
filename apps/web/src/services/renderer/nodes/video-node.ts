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
	private hasPreviewNativeFallbackEffects({ time }: { time: number }): boolean {
		const enabledEffects = this.params.effects?.filter((effect) => effect.enabled) ?? [];
		if (enabledEffects.length === 0) {
			return false;
		}

		const animationLocalTime = this.getAnimationLocalTime({ time });
		const progress =
			this.params.duration <= 0
				? 1
				: Math.min(animationLocalTime / this.params.duration, 1);

		for (const effect of enabledEffects) {
			if (effect.type !== "zoom") {
				continue;
			}

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
				return true;
			}

			if (
				Math.abs(renderState.tiltX) > 0.0001 ||
				Math.abs(renderState.tiltY) > 0.0001 ||
				Math.abs(renderState.rotationX) > 0.0001 ||
				renderState.perspective > 0.0001
			) {
				return true;
			}
		}

		return false;
	}

	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const videoTime = this.getSourceLocalTime({ time });
		if (
			renderer.mode === "preview" &&
			!this.hasPreviewNativeFallbackEffects({ time })
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

		const frameWindow = await videoCache.getFrameWindowAt({
			mediaId: this.params.mediaId,
			file: this.params.file,
			time: videoTime,
		});
		const frame = frameWindow.currentFrame;

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
