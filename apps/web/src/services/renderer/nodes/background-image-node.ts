import type { CanvasRenderer } from "../canvas-renderer";
import { BaseNode } from "./base-node";

export interface BackgroundImageNodeParams {
	url: string;
}

interface CachedBackgroundImage {
	source: HTMLImageElement;
	width: number;
	height: number;
}

const backgroundImageCache = new Map<string, Promise<CachedBackgroundImage>>();

function loadBackgroundImage(url: string): Promise<CachedBackgroundImage> {
	const cached = backgroundImageCache.get(url);
	if (cached) {
		return cached;
	}

	const promise = new Promise<CachedBackgroundImage>((resolve, reject) => {
		const image = new Image();
		image.onload = () =>
			resolve({
				source: image,
				width: image.naturalWidth,
				height: image.naturalHeight,
			});
		image.onerror = () => reject(new Error("Background image load failed"));
		image.src = url;
	});

	backgroundImageCache.set(url, promise);
	return promise;
}

export class BackgroundImageNode extends BaseNode<BackgroundImageNodeParams> {
	private cachedSource: Promise<CachedBackgroundImage>;

	constructor(params: BackgroundImageNodeParams) {
		super(params);
		this.cachedSource = loadBackgroundImage(params.url);
	}

	async render({ renderer }: { renderer: CanvasRenderer }) {
		const { source, width, height } = await this.cachedSource;
		const scale = Math.max(renderer.width / width, renderer.height / height);
		const drawWidth = width * scale;
		const drawHeight = height * scale;
		const x = (renderer.width - drawWidth) / 2;
		const y = (renderer.height - drawHeight) / 2;

		renderer.context.drawImage(source, x, y, drawWidth, drawHeight);
	}
}
