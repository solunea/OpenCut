import type { CanvasRenderer } from "../canvas-renderer";
import type { CursorTrackingData } from "@/types/cursor-tracking";
import type { EffectParamValues, ZoomEffectTransition } from "@/types/effects";
import { resolveZoomEffectParamsForRender } from "@/lib/effects/definitions/zoom";
import {
	getClampedVideoSourceTimeFromTimelineTime,
	getSourceTimeFromTimelineTime,
} from "@/lib/timeline/clip-speed";
import { BaseNode } from "./base-node";
import { applyRendererEffect } from "../effect-applier";

const TIME_EPSILON = 1e-6;

type TrackedVideoSource = {
	startTime: number;
	duration: number;
	trimStart: number;
	playbackRate?: number;
	freezeFrameStart?: number;
	freezeFrameEnd?: number;
	cursorTracking?: CursorTrackingData;
};

export type EffectLayerNodeParams = {
	effectType: string;
	effectParams: EffectParamValues;
	timeOffset: number;
	duration: number;
	zoomTransition?: ZoomEffectTransition;
	trackedVideoSources?: TrackedVideoSource[];
};

function isInRange({
	time,
	timeOffset,
	duration,
}: {
	time: number;
	timeOffset: number;
	duration: number;
}): boolean {
	return time >= timeOffset - TIME_EPSILON && time < timeOffset + duration;
}

function resolveTrackedVideoSourceAtTime({
	time,
	trackedVideoSources,
}: {
	time: number;
	trackedVideoSources?: TrackedVideoSource[];
}): TrackedVideoSource | null {
	if (!trackedVideoSources || trackedVideoSources.length === 0) {
		return null;
	}

	for (const trackedVideoSource of trackedVideoSources) {
		if (
			isInRange({
				time,
				timeOffset: trackedVideoSource.startTime,
				duration: trackedVideoSource.duration,
			})
		) {
			return trackedVideoSource;
		}
	}

	return null;
}

function getTrackedVideoSourceTime({
	time,
	trackedVideoSource,
}: {
	time: number;
	trackedVideoSource: TrackedVideoSource;
}): number {
	if (
		typeof trackedVideoSource.freezeFrameStart === "number" ||
		typeof trackedVideoSource.freezeFrameEnd === "number"
	) {
		return getClampedVideoSourceTimeFromTimelineTime({
			timelineTime: time,
			startTime: trackedVideoSource.startTime,
			trimStart: trackedVideoSource.trimStart,
			duration: trackedVideoSource.duration,
			playbackRate: trackedVideoSource.playbackRate,
			freezeFrameStart: trackedVideoSource.freezeFrameStart,
			freezeFrameEnd: trackedVideoSource.freezeFrameEnd,
		});
	}

	return getSourceTimeFromTimelineTime({
		timelineTime: time,
		startTime: trackedVideoSource.startTime,
		trimStart: trackedVideoSource.trimStart,
		playbackRate: trackedVideoSource.playbackRate,
	});
}

// snapshots whatever is currently on the canvas, applies the effect, draws it back
export class EffectLayerNode extends BaseNode<EffectLayerNodeParams> {
	async render({
		renderer,
		time,
	}: {
		renderer: CanvasRenderer;
		time: number;
	}): Promise<void> {
		if (
			!isInRange({
				time,
				timeOffset: this.params.timeOffset,
				duration: this.params.duration,
			})
		) {
			return;
		}

		const localTime = Math.max(0, time - this.params.timeOffset);
		const progress =
			this.params.duration <= 0
				? 1
				: Math.min(localTime / this.params.duration, 1);
		const source = renderer.context.canvas as CanvasImageSource;
		const rasterWidth = renderer.getRasterWidth();
		const rasterHeight = renderer.getRasterHeight();
		const trackedVideoSource = resolveTrackedVideoSourceAtTime({
			time,
			trackedVideoSources: this.params.trackedVideoSources,
		});
		const renderParams =
			this.params.effectType === "zoom"
				? resolveZoomEffectParamsForRender({
						effectParams: this.params.effectParams,
						cursorTracking: trackedVideoSource?.cursorTracking,
						sourceTime: trackedVideoSource
							? getTrackedVideoSourceTime({
									time,
									trackedVideoSource,
							  })
							: undefined,
					})
				: this.params.effectParams;

		const effectResult = applyRendererEffect({
			source,
			width: rasterWidth,
			height: rasterHeight,
			effectType: this.params.effectType,
			effectParams: renderParams,
			localTime,
			duration: this.params.duration,
			progress,
			zoomTransition: this.params.zoomTransition,
		});

		renderer.context.save();
		renderer.context.clearRect(0, 0, renderer.width, renderer.height);
		renderer.context.drawImage(
			effectResult,
			0,
			0,
			renderer.width,
			renderer.height,
		);
		renderer.context.restore();
	}
}
