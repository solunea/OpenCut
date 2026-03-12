import { getLottieFrameCanvas } from "@/lib/media/lottie";
import type { CanvasRenderer } from "../canvas-renderer";
import { VisualNode, type VisualNodeParams } from "./visual-node";

export interface LottieNodeParams extends VisualNodeParams {
	mediaId: string;
	url: string;
	fps?: number;
}

export class LottieNode extends VisualNode<LottieNodeParams> {
	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const lottieTime = this.getSourceLocalTime({ time });
		const frame = await getLottieFrameCanvas({
			mediaId: this.params.mediaId,
			url: this.params.url,
			time: lottieTime,
			fps: this.params.fps,
		});

		if (!frame) {
			return;
		}

		this.renderVisual({
			renderer,
			source: frame.canvas,
			sourceWidth: frame.width,
			sourceHeight: frame.height,
			timelineTime: time,
		});
	}
}
