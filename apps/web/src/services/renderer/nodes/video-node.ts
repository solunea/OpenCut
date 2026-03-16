import type { CanvasRenderer } from "../canvas-renderer";
import type { TemporalCleanupFrame } from "../custom-cursor-effect";
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
		const frameWindow = await videoCache.getFrameWindowAt({
			mediaId: this.params.mediaId,
			file: this.params.file,
			time: videoTime,
		});
		const frame = frameWindow.currentFrame;

		if (frame) {
			const temporalCleanupFrames: TemporalCleanupFrame[] = [];
			if (frameWindow.previousFrame) {
				temporalCleanupFrames.push({
					source: frameWindow.previousFrame.canvas,
					sourceTime:
						frameWindow.previousFrame.timestamp +
						frameWindow.previousFrame.duration / 2,
				});
			}
			if (frameWindow.nextFrame) {
				temporalCleanupFrames.push({
					source: frameWindow.nextFrame.canvas,
					sourceTime:
						frameWindow.nextFrame.timestamp +
						frameWindow.nextFrame.duration / 2,
				});
			}

			this.renderVisual({
				renderer,
				source: frame.canvas,
				sourceWidth: frame.canvas.width,
				sourceHeight: frame.canvas.height,
				timelineTime: time,
				temporalCleanupFrames,
			});
		}
	}
}
