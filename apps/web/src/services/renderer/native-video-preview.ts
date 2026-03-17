interface NativePreviewVideoState {
	video: HTMLVideoElement;
	url: string;
	ready: boolean;
	readyPromise: Promise<void>;
	pendingSeekPromise: Promise<void> | null;
	pendingSeekTarget: number | null;
}

function clampTime({
	time,
	duration,
}: {
	time: number;
	duration: number;
}): number {
	if (!Number.isFinite(duration) || duration <= 0) {
		return Math.max(0, time);
	}
	const endOffset = Math.min(1 / 120, duration / 4);
	return Math.max(0, Math.min(time, Math.max(0, duration - endOffset)));
}

export class NativeVideoPreview {
	private videos = new Map<string, NativePreviewVideoState>();

	private createState({ url }: { url: string }): NativePreviewVideoState {
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.preload = "auto";
		video.src = url;

		let markReady: (() => void) | null = null;
		const readyPromise = new Promise<void>((resolve) => {
			markReady = resolve;
		});

		const handleReady = () => {
			state.ready = true;
			markReady?.();
			markReady = null;
			video.removeEventListener("loadeddata", handleReady);
			video.removeEventListener("canplay", handleReady);
		};

		video.addEventListener("loadeddata", handleReady, { once: true });
		video.addEventListener("canplay", handleReady, { once: true });

		const state: NativePreviewVideoState = {
			video,
			url,
			ready: video.readyState >= 2,
			readyPromise,
			pendingSeekPromise: null,
			pendingSeekTarget: null,
		};

		if (state.ready) {
			handleReady();
		}

		return state;
	}

	private async ensureState({
		mediaId,
		url,
	}: {
		mediaId: string;
		url: string;
	}): Promise<NativePreviewVideoState> {
		const existing = this.videos.get(mediaId);
		if (existing && existing.url === url) {
			if (!existing.ready) {
				await existing.readyPromise.catch(() => undefined);
			}
			return existing;
		}

		if (existing) {
			existing.video.pause();
			existing.video.removeAttribute("src");
			existing.video.load();
		}

		const state = this.createState({ url });
		this.videos.set(mediaId, state);
		if (!state.ready) {
			await state.readyPromise.catch(() => undefined);
		}
		return state;
	}

	private async seekToTime({
		state,
		time,
	}: {
		state: NativePreviewVideoState;
		time: number;
	}): Promise<void> {
		if (!state.ready) {
			await state.readyPromise.catch(() => undefined);
		}
		if (!state.ready) {
			return;
		}

		const targetTime = clampTime({
			time,
			duration: Number.isFinite(state.video.duration) ? state.video.duration : 0,
		});
		if (Math.abs(state.video.currentTime - targetTime) <= 1 / 240) {
			return;
		}
		if (
			state.pendingSeekPromise &&
			state.pendingSeekTarget !== null &&
			Math.abs(state.pendingSeekTarget - targetTime) <= 1 / 240
		) {
			await state.pendingSeekPromise;
			return;
		}

		state.video.pause();
		state.pendingSeekTarget = targetTime;
		state.pendingSeekPromise = new Promise<void>((resolve) => {
			const complete = () => {
				state.pendingSeekPromise = null;
				state.pendingSeekTarget = null;
				state.video.removeEventListener("seeked", complete);
				state.video.removeEventListener("error", complete);
				resolve();
			};
			state.video.addEventListener("seeked", complete, { once: true });
			state.video.addEventListener("error", complete, { once: true });
			try {
				state.video.currentTime = targetTime;
			} catch {
				complete();
			}
		});
		await state.pendingSeekPromise;
	}

	async getFrameSource({
		mediaId,
		url,
		time,
		isPlaying,
		playbackRate,
	}: {
		mediaId: string;
		url: string;
		time: number;
		isPlaying: boolean;
		playbackRate: number;
	}): Promise<HTMLVideoElement | null> {
		if (typeof document === "undefined") {
			return null;
		}

		const state = await this.ensureState({ mediaId, url });
		if (!state.ready) {
			return null;
		}

		const video = state.video;
		const safePlaybackRate =
			Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
		if (Math.abs(video.playbackRate - safePlaybackRate) > 0.001) {
			video.playbackRate = safePlaybackRate;
		}

		const targetTime = clampTime({
			time,
			duration: Number.isFinite(video.duration) ? video.duration : 0,
		});

		if (!isPlaying) {
			if (!video.paused) {
				video.pause();
			}
			if (Math.abs(video.currentTime - targetTime) > 1 / 120) {
				await this.seekToTime({ state, time: targetTime });
			}
			return video.readyState >= 2 ? video : null;
		}

		if (Math.abs(video.currentTime - targetTime) > 0.12) {
			await this.seekToTime({ state, time: targetTime });
		}
		if (video.paused) {
			void video.play().catch(() => undefined);
		}
		return video.readyState >= 2 ? video : null;
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		const state = this.videos.get(mediaId);
		if (!state) {
			return;
		}
		state.video.pause();
		state.video.removeAttribute("src");
		state.video.load();
		this.videos.delete(mediaId);
	}

	clearAll(): void {
		for (const mediaId of this.videos.keys()) {
			this.clearVideo({ mediaId });
		}
	}
}

export const nativeVideoPreview = new NativeVideoPreview();
