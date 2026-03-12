import { getLottieFrameCanvas } from "@/lib/media/lottie";
import type { CanvasRenderer } from "../canvas-renderer";
import { VisualNode, type VisualNodeParams } from "./visual-node";

export interface LottieNodeParams extends VisualNodeParams {
	mediaId: string;
	url: string;
	fps?: number;
	sourceDuration?: number;
}

export class LottieNode extends VisualNode<LottieNodeParams> {
	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const lottieTime = this.getSourceLocalTime({ time });
		const trimStart = this.params.trimStart ?? 0;
		const trimEnd = this.params.trimEnd ?? 0;
		const sourceDuration = this.params.sourceDuration;
		const visibleSourceDuration =
			typeof sourceDuration === "number" && Number.isFinite(sourceDuration)
				? Math.max(0, sourceDuration - trimStart - trimEnd)
				: undefined;
		const resolvedLottieTime =
			typeof visibleSourceDuration === "number" && visibleSourceDuration > 0
				? trimStart + (((lottieTime - trimStart) % visibleSourceDuration) + visibleSourceDuration) % visibleSourceDuration
				: lottieTime;
		const frame = await getLottieFrameCanvas({
			mediaId: this.params.mediaId,
			url: this.params.url,
			time: resolvedLottieTime,
			fps: this.params.fps,
			duration: sourceDuration,
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
