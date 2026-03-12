type DotLottieModule = typeof import("@lottiefiles/dotlottie-web");

type DotLottiePlayer = InstanceType<DotLottieModule["DotLottie"]>;

interface LottieRenderEntry {
	player: DotLottiePlayer;
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
	duration: number;
	totalFrames: number;
}

let dotLottieModulePromise: Promise<DotLottieModule> | null = null;

const lottieRenderEntries = new Map<string, Promise<LottieRenderEntry>>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getLowerName({ file }: { file: File }): string {
	return file.name.trim().toLowerCase();
}

function isJsonLikeFile({ file }: { file: File }): boolean {
	const lowerName = getLowerName({ file });
	return lowerName.endsWith(".json") || file.type.toLowerCase().includes("json");
}

function isLottieArchiveFile({ file }: { file: File }): boolean {
	const lowerName = getLowerName({ file });
	return lowerName.endsWith(".lottie") || file.type.toLowerCase().includes("lottie");
}

function isLottieJsonPayload(value: unknown): boolean {
	if (!isRecord(value)) return false;

	return (
		typeof value.v === "string" &&
		typeof value.fr === "number" &&
		typeof value.ip === "number" &&
		typeof value.op === "number" &&
		typeof value.w === "number" &&
		typeof value.h === "number" &&
		Array.isArray(value.layers)
	);
}

function createCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(width));
	canvas.height = Math.max(1, Math.round(height));
	return canvas;
}

function getThumbnailSize({
	width,
	height,
	maxWidth,
	maxHeight,
}: {
	width: number;
	height: number;
	maxWidth: number;
	maxHeight: number;
}): { width: number; height: number } {
	const safeWidth = Math.max(1, width);
	const safeHeight = Math.max(1, height);
	const scale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight, 1);

	return {
		width: Math.max(1, Math.round(safeWidth * scale)),
		height: Math.max(1, Math.round(safeHeight * scale)),
	};
}

async function getDotLottieModule(): Promise<DotLottieModule> {
	if (!dotLottieModulePromise) {
		dotLottieModulePromise = import("@lottiefiles/dotlottie-web");
	}
	return await dotLottieModulePromise;
}

async function waitForAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForPlayerLoad({
	player,
}: {
	player: DotLottiePlayer;
}): Promise<void> {
	if (player.isLoaded) return;

	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			player.removeEventListener("load", handleLoad);
			player.removeEventListener("loadError", handleError);
		};

		const handleLoad = () => {
			cleanup();
			resolve();
		};

		const handleError = ({ error }: { error?: unknown }) => {
			cleanup();
			reject(error instanceof Error ? error : new Error("Failed to load Lottie"));
		};

		player.addEventListener("load", handleLoad);
		player.addEventListener("loadError", handleError);
	});
}

async function renderFrame({
	player,
	frame,
}: {
	player: DotLottiePlayer;
	frame: number;
}): Promise<void> {
	await new Promise<void>((resolve) => {
		let settled = false;

		const cleanup = () => {
			player.removeEventListener("render", handleRender);
		};

		const finish = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve();
		};

		const handleRender = () => finish();

		player.addEventListener("render", handleRender);
		player.setFrame(frame);
		setTimeout(finish, 32);
	});

	await waitForAnimationFrame();
}

async function createRenderEntry({ src }: { src: string }): Promise<LottieRenderEntry> {
	const { DotLottie } = await getDotLottieModule();
	const canvas = createCanvas({ width: 1, height: 1 });
	const player = new DotLottie({
		canvas,
		src,
		autoplay: false,
		loop: false,
		renderConfig: {
			autoResize: false,
			devicePixelRatio: 1,
		},
	});

	await waitForPlayerLoad({ player });

	const size = player.animationSize();
	const width = Math.max(1, Math.round(size.width || canvas.width || 1));
	const height = Math.max(1, Math.round(size.height || canvas.height || 1));

	canvas.width = width;
	canvas.height = height;
	player.resize();
	await renderFrame({ player, frame: 0 });

	return {
		player,
		canvas,
		width,
		height,
		duration:
			typeof player.duration === "number" && Number.isFinite(player.duration)
				? player.duration
				: 0,
		totalFrames:
			typeof player.totalFrames === "number" && Number.isFinite(player.totalFrames)
				? player.totalFrames
				: 0,
	};
}

function getRoundedFps({
	totalFrames,
	duration,
}: {
	totalFrames: number;
	duration: number;
}): number | undefined {
	if (!Number.isFinite(totalFrames) || !Number.isFinite(duration) || duration <= 0) {
		return undefined;
	}

	const fps = totalFrames / duration;
	return Number.isFinite(fps) && fps > 0 ? Math.round(fps) : undefined;
}

export async function isLottieJsonFile({ file }: { file: File }): Promise<boolean> {
	if (!isJsonLikeFile({ file })) return false;

	try {
		const parsed = JSON.parse(await file.text()) as unknown;
		return isLottieJsonPayload(parsed);
	} catch {
		return false;
	}
}

export async function normalizeLottieFile({ file }: { file: File }): Promise<File> {
	const targetType = isLottieArchiveFile({ file })
		? "application/zip"
		: isJsonLikeFile({ file })
			? "application/json"
			: file.type;

	if (!targetType || file.type === targetType) {
		return file;
	}

	const buffer = await file.arrayBuffer();
	return new File([buffer], file.name, {
		type: targetType,
		lastModified: file.lastModified,
	});
}

export async function getLottieMetadata({
	url,
}: {
	url: string;
}): Promise<{
	width: number;
	height: number;
	duration?: number;
	fps?: number;
	thumbnailUrl: string;
}> {
	const entry = await createRenderEntry({ src: url });

	try {
		const size = getThumbnailSize({
			width: entry.width,
			height: entry.height,
			maxWidth: 1280,
			maxHeight: 720,
		});
		const thumbnailCanvas = createCanvas(size);
		const context = thumbnailCanvas.getContext("2d");

		if (!context) {
			throw new Error("Failed to create Lottie thumbnail");
		}

		context.clearRect(0, 0, size.width, size.height);
		context.drawImage(entry.canvas, 0, 0, size.width, size.height);

		return {
			width: entry.width,
			height: entry.height,
			duration: entry.duration > 0 ? entry.duration : undefined,
			fps: getRoundedFps({
				totalFrames: entry.totalFrames,
				duration: entry.duration,
			}),
			thumbnailUrl: thumbnailCanvas.toDataURL("image/png"),
		};
	} finally {
		entry.player.destroy();
	}
}

async function getRenderEntry({
	mediaId,
	url,
}: {
	mediaId: string;
	url: string;
}): Promise<LottieRenderEntry> {
	const cached = lottieRenderEntries.get(mediaId);
	if (cached) {
		return await cached;
	}

	const entryPromise = createRenderEntry({ src: url });
	lottieRenderEntries.set(mediaId, entryPromise);

	try {
		return await entryPromise;
	} catch (error) {
		lottieRenderEntries.delete(mediaId);
		throw error;
	}
}

export async function getLottieFrameCanvas({
	mediaId,
	url,
	time,
	fps,
}: {
	mediaId: string;
	url: string;
	time: number;
	fps?: number;
}): Promise<{
	canvas: HTMLCanvasElement;
	width: number;
	height: number;
} | null> {
	const entry = await getRenderEntry({ mediaId, url });
	const resolvedFps =
		typeof fps === "number" && Number.isFinite(fps) && fps > 0
			? fps
			: getRoundedFps({
					totalFrames: entry.totalFrames,
					duration: entry.duration,
				});

	const totalFrames = Math.max(1, Math.round(entry.totalFrames || 1));
	const frame =
		resolvedFps && resolvedFps > 0
			? Math.min(totalFrames - 1, Math.max(0, Math.floor(time * resolvedFps)))
			: 0;

	await renderFrame({ player: entry.player, frame });

	return {
		canvas: entry.canvas,
		width: entry.width,
		height: entry.height,
	};
}

export function clearLottieAsset({ mediaId }: { mediaId: string }): void {
	const cached = lottieRenderEntries.get(mediaId);
	if (cached) {
		void cached.then((entry) => entry.player.destroy()).catch(() => undefined);
	}

	lottieRenderEntries.delete(mediaId);
}

export function clearAllLottieAssets(): void {
	for (const mediaId of lottieRenderEntries.keys()) {
		clearLottieAsset({ mediaId });
	}
}
