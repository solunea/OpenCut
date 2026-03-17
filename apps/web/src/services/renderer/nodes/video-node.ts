import type { CanvasRenderer } from "../canvas-renderer";
import { nativeVideoPreview } from "../native-video-preview";
import { VisualNode, type VisualNodeParams } from "./visual-node";
import { videoCache } from "@/services/video-cache/service";

export interface VideoNodeParams extends VisualNodeParams {
	url: string;
	file: File;
	mediaId: string;
}

export class VideoNode extends VisualNode<VideoNodeParams> {
	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const videoTime = this.getSourceLocalTime({ time });
		if (renderer.mode === "preview") {
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
