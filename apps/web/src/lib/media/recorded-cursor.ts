import type {
	CursorSample,
	CursorTrackingData,
	RecordedCursorData,
	RecordedCursorEvent,
	RecordedCursorEventType,
} from "@/types/cursor-tracking";

const DEFAULT_SOURCE = "opencut-chrome-extension";
const MIN_TIME_DELTA = 0.05;
const MIN_MOVEMENT_DELTA = 0.0035;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function normalizeEventType(value: unknown): RecordedCursorEventType {
	if (
		value === "move" ||
		value === "down" ||
		value === "up" ||
		value === "wheel" ||
		value === "scroll"
	) {
		return value;
	}
	return "move";
}

function normalizeCursorTracking(raw: unknown): CursorTrackingData | undefined {
	if (!isRecord(raw)) {
		return undefined;
	}

	const rawSamples = Array.isArray(raw.samples) ? raw.samples : [];
	const samples = rawSamples
		.map((sample): CursorSample | null => {
			if (!isRecord(sample)) {
				return null;
			}
			const time = toFiniteNumber(sample.time);
			const x = toFiniteNumber(sample.x);
			const y = toFiniteNumber(sample.y);
			if (time === null || x === null || y === null) {
				return null;
			}
			return {
				time: Math.max(0, time),
				x: clamp(x, 0, 1),
				y: clamp(y, 0, 1),
				confidence: clamp(toFiniteNumber(sample.confidence) ?? 1, 0, 1),
			};
		})
		.filter((sample): sample is CursorSample => sample !== null)
		.sort((left, right) => left.time - right.time);

	const status =
		raw.status === "idle" ||
		raw.status === "analyzing" ||
		raw.status === "ready" ||
		raw.status === "failed"
			? raw.status
			: samples.length > 0
				? "ready"
				: "failed";

	return {
		status,
		samples,
		averageConfidence:
			toFiniteNumber(raw.averageConfidence) ??
			(samples.length > 0 ? 1 : undefined),
		analyzedAt:
			typeof raw.analyzedAt === "string" ? raw.analyzedAt : undefined,
		analysisWidth: toFiniteNumber(raw.analysisWidth) ?? undefined,
		analysisHeight: toFiniteNumber(raw.analysisHeight) ?? undefined,
		error: typeof raw.error === "string" ? raw.error : undefined,
	};
}

function simplifySamples({ samples }: { samples: CursorSample[] }): CursorSample[] {
	if (samples.length <= 2) {
		return samples;
	}

	const simplified: CursorSample[] = [samples[0]];
	let lastKept = samples[0];

	for (let index = 1; index < samples.length - 1; index += 1) {
		const sample = samples[index];
		const timeDelta = sample.time - lastKept.time;
		const movement = Math.hypot(sample.x - lastKept.x, sample.y - lastKept.y);
		if (timeDelta >= MIN_TIME_DELTA || movement >= MIN_MOVEMENT_DELTA) {
			simplified.push(sample);
			lastKept = sample;
		}
	}

	const lastSample = samples[samples.length - 1];
	if (simplified[simplified.length - 1] !== lastSample) {
		simplified.push(lastSample);
	}

	return simplified;
}

export function buildCursorTrackingFromRecordedCursor({
	recording,
}: {
	recording: RecordedCursorData;
}): CursorTrackingData {
	const samples = simplifySamples({
		samples: recording.events
			.filter(
				(event) =>
					Number.isFinite(event.time) &&
					Number.isFinite(event.normalizedX) &&
					Number.isFinite(event.normalizedY),
			)
			.map((event) => ({
				time: Math.max(0, event.time),
				x: clamp(event.normalizedX, 0, 1),
				y: clamp(event.normalizedY, 0, 1),
				confidence: 1,
			}))
			.sort((left, right) => left.time - right.time),
	});

	if (samples.length === 0) {
		return {
			status: "failed",
			samples: [],
			error: "No cursor events were found in the imported tracking file",
		};
	}

	return {
		status: "ready",
		samples,
		averageConfidence: 1,
		analyzedAt: recording.startedAt,
		analysisWidth: recording.viewportWidth,
		analysisHeight: recording.viewportHeight,
	};
}

export function parseRecordedCursorData({
	data,
}: {
	data: unknown;
}): RecordedCursorData {
	const parsed = data;

	if (!isRecord(parsed)) {
		throw new Error("Unsupported cursor tracking data");
	}

	const viewportWidth = Math.max(1, toFiniteNumber(parsed.viewportWidth) ?? 1);
	const viewportHeight = Math.max(1, toFiniteNumber(parsed.viewportHeight) ?? 1);
	const devicePixelRatio = Math.max(
		0.1,
		toFiniteNumber(parsed.devicePixelRatio) ?? 1,
	);
	const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
	const events = rawEvents
		.map((rawEvent) =>
			normalizeEvent({
				rawEvent,
				defaultViewportWidth: viewportWidth,
				defaultViewportHeight: viewportHeight,
				defaultDevicePixelRatio: devicePixelRatio,
			}),
		)
		.filter((event): event is RecordedCursorEvent => event !== null)
		.sort((left, right) => left.time - right.time);

	if (events.length === 0) {
		throw new Error("Cursor tracking data does not contain usable events");
	}

	const recording: RecordedCursorData = {
		version: Math.max(1, Math.round(toFiniteNumber(parsed.version) ?? 1)),
		source:
			typeof parsed.source === "string" && parsed.source.length > 0
				? parsed.source
				: DEFAULT_SOURCE,
		startedAt:
			typeof parsed.startedAt === "string"
				? parsed.startedAt
				: new Date().toISOString(),
		duration: Math.max(
			toFiniteNumber(parsed.duration) ?? events[events.length - 1].time,
			events[events.length - 1].time,
		),
		viewportWidth,
		viewportHeight,
		devicePixelRatio,
		page: isRecord(parsed.page)
			? {
					url:
						typeof parsed.page.url === "string" ? parsed.page.url : undefined,
					title:
						typeof parsed.page.title === "string"
							? parsed.page.title
							: undefined,
				}
			: undefined,
		events,
	};

	const normalizedCursorTracking = normalizeCursorTracking(parsed.cursorTracking);
	recording.cursorTracking =
		normalizedCursorTracking &&
		normalizedCursorTracking.status === "ready" &&
		normalizedCursorTracking.samples.length > 0
			? normalizedCursorTracking
			: buildCursorTrackingFromRecordedCursor({ recording });

	return recording;
}

function normalizeEvent({
	rawEvent,
	defaultViewportWidth,
	defaultViewportHeight,
	defaultDevicePixelRatio,
}: {
	rawEvent: unknown;
	defaultViewportWidth: number;
	defaultViewportHeight: number;
	defaultDevicePixelRatio: number;
}): RecordedCursorEvent | null {
	if (!isRecord(rawEvent)) {
		return null;
	}

	const viewportWidth =
		toFiniteNumber(rawEvent.viewportWidth) ?? defaultViewportWidth;
	const viewportHeight =
		toFiniteNumber(rawEvent.viewportHeight) ?? defaultViewportHeight;
	const x = toFiniteNumber(rawEvent.x);
	const y = toFiniteNumber(rawEvent.y);
	const normalizedX =
		toFiniteNumber(rawEvent.normalizedX) ??
		(x !== null && viewportWidth > 0 ? x / viewportWidth : null);
	const normalizedY =
		toFiniteNumber(rawEvent.normalizedY) ??
		(y !== null && viewportHeight > 0 ? y / viewportHeight : null);
	const time = toFiniteNumber(rawEvent.time);

	if (
		time === null ||
		x === null ||
		y === null ||
		normalizedX === null ||
		normalizedY === null
	) {
		return null;
	}

	return {
		time: Math.max(0, time),
		type: normalizeEventType(rawEvent.type),
		x: Math.max(0, x),
		y: Math.max(0, y),
		normalizedX: clamp(normalizedX, 0, 1),
		normalizedY: clamp(normalizedY, 0, 1),
		cursor: typeof rawEvent.cursor === "string" ? rawEvent.cursor : "default",
		button: toFiniteNumber(rawEvent.button) ?? undefined,
		buttons: toFiniteNumber(rawEvent.buttons) ?? undefined,
		deltaX: toFiniteNumber(rawEvent.deltaX) ?? undefined,
		deltaY: toFiniteNumber(rawEvent.deltaY) ?? undefined,
		scrollX: toFiniteNumber(rawEvent.scrollX) ?? undefined,
		scrollY: toFiniteNumber(rawEvent.scrollY) ?? undefined,
		viewportWidth,
		viewportHeight,
		devicePixelRatio:
			toFiniteNumber(rawEvent.devicePixelRatio) ?? defaultDevicePixelRatio,
	};
}

export async function parseRecordedCursorFile({
	file,
}: {
	file: File;
}): Promise<RecordedCursorData> {
	let data: unknown;
	try {
		data = JSON.parse(await file.text()) as unknown;
	} catch {
		throw new Error("Invalid cursor tracking file");
	}
	try {
		return parseRecordedCursorData({ data });
	} catch (error) {
		throw new Error(
			error instanceof Error
				? error.message.replace("data", "file")
				: "Unsupported cursor tracking file",
		);
	}
}
