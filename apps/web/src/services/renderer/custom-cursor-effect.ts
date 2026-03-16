import type { EffectParamValues } from "@/types/effects";
import type { RecordedCursorData, RecordedCursorEvent } from "@/types/cursor-tracking";
import { createOffscreenCanvas } from "./canvas-utils";
import { mapPointThroughZoomEffect } from "./effect-applier";

export interface AppliedZoomEffect {
	effectParams: EffectParamValues;
	progress: number;
	duration?: number;
}

export interface TemporalCleanupFrame {
	source: CanvasImageSource;
	sourceTime: number;
}

type RenderableContext =
	| CanvasRenderingContext2D
	| OffscreenCanvasRenderingContext2D;

type CursorVisualKind =
	| "default"
	| "pointer"
	| "text"
	| "grab"
	| "grabbing"
	| "crosshair"
	| "not-allowed";

const CURSOR_SNAP_DISTANCE_THRESHOLD = 0.003;
const CURSOR_SNAP_VELOCITY_THRESHOLD = 0.35;
const CURSOR_HOLD_EDGE_PORTION = 0.22;
const CURSOR_SMOOTHING_MIN = 0.18;
const CURSOR_SMOOTHING_MAX = 0.88;
const CURSOR_SMOOTHNESS_DEFAULT = 55;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function lerp(leftValue: number, rightValue: number, progress: number): number {
	return leftValue + (rightValue - leftValue) * progress;
}

function inverseLerp(value: number, min: number, max: number): number {
	if (Math.abs(max - min) <= 0.000001) {
		return 0;
	}
	return (value - min) / (max - min);
}

function resolveSmoothnessFactor({
	effectParams,
}: {
	effectParams: EffectParamValues;
}): number {
	return clamp(
		resolveNumber({
			value: effectParams.trackingSmoothness,
			fallback: CURSOR_SMOOTHNESS_DEFAULT,
		}) / 100,
		0,
		1,
	);
}

function resolveNumber({
	value,
	fallback,
}: {
	value: number | string | boolean | undefined;
	fallback: number;
}): number {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : fallback;
	}
	const parsed = Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveBoolean({
	value,
	fallback,
}: {
	value: number | string | boolean | undefined;
	fallback: boolean;
}): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value !== 0;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") {
			return true;
		}
		if (normalized === "false") {
			return false;
		}
	}
	return fallback;
}

function normalizeCursorKind(cursor: string): CursorVisualKind {
	const normalized = cursor.trim().toLowerCase();
	if (normalized.includes("url(")) {
		const fallback = normalized.split(",").at(-1)?.trim();
		if (fallback && fallback.length > 0 && fallback !== normalized) {
			return normalizeCursorKind(fallback);
		}
	}
	if (normalized.includes("grabbing")) {
		return "grabbing";
	}
	if (normalized.includes("grab")) {
		return "grab";
	}
	if (normalized.includes("pointer")) {
		return "pointer";
	}
	if (normalized.includes("text")) {
		return "text";
	}
	if (normalized.includes("crosshair")) {
		return "crosshair";
	}
	if (normalized.includes("not-allowed") || normalized.includes("no-drop")) {
		return "not-allowed";
	}
	return "default";
}

function findEventIndexAtOrBefore({
	events,
	time,
}: {
	events: RecordedCursorEvent[];
	time: number;
}): number {
	let low = 0;
	let high = events.length - 1;
	let result = -1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (events[middle].time <= time) {
			result = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return result;
}

function resolveInterpolatedPosition({
	events,
	time,
	index,
	smoothness,
}: {
	events: RecordedCursorEvent[];
	time: number;
	index: number;
	smoothness: number;
}): { x: number; y: number } {
	if (events.length === 0) {
		return { x: 0.5, y: 0.5 };
	}
	if (index < 0) {
		return {
			x: events[0].normalizedX,
			y: events[0].normalizedY,
		};
	}
	const leftEvent = events[index];
	const rightEvent = events[Math.min(events.length - 1, index + 1)];
	if (leftEvent === rightEvent || rightEvent.time - leftEvent.time <= 0.0001) {
		return {
			x: leftEvent.normalizedX,
			y: leftEvent.normalizedY,
		};
	}

	const duration = rightEvent.time - leftEvent.time;
	const deltaX = rightEvent.normalizedX - leftEvent.normalizedX;
	const deltaY = rightEvent.normalizedY - leftEvent.normalizedY;
	const distance = Math.hypot(deltaX, deltaY);
	const velocity = distance / duration;
	const progress = clamp((time - leftEvent.time) / duration, 0, 1);
	const snapDistanceThreshold = lerp(0.0012, 0.0045, 1 - smoothness);
	const snapVelocityThreshold = lerp(0.12, 0.65, 1 - smoothness);
	const holdEdgePortion = lerp(0.08, 0.3, 1 - smoothness);

	if (
		distance <= snapDistanceThreshold ||
		velocity <= snapVelocityThreshold
	) {
		const snapProgress = progress < 0.5 ? 0 : 1;
		return {
			x: lerp(leftEvent.normalizedX, rightEvent.normalizedX, snapProgress),
			y: lerp(leftEvent.normalizedY, rightEvent.normalizedY, snapProgress),
		};
	}

	const heldProgress = clamp(
		inverseLerp(progress, holdEdgePortion, 1 - holdEdgePortion),
		0,
		1,
	);
	const smoothingStrength = clamp(
		inverseLerp(velocity, snapVelocityThreshold, 2.4),
		0,
		1,
	);
	const smoothingMin = lerp(0.9, CURSOR_SMOOTHING_MIN, smoothness);
	const smoothingMax = lerp(1, CURSOR_SMOOTHING_MAX, smoothness);
	const smoothedProgress = lerp(
		heldProgress,
		progress,
		lerp(smoothingMin, smoothingMax, smoothingStrength),
	);
	return {
		x: lerp(leftEvent.normalizedX, rightEvent.normalizedX, smoothedProgress),
		y: lerp(leftEvent.normalizedY, rightEvent.normalizedY, smoothedProgress),
	};
}

function resolvePressedState({
	events,
	index,
}: {
	events: RecordedCursorEvent[];
	index: number;
}): boolean {
	for (let eventIndex = Math.max(index, 0); eventIndex >= 0; eventIndex -= 1) {
		const event = events[eventIndex];
		if (typeof event.buttons === "number") {
			return event.buttons > 0;
		}
		if (event.type === "down") {
			return true;
		}
		if (event.type === "up") {
			return false;
		}
	}
	return false;
}

function resolveClickPulse({
	events,
	time,
	index,
}: {
	events: RecordedCursorEvent[];
	time: number;
	index: number;
}): number {
	for (let eventIndex = Math.max(index, 0); eventIndex >= 0; eventIndex -= 1) {
		const event = events[eventIndex];
		if (event.type !== "down" && event.type !== "up") {
			continue;
		}
		return clamp(1 - (time - event.time) / (event.type === "down" ? 0.18 : 0.28), 0, 1);
	}
	return 0;
}

function drawClickPulse({
	context,
	accentColor,
	pulse,
	size,
}: {
	context: RenderableContext;
	accentColor: string;
	pulse: number;
	size: number;
}): void {
	if (pulse <= 0.001) {
		return;
	}
	context.save();
	context.globalAlpha = 0.1 + pulse * 0.3;
	context.strokeStyle = accentColor;
	context.lineWidth = Math.max(1.5, size * 0.08);
	context.beginPath();
	context.arc(0, 0, size * (0.35 + (1 - pulse) * 0.45), 0, Math.PI * 2);
	context.stroke();
	context.restore();
}

function drawSvgCursorPath({
	context,
	size,
	outerPathData,
	innerPathData,
	viewBoxWidth,
	viewBoxHeight,
	hotspotX,
	hotspotY,
	fillColor,
	outlineColor,
}: {
	context: RenderableContext;
	size: number;
	outerPathData: string;
	innerPathData?: string;
	viewBoxWidth: number;
	viewBoxHeight: number;
	hotspotX: number;
	hotspotY: number;
	fillColor: string;
	outlineColor: string;
}): boolean {
	if (typeof Path2D === "undefined") {
		return false;
	}

	const outerPath = new Path2D(outerPathData);
	const innerPath = innerPathData ? new Path2D(innerPathData) : null;
	const scale = size / viewBoxHeight;
	const scaledWidth = viewBoxWidth * scale;
	if (!Number.isFinite(scaledWidth) || scaledWidth <= 0) {
		return false;
	}

	context.save();
	context.lineJoin = "round";
	context.lineCap = "round";
	context.scale(scale, scale);
	context.translate(-hotspotX, -hotspotY);
	context.fillStyle = outlineColor;
	context.fill(outerPath);
	if (innerPath) {
		context.fillStyle = fillColor;
		context.fill(innerPath);
	}
	context.restore();
	return true;
}

function drawArrowCursor({
	context,
	size,
	fillColor,
	outlineColor,
	accentColor,
}: {
	context: RenderableContext;
	size: number;
	fillColor: string;
	outlineColor: string;
	accentColor: string;
}): void {
	if (
		drawSvgCursorPath({
			context,
			size,
			outerPathData: DEFAULT_CURSOR_OUTER_PATH,
			innerPathData: DEFAULT_CURSOR_INNER_PATH,
			viewBoxWidth: 320,
			viewBoxHeight: 512,
			hotspotX: 21.14,
			hotspotY: 21.23,
			fillColor,
			outlineColor,
		})
	) {
		return;
	}

	context.beginPath();
	context.moveTo(0, 0);
	context.lineTo(size * 0.62, size * 0.52);
	context.lineTo(size * 0.38, size * 0.57);
	context.lineTo(size * 0.54, size * 0.98);
	context.lineTo(size * 0.36, size * 1.04);
	context.lineTo(size * 0.2, size * 0.64);
	context.lineTo(0.02 * size, size * 0.82);
	context.closePath();
	context.fillStyle = fillColor;
	context.fill();
	context.lineWidth = Math.max(1.5, size * 0.09);
	context.strokeStyle = outlineColor;
	context.stroke();
	context.strokeStyle = accentColor;
	context.lineWidth = Math.max(1, size * 0.06);
	context.beginPath();
	context.moveTo(size * 0.22, size * 0.56);
	context.lineTo(size * 0.43, size * 0.94);
	context.stroke();
}

const DEFAULT_CURSOR_OUTER_PATH =
	"M180.78,512c-2.02,0-4.03-.38-5.95-1.15-3.97-1.58-7.12-4.69-8.79-8.64l-59.86-141.84-71.14,62.89c-2.99,3.07-8.34,5.27-13.89,5.27-11.65,0-21.14-9.52-21.14-21.23V21.23C0,9.52,9.49,0,21.14,0c4.93,0,9.71,1.73,13.76,5.01l279.06,282.97c4.36,5.35,6.04,10.07,6.04,14.97,0,11.69-9.49,21.23-21.14,21.23h-94.79l57.69,136.81c3.41,8.09-.32,17.39-8.36,20.89l-66.24,28.8c-2.03.88-4.2,1.32-6.38,1.32ZM14.29,398.93c-.45.34-.85.7-1.24,1.09l1.24-1.09ZM290,309.12h.21-.21Z";

const DEFAULT_CURSOR_INNER_PATH =
	"M112.28,317.63c1.2,0,2.37.13,3.56.41,5.01,1.15,9.2,4.63,11.18,9.39l62.23,147.45,36.89-16.04-60.91-144.45c-2.09-4.93-1.56-10.61,1.41-15.06,2.97-4.46,7.98-7.15,13.34-7.15h93.33L32,47.51v335.77l69.68-61.63c2.94-2.61,6.74-4.01,10.6-4.01Z";

const POINTER_CURSOR_OUTER_PATH =
	"M222.28,91.66c-4.2,0-8.19.88-11.82,2.45-4.41-11.15-15.24-19.06-27.87-19.06-4.69,0-9.14,1.09-13.09,3.03-5.01-9.66-15.05-16.27-26.6-16.27-3.4,0-6.65.58-9.7,1.63V30.2c0-16.65-13.45-30.2-29.99-30.2s-29.99,13.55-29.99,30.2v119.64l-21.6-24.71c-.15-.17-.31-.33-.46-.49-5.67-5.68-13.22-8.82-21.26-8.86h-.15c-8.02,0-15.52,3.1-21.15,8.72-9.92,9.92-10.47,24.65-1.5,40.41,11.6,20.39,24.22,39.62,35.35,56.58,8.13,12.4,15.82,24.11,21.43,33.79,4.87,8.4,17.8,35.65,17.93,35.93,1.68,3.54,5.25,5.8,9.16,5.8h128.27c4.41,0,8.31-2.84,9.66-7.04,2.39-7.44,23.38-73.4,23.38-98.87v-69.23c0-16.66-13.46-30.2-29.99-30.2Z";

const POINTER_CURSOR_INNER_PATH =
	"M212.58,121.86c0-5.47,4.35-9.92,9.7-9.92s9.7,4.45,9.7,9.92v69.23c0,16.93-13.01,62.44-20.19,85.62h-114.43c-4.21-8.75-12.09-24.96-15.94-31.61-5.9-10.17-13.73-22.1-22.02-34.74-10.97-16.71-23.39-35.65-34.68-55.48-2.95-5.18-5.65-12.17-1.78-16.03,1.8-1.81,4.23-2.75,6.85-2.78,2.56.01,4.96.98,6.81,2.72l39.12,44.76c2.78,3.18,7.25,4.31,11.2,2.82,3.96-1.49,6.58-5.27,6.58-9.5V30.2c0-5.47,4.35-9.91,9.7-9.91s9.71,4.45,9.71,9.91v94.71c0,5.6,4.54,10.14,10.14,10.14s10.14-4.54,10.14-10.14v-32.9c0-5.46,4.35-9.91,9.7-9.91s9.7,4.44,9.7,9.91v46.13c0,5.6,4.54,10.15,10.14,10.15s10.15-4.54,10.15-10.15v-32.89c0-5.47,4.35-9.91,9.7-9.91s9.71,4.45,9.71,9.91v46.13c0,5.6,4.54,10.15,10.14,10.15s10.15-4.54,10.15-10.15v-29.52h0Z";

const GRAB_CURSOR_OUTER_PATH =
	"M239.99,0c-26.03,0-48.03,21.69-48.03,48v18.81c-5.48-2.2-10.46-2.81-16-2.81-26.32,0-48.03,21.69-48.03,48v147.5c-15.38-15.48-30.78-30.98-46.13-46.47-18.61-18.6-49.27-18.6-67.88,0-18.61,18.6-18.53,49.19,0,67.81,41.35,41.71,82.87,83.31,124.13,125.06,26.03,26.03,62.19,42.09,101.94,42.09h32c79.51,0,144-64.5,144-144v-160c0-26.31-21.68-48-48-48-6.21,0-11.24.87-16,2.78v-18.78c0-26.31-21.68-48-48-48-7.5,0-13.81,1.84-17.69,3.44C281.72,18.3,265.49,0,239.99,0h0Z";

const GRAB_CURSOR_INNER_PATH =
	"M239.99,32c9.11,0,15.97,6.86,15.97,16v176c0,8.84,7.16,16,16,16,8.84,0,16-7.16,16-16V80c0-9.14,6.86-16,16-16s16,6.86,16,16v144c0,8.84,7.16,16,16,16,8.84,0,16-7.16,16-16v-80c0-9.14,6.86-16,16-16s16,6.86,16,16v160c0,62.33-49.67,112-112,112h-32c-31.15,0-59-12.46-79.25-32.69-41.33-41.68-82.76-83.34-124.13-125-6.49-6.54-6.5-16.19,0-22.66,6.47-6.47,16.16-6.47,22.62,0l73.44,73.91c10.06,10.12,27.32,3.01,27.34-11.25V112c0-9.14,6.89-16,16.03-16s16,6.86,16,16v112c0,8.84,7.16,16,16,16h0c8.84,0,16-7.16,16-16V48c0-9.14,6.85-16,15.97-16h0Z";

const GRABBING_CURSOR_OUTER_PATH =
	"M492.34,100.4c-12.36-11.89-29.41-18.44-47.99-18.44-11.34,0-22.2,3.15-31.77,9.04-11.01-21.36-33.12-35.98-58.57-35.98-12.81,0-24.77,3.72-34.91,10.12-11.44-19.78-32.73-33.12-57.09-33.12-23.1,0-43.44,12-55.24,30.11-10.49-7.01-23.1-11.11-36.66-11.11-36.39,0-65.99,29.51-65.99,65.78v13.55c-20.16,3.1-35.3,13.46-45.09,30.92L10.17,252.45c-14.33,25.26-13.53,51.14,2.47,79.12.45.78,60.01,91.25,99.21,125.04,17.49,15.07,39.84,23.38,62.95,23.38h200.63c75.31,0,136.57-60.78,136.57-135.49v-196.11c0-18.75-6.98-35.8-19.65-47.99Z";

const GRABBING_CURSOR_INNER_PATH =
	"M472,344.49c0,52.65-43.33,95.49-96.58,95.49h-200.63c-13.52,0-26.6-4.86-36.83-13.67-29.78-25.67-78.74-96.54-90.89-115.1-10.06-17.84-8.09-28.58-2.04-39.17l48.97-91.36c2.29-4.04,5.18-7.26,10.12-9.23v107.54h40V116.8c0-14.22,11.66-25.79,26-25.79s24.81,10.44,25.9,23.66v61.33h40v-33.27h.09v-25.94c0-1.17-.03-2.34-.09-3.5v-14.93c0-14.53,11.66-26.35,26-26.35s26,11.82,26,26.35v77.64h40v-54.35c0-14.69,11.66-26.65,26-26.65s26,11.95,26,26.65v54.35h40v-25.93c0-13.3,10-28.12,24.35-28.12,16.8,0,27.65,10.37,27.65,26.43v196.11h0Z";

function drawPointerCursor({
	context,
	size,
	fillColor,
	outlineColor,
}: {
	context: RenderableContext;
	size: number;
	fillColor: string;
	outlineColor: string;
}): void {
	if (typeof Path2D !== "undefined") {
		if (
			drawSvgCursorPath({
				context,
				size,
				outerPathData: POINTER_CURSOR_OUTER_PATH,
				innerPathData: POINTER_CURSOR_INNER_PATH,
				viewBoxWidth: 252,
				viewBoxHeight: 297,
				hotspotX: 103.2,
				hotspotY: 0,
				fillColor,
				outlineColor,
			})
		) {
			return;
		}
	}

	context.save();
	context.lineJoin = "round";
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(size * 0.16, size * 0.04);
	context.quadraticCurveTo(size * 0.27, size * 0.04, size * 0.27, size * 0.12);
	context.lineTo(size * 0.27, size * 0.42);
	context.lineTo(size * 0.35, size * 0.36);
	context.quadraticCurveTo(size * 0.42, size * 0.31, size * 0.49, size * 0.35);
	context.lineTo(size * 0.58, size * 0.41);
	context.quadraticCurveTo(size * 0.68, size * 0.47, size * 0.68, size * 0.58);
	context.lineTo(size * 0.68, size * 0.75);
	context.quadraticCurveTo(size * 0.68, size * 0.92, size * 0.5, size * 0.92);
	context.lineTo(size * 0.24, size * 0.92);
	context.quadraticCurveTo(size * 0.08, size * 0.92, size * 0.08, size * 0.76);
	context.lineTo(size * 0.08, size * 0.5);
	context.quadraticCurveTo(size * 0.08, size * 0.4, size * 0.16, size * 0.38);
	context.lineTo(size * 0.17, size * 0.38);
	context.lineTo(size * 0.17, size * 0.12);
	context.quadraticCurveTo(size * 0.17, size * 0.04, size * 0.16, size * 0.04);
	context.closePath();
	context.fillStyle = fillColor;
	context.fill();
	context.lineWidth = Math.max(1.5, size * 0.08);
	context.strokeStyle = outlineColor;
	context.stroke();
	context.strokeStyle = `rgba(15, 23, 42, 0.32)`;
	context.lineWidth = Math.max(1, size * 0.03);
	context.beginPath();
	context.moveTo(size * 0.23, size * 0.14);
	context.lineTo(size * 0.23, size * 0.78);
	context.moveTo(size * 0.31, size * 0.5);
	context.lineTo(size * 0.46, size * 0.39);
	context.stroke();

	context.fillStyle = `rgba(255, 255, 255, 0.2)`;
	context.beginPath();
	context.moveTo(size * 0.14, size * 0.12);
	context.quadraticCurveTo(size * 0.22, size * 0.08, size * 0.24, size * 0.16);
	context.lineTo(size * 0.24, size * 0.34);
	context.lineTo(size * 0.17, size * 0.34);
	context.closePath();
	context.fill();
	context.restore();
}

function drawTextCursor({
	context,
	size,
	fillColor,
	outlineColor,
}: {
	context: RenderableContext;
	size: number;
	fillColor: string;
	outlineColor: string;
}): void {
	context.fillStyle = outlineColor;
	context.fillRect(-size * 0.08, -size * 0.05, size * 0.16, size * 1.1);
	context.fillRect(-size * 0.22, -size * 0.05, size * 0.44, size * 0.1);
	context.fillRect(-size * 0.22, size, size * 0.44, size * 0.1);
	context.fillStyle = fillColor;
	context.fillRect(-size * 0.04, 0, size * 0.08, size);
	context.fillRect(-size * 0.16, 0, size * 0.32, size * 0.04);
	context.fillRect(-size * 0.16, size * 0.96, size * 0.32, size * 0.04);
}

function drawGrabCursor({
	context,
	size,
	fillColor,
	outlineColor,
}: {
	context: RenderableContext;
	size: number;
	fillColor: string;
	outlineColor: string;
}): void {
	if (
		drawSvgCursorPath({
			context,
			size,
			outerPathData: GRAB_CURSOR_OUTER_PATH,
			innerPathData: GRAB_CURSOR_INNER_PATH,
			viewBoxWidth: 416,
			viewBoxHeight: 448,
			hotspotX: 208,
			hotspotY: 224,
			fillColor,
			outlineColor,
		})
	) {
		return;
	}

	context.beginPath();
	context.roundRect(-size * 0.12, -size * 0.06, size * 0.7, size * 0.74, size * 0.2);
	context.fillStyle = fillColor;
	context.fill();
	context.lineWidth = Math.max(1.5, size * 0.08);
	context.strokeStyle = outlineColor;
	context.stroke();
}

function drawGrabbingCursor({
	context,
	size,
	fillColor,
	outlineColor,
}: {
	context: RenderableContext;
	size: number;
	fillColor: string;
	outlineColor: string;
}): void {
	if (
		drawSvgCursorPath({
			context,
			size,
			outerPathData: GRABBING_CURSOR_OUTER_PATH,
			innerPathData: GRABBING_CURSOR_INNER_PATH,
			viewBoxWidth: 512,
			viewBoxHeight: 512,
			hotspotX: 256,
			hotspotY: 256,
			fillColor,
			outlineColor,
		})
	) {
		return;
	}

	drawGrabCursor({ context, size, fillColor, outlineColor });
}

function drawCrosshairCursor({
	context,
	size,
	accentColor,
	outlineColor,
}: {
	context: RenderableContext;
	size: number;
	accentColor: string;
	outlineColor: string;
}): void {
	context.strokeStyle = outlineColor;
	context.lineWidth = Math.max(2, size * 0.1);
	context.beginPath();
	context.arc(0, 0, size * 0.28, 0, Math.PI * 2);
	context.stroke();
	context.strokeStyle = accentColor;
	context.lineWidth = Math.max(1.5, size * 0.06);
	context.beginPath();
	context.moveTo(-size * 0.5, 0);
	context.lineTo(size * 0.5, 0);
	context.moveTo(0, -size * 0.5);
	context.lineTo(0, size * 0.5);
	context.stroke();
}

function drawNotAllowedCursor({
	context,
	size,
	fillColor,
	outlineColor,
	accentColor,
}: {
	context: RenderableContext;
	size: number;
	fillColor: string;
	outlineColor: string;
	accentColor: string;
}): void {
	context.fillStyle = fillColor;
	context.strokeStyle = outlineColor;
	context.lineWidth = Math.max(2, size * 0.08);
	context.beginPath();
	context.arc(0, 0, size * 0.34, 0, Math.PI * 2);
	context.fill();
	context.stroke();
	context.strokeStyle = accentColor;
	context.beginPath();
	context.moveTo(-size * 0.2, size * 0.2);
	context.lineTo(size * 0.2, -size * 0.2);
	context.stroke();
}

function drawCursorGlyph({
	context,
	kind,
	size,
	fillColor,
	outlineColor,
	accentColor,
}: {
	context: RenderableContext;
	kind: CursorVisualKind;
	size: number;
	fillColor: string;
	outlineColor: string;
	accentColor: string;
}): void {
	if (kind === "pointer") {
		drawPointerCursor({ context, size, fillColor, outlineColor });
		return;
	}
	if (kind === "text") {
		drawTextCursor({ context, size, fillColor, outlineColor });
		return;
	}
	if (kind === "grab") {
		drawGrabCursor({ context, size, fillColor, outlineColor });
		return;
	}
	if (kind === "grabbing") {
		drawGrabbingCursor({ context, size, fillColor, outlineColor });
		return;
	}
	if (kind === "crosshair") {
		drawCrosshairCursor({ context, size, accentColor, outlineColor });
		return;
	}
	if (kind === "not-allowed") {
		drawNotAllowedCursor({ context, size, fillColor, outlineColor, accentColor });
		return;
	}
	drawArrowCursor({ context, size, fillColor, outlineColor, accentColor });
}

function getCursorDrawOffset({
	kind,
	size,
}: {
	kind: CursorVisualKind;
	size: number;
}): { x: number; y: number } {
	if (kind === "crosshair" || kind === "not-allowed") {
		return { x: 0, y: 0 };
	}
	if (kind === "text") {
		return { x: 0, y: -size * 0.04 };
	}
	return { x: 0, y: 0 };
}

function getCursorCleanupOffset({
	kind,
	size,
}: {
	kind: CursorVisualKind;
	size: number;
}): { x: number; y: number } {
	if (kind === "text" || kind === "crosshair" || kind === "not-allowed") {
		return { x: 0, y: 0 };
	}
	if (kind === "grab" || kind === "grabbing") {
		return { x: size * 0.02, y: size * 0.03 };
	}
	if (kind === "pointer") {
		return { x: size * 0.03, y: size * 0.04 };
	}
	return { x: size * 0.025, y: size * 0.05 };
}

interface CursorPoint {
	x: number;
	y: number;
}

interface CursorCleanupMask {
	minX: number;
	minY: number;
	width: number;
	height: number;
	alpha: Uint8ClampedArray;
}

interface CleanupSample {
	red: number;
	green: number;
	blue: number;
	alpha: number;
	distance: number;
}

interface PreparedTemporalCleanupSample {
	data: Uint8ClampedArray;
	maskAlpha: Uint8ClampedArray;
	timeDistance: number;
}

function drawDebugMarker({
	context,
	position,
	color,
	label,
}: {
	context: RenderableContext;
	position: CursorPoint;
	color: string;
	label: string;
}): void {
	context.save();
	context.strokeStyle = color;
	context.fillStyle = color;
	context.lineWidth = 2;
	context.beginPath();
	context.arc(position.x, position.y, 5, 0, Math.PI * 2);
	context.stroke();
	context.beginPath();
	context.moveTo(position.x - 10, position.y);
	context.lineTo(position.x + 10, position.y);
	context.moveTo(position.x, position.y - 10);
	context.lineTo(position.x, position.y + 10);
	context.stroke();
	context.font = "600 12px Inter, system-ui, sans-serif";
	const textWidth = context.measureText(label).width;
	const labelX = clamp(position.x + 12, 6, Math.max(6, position.x + 12));
	const labelY = Math.max(18, position.y - 12);
	context.fillStyle = "rgba(15, 23, 42, 0.82)";
	context.fillRect(labelX - 4, labelY - 12, textWidth + 8, 16);
	context.fillStyle = color;
	context.fillText(label, labelX, labelY);
	context.restore();
}

function drawCleanupMaskDebugOverlay({
	context,
	mask,
}: {
	context: RenderableContext;
	mask: CursorCleanupMask;
}): void {
	const overlayCanvas = createOffscreenCanvas({
		width: mask.width,
		height: mask.height,
	});
	const overlayContext = overlayCanvas.getContext("2d") as RenderableContext | null;
	if (!overlayContext) {
		return;
	}

	const overlayImageData = overlayContext.createImageData(mask.width, mask.height);
	for (let index = 0; index < mask.alpha.length; index += 1) {
		const alpha = mask.alpha[index];
		if (alpha <= 0) {
			continue;
		}
		const offset = index * 4;
		overlayImageData.data[offset] = 236;
		overlayImageData.data[offset + 1] = 72;
		overlayImageData.data[offset + 2] = 153;
		overlayImageData.data[offset + 3] = Math.round(alpha * 0.32);
	}

	overlayContext.putImageData(overlayImageData, 0, 0);

	context.save();
	context.drawImage(overlayCanvas, mask.minX, mask.minY);
	context.strokeStyle = "rgba(236, 72, 153, 0.95)";
	context.lineWidth = 1.5;
	context.strokeRect(mask.minX + 0.75, mask.minY + 0.75, mask.width - 1.5, mask.height - 1.5);
	context.font = "600 12px Inter, system-ui, sans-serif";
	context.fillStyle = "rgba(15, 23, 42, 0.82)";
	context.fillRect(mask.minX + 6, Math.max(4, mask.minY - 20), 74, 16);
	context.fillStyle = "rgba(236, 72, 153, 0.98)";
	context.fillText("CLEANUP", mask.minX + 10, Math.max(16, mask.minY - 8));
	context.restore();
}

function drawCustomCursorDebugOverlay({
	context,
	rawTrackedPosition,
	renderedCursorPosition,
	cleanupMask,
}: {
	context: RenderableContext;
	rawTrackedPosition: CursorPoint;
	renderedCursorPosition: CursorPoint;
	cleanupMask: CursorCleanupMask | null;
}): void {
	if (cleanupMask) {
		drawCleanupMaskDebugOverlay({
			context,
			mask: cleanupMask,
		});
	}

	context.save();
	context.strokeStyle = "rgba(148, 163, 184, 0.9)";
	context.lineWidth = 1.5;
	context.setLineDash([5, 4]);
	context.beginPath();
	context.moveTo(rawTrackedPosition.x, rawTrackedPosition.y);
	context.lineTo(renderedCursorPosition.x, renderedCursorPosition.y);
	context.stroke();
	context.restore();

	drawDebugMarker({
		context,
		position: rawTrackedPosition,
		color: "rgba(34, 211, 238, 0.98)",
		label: "TRACKED",
	});
	drawDebugMarker({
		context,
		position: renderedCursorPosition,
		color: "rgba(132, 204, 22, 0.98)",
		label: "RENDERED",
	});
}

function mapCursorPointThroughZoomEffects({
	x,
	y,
	width,
	height,
	zoomEffects,
}: {
	x: number;
	y: number;
	width: number;
	height: number;
	zoomEffects: AppliedZoomEffect[];
}): CursorPoint {
	let pixelX = x;
	let pixelY = y;
	for (const zoomEffect of zoomEffects) {
		const transformedPoint = mapPointThroughZoomEffect({
			x: pixelX,
			y: pixelY,
			width,
			height,
			effectParams: zoomEffect.effectParams,
			progress: zoomEffect.progress,
			duration: zoomEffect.duration,
		});
		pixelX = transformedPoint.x;
		pixelY = transformedPoint.y;
	}
	return { x: pixelX, y: pixelY };
}

function resolveCursorPixelPositionAtTime({
	events,
	time,
	smoothness,
	width,
	height,
	zoomEffects,
}: {
	events: RecordedCursorEvent[];
	time: number;
	smoothness: number;
	width: number;
	height: number;
	zoomEffects: AppliedZoomEffect[];
}): CursorPoint {
	const index = findEventIndexAtOrBefore({ events, time });
	const position = resolveInterpolatedPosition({
		events,
		time,
		index,
		smoothness,
	});
	return mapCursorPointThroughZoomEffects({
		x: position.x * width,
		y: position.y * height,
		width,
		height,
		zoomEffects,
	});
}

function dedupeCursorPoints(points: CursorPoint[]): CursorPoint[] {
	const uniquePoints: CursorPoint[] = [];
	for (const point of points) {
		const alreadyAdded = uniquePoints.some(
			(existingPoint) =>
				Math.hypot(existingPoint.x - point.x, existingPoint.y - point.y) <= 0.75,
		);
		if (!alreadyAdded) {
			uniquePoints.push(point);
		}
	}
	return uniquePoints;
}

function resolveCursorCleanupTrail({
	events,
	time,
	smoothness,
	width,
	height,
	zoomEffects,
	currentPosition,
	size,
	cleanupSize,
}: {
	events: RecordedCursorEvent[];
	time: number;
	smoothness: number;
	width: number;
	height: number;
	zoomEffects: AppliedZoomEffect[];
	currentPosition: CursorPoint;
	size: number;
	cleanupSize: number;
}): CursorPoint[] {
	const sampleOffset = 1 / 120;
	const previousPosition = resolveCursorPixelPositionAtTime({
		events,
		time: Math.max(0, time - sampleOffset),
		smoothness,
		width,
		height,
		zoomEffects,
	});
	const nextPosition = resolveCursorPixelPositionAtTime({
		events,
		time: time + sampleOffset,
		smoothness,
		width,
		height,
		zoomEffects,
	});
	const deltaX = nextPosition.x - previousPosition.x;
	const deltaY = nextPosition.y - previousPosition.y;
	const travel = Math.hypot(deltaX, deltaY);
	if (travel <= 0.35) {
		return [currentPosition];
	}

	const cleanupScale = clamp(cleanupSize / 100, 0.6, 2.2);
	const uncertaintyDistance = clamp(
		travel * 0.18,
		0,
		Math.max(1, size * cleanupScale * 0.16),
	);
	if (uncertaintyDistance <= 0.35) {
		return [currentPosition];
	}

	const directionX = deltaX / travel;
	const directionY = deltaY / travel;
	return dedupeCursorPoints([
		currentPosition,
		{
			x: currentPosition.x - directionX * uncertaintyDistance,
			y: currentPosition.y - directionY * uncertaintyDistance,
		},
	]);
}

function resolveCursorCleanupExtent({
	kind,
	size,
}: {
	kind: CursorVisualKind;
	size: number;
}): { x: number; y: number } {
	if (kind === "text") {
		return { x: size * 0.42, y: size * 1.28 };
	}
	if (kind === "crosshair" || kind === "not-allowed") {
		return { x: size * 0.84, y: size * 0.84 };
	}
	if (kind === "grab" || kind === "grabbing") {
		return { x: size * 0.98, y: size * 0.98 };
	}
	if (kind === "pointer") {
		return { x: size * 0.96, y: size * 1.06 };
	}
	return { x: size * 0.96, y: size * 1.3 };
}

function buildCursorCleanupMask({
	positions,
	kind,
	size,
	cleanupSize,
	width,
	height,
}: {
	positions: CursorPoint[];
	kind: CursorVisualKind;
	size: number;
	cleanupSize: number;
	width: number;
	height: number;
}): CursorCleanupMask | null {
	if (positions.length === 0) {
		return null;
	}

	const cleanupScale = clamp(cleanupSize / 100, 0.6, 2.2);
	const cleanupCursorSize = size * cleanupScale;
	const cleanupDrawOffset = getCursorDrawOffset({
		kind,
		size: cleanupCursorSize,
	});
	const cleanupOffsetBias = getCursorCleanupOffset({
		kind,
		size: cleanupCursorSize,
	});
	const translatedPositions = positions.map((position) => ({
		x: position.x + cleanupDrawOffset.x + cleanupOffsetBias.x,
		y: position.y + cleanupDrawOffset.y + cleanupOffsetBias.y,
	}));
	const extent = resolveCursorCleanupExtent({
		kind,
		size: cleanupCursorSize,
	});
	const shadowBlur = Math.max(1.5, cleanupCursorSize * 0.16);
	const padding = Math.ceil(Math.max(extent.x, extent.y) + shadowBlur * 2 + 3);
	const minPositionX = Math.min(...translatedPositions.map((position) => position.x));
	const maxPositionX = Math.max(...translatedPositions.map((position) => position.x));
	const minPositionY = Math.min(...translatedPositions.map((position) => position.y));
	const maxPositionY = Math.max(...translatedPositions.map((position) => position.y));
	const minX = Math.max(0, Math.floor(minPositionX - padding));
	const minY = Math.max(0, Math.floor(minPositionY - padding));
	const maxX = Math.min(width, Math.ceil(maxPositionX + padding));
	const maxY = Math.min(height, Math.ceil(maxPositionY + padding));
	const regionWidth = Math.max(0, maxX - minX);
	const regionHeight = Math.max(0, maxY - minY);
	if (regionWidth <= 1 || regionHeight <= 1) {
		return null;
	}

	const maskCanvas = createOffscreenCanvas({ width: regionWidth, height: regionHeight });
	const maskContext = maskCanvas.getContext("2d") as RenderableContext | null;
	if (!maskContext) {
		return null;
	}

	maskContext.fillStyle = "#ffffff";
	maskContext.strokeStyle = "#ffffff";
	maskContext.shadowColor = "rgba(255, 255, 255, 0.96)";
	maskContext.shadowBlur = shadowBlur;
	maskContext.lineJoin = "round";
	maskContext.lineCap = "round";

	for (const position of translatedPositions) {
		maskContext.save();
		maskContext.translate(position.x - minX, position.y - minY);
		drawCursorGlyph({
			context: maskContext,
			kind,
			size: cleanupCursorSize,
			fillColor: "#ffffff",
			outlineColor: "#ffffff",
			accentColor: "#ffffff",
		});
		maskContext.restore();
	}

	const maskImageData = maskContext.getImageData(0, 0, regionWidth, regionHeight);
	const alpha = new Uint8ClampedArray(regionWidth * regionHeight);
	let hasVisibleMask = false;
	for (let index = 0; index < alpha.length; index += 1) {
		const alphaValue = maskImageData.data[index * 4 + 3];
		alpha[index] = alphaValue;
		if (alphaValue > 10) {
			hasVisibleMask = true;
		}
	}

	if (!hasVisibleMask) {
		return null;
	}

	return {
		minX,
		minY,
		width: regionWidth,
		height: regionHeight,
		alpha,
	};
}

function findDirectionalCleanupSample({
	startX,
	startY,
	directionX,
	directionY,
	maskAlpha,
	sourceData,
	regionWidth,
	regionHeight,
	maxDistance,
}: {
	startX: number;
	startY: number;
	directionX: number;
	directionY: number;
	maskAlpha: Uint8ClampedArray;
	sourceData: Uint8ClampedArray;
	regionWidth: number;
	regionHeight: number;
	maxDistance: number;
}): CleanupSample | null {
	for (let distance = 1; distance <= maxDistance; distance += 1) {
		const sampleX = Math.round(startX + directionX * distance);
		const sampleY = Math.round(startY + directionY * distance);
		if (
			sampleX < 0 ||
			sampleY < 0 ||
			sampleX >= regionWidth ||
			sampleY >= regionHeight
		) {
			return null;
		}

		const maskOffset = sampleY * regionWidth + sampleX;
		if (maskAlpha[maskOffset] > 12) {
			continue;
		}

		const secondDistance = Math.min(maxDistance, distance + 2);
		const secondSampleX = clamp(
			Math.round(startX + directionX * secondDistance),
			0,
			regionWidth - 1,
		);
		const secondSampleY = clamp(
			Math.round(startY + directionY * secondDistance),
			0,
			regionHeight - 1,
		);
		const firstOffset = maskOffset * 4;
		const secondOffset = (secondSampleY * regionWidth + secondSampleX) * 4;
		return {
			red: (sourceData[firstOffset] + sourceData[secondOffset]) / 2,
			green: (sourceData[firstOffset + 1] + sourceData[secondOffset + 1]) / 2,
			blue: (sourceData[firstOffset + 2] + sourceData[secondOffset + 2]) / 2,
			alpha: (sourceData[firstOffset + 3] + sourceData[secondOffset + 3]) / 2,
			distance,
		};
	}
	return null;
}

function projectCleanupMaskToRegion({
	mask,
	region,
}: {
	mask: CursorCleanupMask | null;
	region: CursorCleanupMask;
}): Uint8ClampedArray {
	const projectedAlpha = new Uint8ClampedArray(region.width * region.height);
	if (!mask) {
		return projectedAlpha;
	}

	const overlapMinX = Math.max(mask.minX, region.minX);
	const overlapMinY = Math.max(mask.minY, region.minY);
	const overlapMaxX = Math.min(mask.minX + mask.width, region.minX + region.width);
	const overlapMaxY = Math.min(mask.minY + mask.height, region.minY + region.height);

	if (overlapMinX >= overlapMaxX || overlapMinY >= overlapMaxY) {
		return projectedAlpha;
	}

	for (let y = overlapMinY; y < overlapMaxY; y += 1) {
		const sourceRowOffset = (y - mask.minY) * mask.width;
		const targetRowOffset = (y - region.minY) * region.width;
		for (let x = overlapMinX; x < overlapMaxX; x += 1) {
			projectedAlpha[targetRowOffset + (x - region.minX)] =
				mask.alpha[sourceRowOffset + (x - mask.minX)];
		}
	}

	return projectedAlpha;
}

function readSourceRegionData({
	source,
	width,
	height,
	region,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	region: CursorCleanupMask;
}): Uint8ClampedArray | null {
	const regionCanvas = createOffscreenCanvas({
		width: region.width,
		height: region.height,
	});
	const regionContext = regionCanvas.getContext("2d") as RenderableContext | null;
	if (!regionContext) {
		return null;
	}

	regionContext.drawImage(source, -region.minX, -region.minY, width, height);
	return regionContext.getImageData(0, 0, region.width, region.height).data;
}

function prepareTemporalCleanupSamples({
	temporalCleanupFrames,
	sourceTime,
	events,
	smoothness,
	width,
	height,
	zoomEffects,
	size,
	cleanupSize,
	cleanupMask,
}: {
	temporalCleanupFrames: TemporalCleanupFrame[];
	sourceTime: number;
	events: RecordedCursorEvent[];
	smoothness: number;
	width: number;
	height: number;
	zoomEffects: AppliedZoomEffect[];
	size: number;
	cleanupSize: number;
	cleanupMask: CursorCleanupMask;
}): PreparedTemporalCleanupSample[] {
	return temporalCleanupFrames
		.map((frame) => ({
			...frame,
			timeDistance: Math.abs(frame.sourceTime - sourceTime),
		}))
		.filter(
			(frame) =>
				Number.isFinite(frame.timeDistance) &&
				frame.timeDistance > 0.0005 &&
				frame.timeDistance <= 0.12,
		)
		.sort((left, right) => left.timeDistance - right.timeDistance)
		.slice(0, 2)
		.map((frame) => {
			const sampleIndex = findEventIndexAtOrBefore({
				events,
				time: frame.sourceTime,
			});
			const sampleEvent = events[Math.max(sampleIndex, 0)] ?? events[0];
			if (!sampleEvent) {
				return null;
			}

			const currentPosition = resolveCursorPixelPositionAtTime({
				events,
				time: frame.sourceTime,
				smoothness,
				width,
				height,
				zoomEffects,
			});
			const sampleMask = buildCursorCleanupMask({
				positions: resolveCursorCleanupTrail({
					events,
					time: frame.sourceTime,
					smoothness,
					width,
					height,
					zoomEffects,
					currentPosition,
					size,
					cleanupSize,
				}),
				kind: normalizeCursorKind(sampleEvent.cursor),
				size,
				cleanupSize,
				width,
				height,
			});
			const data = readSourceRegionData({
				source: frame.source,
				width,
				height,
				region: cleanupMask,
			});
			if (!data) {
				return null;
			}

			return {
				data,
				maskAlpha: projectCleanupMaskToRegion({
					mask: sampleMask,
					region: cleanupMask,
				}),
				timeDistance: frame.timeDistance,
			};
		})
		.filter(
			(sample): sample is PreparedTemporalCleanupSample => sample !== null,
		);
}

function resolveTemporalCleanupColor({
	maskOffset,
	pixelOffset,
	temporalSamples,
}: {
	maskOffset: number;
	pixelOffset: number;
	temporalSamples: PreparedTemporalCleanupSample[];
}):
	| {
			red: number;
			green: number;
			blue: number;
			alpha: number;
			weight: number;
	  }
	| null {
	let red = 0;
	let green = 0;
	let blue = 0;
	let alpha = 0;
	let totalWeight = 0;

	for (const sample of temporalSamples) {
		const cursorMaskStrength = sample.maskAlpha[maskOffset] / 255;
		if (cursorMaskStrength > 0.08) {
			continue;
		}

		const sampleAlpha = sample.data[pixelOffset + 3] / 255;
		const weight =
			(1 - cursorMaskStrength) *
			(0.35 + sampleAlpha * 0.65) /
			(1 + sample.timeDistance * 36);
		if (weight <= 0.0001) {
			continue;
		}

		red += sample.data[pixelOffset] * weight;
		green += sample.data[pixelOffset + 1] * weight;
		blue += sample.data[pixelOffset + 2] * weight;
		alpha += sample.data[pixelOffset + 3] * weight;
		totalWeight += weight;
	}

	if (totalWeight <= 0.0001) {
		return null;
	}

	return {
		red: red / totalWeight,
		green: green / totalWeight,
		blue: blue / totalWeight,
		alpha: alpha / totalWeight,
		weight: totalWeight,
	};
}

function applyNativeCursorCleanup({
	context,
	source,
	width,
	height,
	mask,
	temporalSamples,
}: {
	context: RenderableContext;
	source: CanvasImageSource;
	width: number;
	height: number;
	mask: CursorCleanupMask;
	temporalSamples: PreparedTemporalCleanupSample[];
}): void {
	const cleanupCanvas = createOffscreenCanvas({
		width: mask.width,
		height: mask.height,
	});
	const cleanupContext = cleanupCanvas.getContext("2d") as RenderableContext | null;
	if (!cleanupContext) {
		return;
	}

	cleanupContext.drawImage(source, -mask.minX, -mask.minY, width, height);
	const imageData = cleanupContext.getImageData(0, 0, mask.width, mask.height);
	const sourceData = new Uint8ClampedArray(imageData.data);
	const targetData = imageData.data;
	const pairDirections = Array.from({ length: 8 }, (_value, index) => {
		const angle = (index / 8) * Math.PI;
		return {
			x: Math.cos(angle),
			y: Math.sin(angle),
		};
	});
	const fallbackDirections = Array.from({ length: 16 }, (_value, index) => {
		const angle = (index / 16) * Math.PI * 2;
		return {
			x: Math.cos(angle),
			y: Math.sin(angle),
		};
	});
	const maxDistance = Math.max(6, Math.ceil(Math.max(mask.width, mask.height) * 0.32));

	for (let y = 0; y < mask.height; y += 1) {
		for (let x = 0; x < mask.width; x += 1) {
			const maskOffset = y * mask.width + x;
			const maskStrength = mask.alpha[maskOffset] / 255;
			if (maskStrength <= 0.04) {
				continue;
			}

			const pixelOffset = maskOffset * 4;
			let red = 0;
			let green = 0;
			let blue = 0;
			let alpha = 0;
			let totalWeight = 0;
			const temporalColor =
				temporalSamples.length > 0
					? resolveTemporalCleanupColor({
							maskOffset,
							pixelOffset,
							temporalSamples,
						})
					: null;

			if (temporalColor) {
				const temporalWeight = 1.4 + Math.min(1.6, temporalColor.weight * 4.5);
				red += temporalColor.red * temporalWeight;
				green += temporalColor.green * temporalWeight;
				blue += temporalColor.blue * temporalWeight;
				alpha += temporalColor.alpha * temporalWeight;
				totalWeight += temporalWeight;
			}

			if (!temporalColor || temporalColor.weight < 0.14) {
				for (const direction of pairDirections) {
					const leftSample = findDirectionalCleanupSample({
						startX: x,
						startY: y,
						directionX: direction.x,
						directionY: direction.y,
						maskAlpha: mask.alpha,
						sourceData,
						regionWidth: mask.width,
						regionHeight: mask.height,
						maxDistance,
					});
					const rightSample = findDirectionalCleanupSample({
						startX: x,
						startY: y,
						directionX: -direction.x,
						directionY: -direction.y,
						maskAlpha: mask.alpha,
						sourceData,
						regionWidth: mask.width,
						regionHeight: mask.height,
						maxDistance,
					});
					if (!leftSample || !rightSample) {
						continue;
					}

					const colorDifference = Math.hypot(
						leftSample.red - rightSample.red,
						leftSample.green - rightSample.green,
						leftSample.blue - rightSample.blue,
					);
					const similarity = 1 - clamp(colorDifference / 441.6729559300637, 0, 1);
					const balance =
						1 -
						clamp(
							Math.abs(leftSample.distance - rightSample.distance) /
								Math.max(1, leftSample.distance + rightSample.distance),
							0,
							1,
						);
					const weight =
						(0.15 + similarity * 0.85) *
						(0.35 + balance * 0.65) /
						Math.max(1, leftSample.distance + rightSample.distance);
					if (weight <= 0.0001) {
						continue;
					}

					red += ((leftSample.red + rightSample.red) / 2) * weight;
					green += ((leftSample.green + rightSample.green) / 2) * weight;
					blue += ((leftSample.blue + rightSample.blue) / 2) * weight;
					alpha += ((leftSample.alpha + rightSample.alpha) / 2) * weight;
					totalWeight += weight;
				}
			}

			if (totalWeight <= 0.0001 || (!temporalColor && totalWeight < 0.08)) {
				for (const direction of fallbackDirections) {
					const sample = findDirectionalCleanupSample({
						startX: x,
						startY: y,
						directionX: direction.x,
						directionY: direction.y,
						maskAlpha: mask.alpha,
						sourceData,
						regionWidth: mask.width,
						regionHeight: mask.height,
						maxDistance,
					});
					if (!sample) {
						continue;
					}

					const weight = 1 / Math.max(1, sample.distance * 1.4);
					red += sample.red * weight;
					green += sample.green * weight;
					blue += sample.blue * weight;
					alpha += sample.alpha * weight;
					totalWeight += weight;
				}
			}

			if (totalWeight <= 0.0001) {
				continue;
			}

			const blend = clamp(maskStrength, 0, 1);
			const targetRed = red / totalWeight;
			const targetGreen = green / totalWeight;
			const targetBlue = blue / totalWeight;
			const targetAlpha = alpha / totalWeight;
			targetData[pixelOffset] = Math.round(
				sourceData[pixelOffset] + (targetRed - sourceData[pixelOffset]) * blend,
			);
			targetData[pixelOffset + 1] = Math.round(
				sourceData[pixelOffset + 1] + (targetGreen - sourceData[pixelOffset + 1]) * blend,
			);
			targetData[pixelOffset + 2] = Math.round(
				sourceData[pixelOffset + 2] + (targetBlue - sourceData[pixelOffset + 2]) * blend,
			);
			targetData[pixelOffset + 3] = Math.round(
				sourceData[pixelOffset + 3] + (targetAlpha - sourceData[pixelOffset + 3]) * blend,
			);
		}
	}

	cleanupContext.putImageData(imageData, 0, 0);
	context.drawImage(cleanupCanvas, mask.minX, mask.minY);
}

export function applyCustomCursorEffect({
	source,
	width,
	height,
	sourceTime,
	effectParams,
	recordedCursor,
	zoomEffects,
	temporalCleanupFrames,
}: {
	source: CanvasImageSource;
	width: number;
	height: number;
	sourceTime: number;
	effectParams: EffectParamValues;
	recordedCursor?: RecordedCursorData;
	zoomEffects: AppliedZoomEffect[];
	temporalCleanupFrames?: TemporalCleanupFrame[];
}): CanvasImageSource {
	if (!recordedCursor || recordedCursor.events.length === 0) {
		return source;
	}

	const events = recordedCursor.events;
	const index = findEventIndexAtOrBefore({ events, time: sourceTime });
	const currentEvent = events[Math.max(index, 0)] ?? events[0];
	if (!currentEvent) {
		return source;
	}

	const smoothness = resolveSmoothnessFactor({ effectParams });
	const position = resolveInterpolatedPosition({
		events,
		time: sourceTime,
		index,
		smoothness,
	});
	const rawTrackedPosition = {
		x: position.x * width,
		y: position.y * height,
	};
	const transformedPosition = mapCursorPointThroughZoomEffects({
		x: rawTrackedPosition.x,
		y: rawTrackedPosition.y,
		width,
		height,
		zoomEffects,
	});
	const pixelX = transformedPosition.x;
	const pixelY = transformedPosition.y;

	const size = clamp(resolveNumber({ value: effectParams.size, fallback: 28 }), 10, 96);
	const opacity = clamp(resolveNumber({ value: effectParams.opacity, fallback: 100 }) / 100, 0, 1);
	const removeNativeCursor = resolveBoolean({
		value: effectParams.removeNativeCursor,
		fallback: true,
	});
	const debugOverlay = resolveBoolean({
		value: effectParams.debugOverlay,
		fallback: false,
	});
	const cleanupSize = clamp(
		resolveNumber({ value: effectParams.cleanupSize, fallback: 130 }),
		60,
		220,
	);
	const kind = normalizeCursorKind(currentEvent.cursor);
	const cleanupMask = removeNativeCursor
		? buildCursorCleanupMask({
				positions: resolveCursorCleanupTrail({
					events,
					time: sourceTime,
					smoothness,
					width,
					height,
					zoomEffects,
					currentPosition: transformedPosition,
					size,
					cleanupSize,
				}),
				kind,
				size,
				cleanupSize,
				width,
				height,
			})
		: null;
	const temporalSamples =
		cleanupMask && temporalCleanupFrames && temporalCleanupFrames.length > 0
			? prepareTemporalCleanupSamples({
					temporalCleanupFrames,
					sourceTime,
					events,
					smoothness,
					width,
					height,
					zoomEffects,
					size,
					cleanupSize,
					cleanupMask,
				})
			: [];
	const shouldCleanup = cleanupMask !== null;
	const shouldDrawCursor =
		opacity > 0.001 &&
		!(pixelX < -size || pixelY < -size || pixelX > width + size || pixelY > height + size);
	if (!shouldCleanup && !shouldDrawCursor && !debugOverlay) {
		return source;
	}

	const fillColor = typeof effectParams.color === "string" ? effectParams.color : "#ffffff";
	const accentColor = typeof effectParams.accentColor === "string" ? effectParams.accentColor : "#3b82f6";
	const shadowOpacity = clamp(resolveNumber({ value: effectParams.shadowOpacity, fallback: 42 }) / 100, 0, 1);
	const clickPulseEnabled = resolveBoolean({ value: effectParams.clickPulse, fallback: true });
	const pulse = clickPulseEnabled ? resolveClickPulse({ events, time: sourceTime, index }) : 0;
	const pressed = resolvePressedState({ events, index });
	const scale = pressed ? 0.92 : 1 + pulse * 0.06;
	const drawOffset = getCursorDrawOffset({ kind, size });
	const outlineColor = "rgba(15, 23, 42, 0.94)";

	const canvas = createOffscreenCanvas({ width, height });
	const context = canvas.getContext("2d") as RenderableContext | null;
	if (!context) {
		return source;
	}

	context.drawImage(source, 0, 0, width, height);
	if (shouldCleanup) {
		applyNativeCursorCleanup({
			context,
			source,
			width,
			height,
			mask: cleanupMask,
			temporalSamples,
		});
	}
	if (!shouldDrawCursor) {
		if (debugOverlay) {
			drawCustomCursorDebugOverlay({
				context,
				rawTrackedPosition,
				renderedCursorPosition: transformedPosition,
				cleanupMask,
			});
		}
		return canvas;
	}
	context.save();
	context.translate(pixelX + drawOffset.x, pixelY + drawOffset.y);
	context.scale(scale, scale);
	context.globalAlpha = opacity;
	context.shadowColor = `rgba(15, 23, 42, ${0.18 + shadowOpacity * 0.42})`;
	context.shadowBlur = size * 0.25;
	context.shadowOffsetX = size * 0.05;
	context.shadowOffsetY = size * 0.1;
	if (pulse > 0) {
		drawClickPulse({
			context,
			accentColor,
			pulse,
			size,
		});
	}
	drawCursorGlyph({
		context,
		kind,
		size,
		fillColor,
		outlineColor,
		accentColor,
	});
	context.restore();
	if (debugOverlay) {
		drawCustomCursorDebugOverlay({
			context,
			rawTrackedPosition,
			renderedCursorPosition: transformedPosition,
			cleanupMask,
		});
	}
	return canvas;
}
