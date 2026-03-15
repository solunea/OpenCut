export type CursorTrackingStatus = "idle" | "analyzing" | "ready" | "failed";

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
