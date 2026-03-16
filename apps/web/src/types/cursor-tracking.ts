export type CursorTrackingStatus = "idle" | "analyzing" | "ready" | "failed";

export type RecordedCursorEventType =
	| "move"
	| "down"
	| "up"
	| "wheel"
	| "scroll";

export interface CursorSample {
	time: number;
	x: number;
	y: number;
	confidence: number;
}

export interface CursorTrackingData {
	status: CursorTrackingStatus;
	samples: CursorSample[];
	averageConfidence?: number;
	analyzedAt?: string;
	analysisWidth?: number;
	analysisHeight?: number;
	error?: string;
}

export interface RecordedCursorEvent {
	time: number;
	type: RecordedCursorEventType;
	x: number;
	y: number;
	normalizedX: number;
	normalizedY: number;
	cursor: string;
	button?: number;
	buttons?: number;
	deltaX?: number;
	deltaY?: number;
	scrollX?: number;
	scrollY?: number;
	viewportWidth: number;
	viewportHeight: number;
	devicePixelRatio: number;
}

export interface RecordedCursorPage {
	url?: string;
	title?: string;
}

export interface RecordedCursorData {
	version: number;
	source: string;
	startedAt: string;
	duration: number;
	viewportWidth: number;
	viewportHeight: number;
	devicePixelRatio: number;
	page?: RecordedCursorPage;
	events: RecordedCursorEvent[];
	cursorTracking?: CursorTrackingData;
}
