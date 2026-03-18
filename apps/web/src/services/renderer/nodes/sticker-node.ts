import type { CanvasRenderer } from "../canvas-renderer";
import { resolveStickerId } from "@/lib/stickers";
import { VisualNode, type VisualNodeParams } from "./visual-node";

export interface StickerNodeParams extends VisualNodeParams {
	stickerId: string;
}

interface CachedStickerSource {
	source: HTMLImageElement;
	width: number;
	height: number;
}

const stickerSourceCache = new Map<string, Promise<CachedStickerSource>>();
const TRANSPARENT_STICKER_DATA_URL =
	"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1' viewBox='0 0 1 1'%3E%3C/svg%3E";

function loadImage({
	url,
}: {
	url: string;
}): Promise<HTMLImageElement> {
	const image = new Image();
	image.crossOrigin = "anonymous";

	return new Promise<HTMLImageElement>((resolve, reject) => {
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
		image.src = url;
	});
}

function loadStickerSource(stickerId: string): Promise<CachedStickerSource> {
	const cached = stickerSourceCache.get(stickerId);
	if (cached) return cached;

	const promise = (async (): Promise<CachedStickerSource> => {
		const url = resolveStickerId({
			stickerId,
			options: { width: 200, height: 200 },
		});

		try {
			const image = await loadImage({ url });
			return { source: image, width: 200, height: 200 };
		} catch (error) {
			console.warn(`Failed to load sticker asset for ${stickerId}:`, error);
			const fallbackImage = await loadImage({
				url: TRANSPARENT_STICKER_DATA_URL,
			});
			return { source: fallbackImage, width: 1, height: 1 };
		}
	})();

	stickerSourceCache.set(stickerId, promise);
	return promise;
}

export class StickerNode extends VisualNode<StickerNodeParams> {
	private cachedSource: Promise<CachedStickerSource>;

	constructor(params: StickerNodeParams) {
		super(params);
		this.cachedSource = loadStickerSource(params.stickerId);
	}

	async render({ renderer, time }: { renderer: CanvasRenderer; time: number }) {
		await super.render({ renderer, time });

		if (!this.isInRange({ time })) {
			return;
		}

		const { source, width, height } = await this.cachedSource;

		this.renderVisual({
			renderer,
			source,
			sourceWidth: width,
			sourceHeight: height,
			timelineTime: time,
		});
	}
}
