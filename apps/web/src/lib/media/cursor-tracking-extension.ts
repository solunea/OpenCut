import { parseRecordedCursorData } from "@/lib/media/recorded-cursor";
import type { RecordedCursorData } from "@/types/cursor-tracking";

const PAGE_BRIDGE_NAMESPACE = "opencut-cursor-bridge";
const REQUEST_TIMEOUT_MS = 5000;

function buildRequestId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildUnavailableMessage(): string {
	return "OpenCut Cursor Tracker extension is unavailable. Install or reload the extension, then refresh OpenCut.";
}

function unwrapRecordedCursorPayload(payload: unknown): unknown {
	if (
		payload &&
		typeof payload === "object" &&
		"payload" in payload &&
		(payload as { payload?: unknown }).payload !== undefined
	) {
		return (payload as { payload: unknown }).payload;
	}
	return payload;
}

async function sendBridgeRequest({
	type,
	payload,
}: {
	type: "session-start" | "session-stop-export" | "session-cancel";
	payload?: unknown;
}): Promise<unknown> {
	if (typeof window === "undefined") {
		throw new Error(buildUnavailableMessage());
	}

	const requestId = buildRequestId();

	return await new Promise((resolve, reject) => {
		const timeoutId = window.setTimeout(() => {
			window.removeEventListener("message", handleMessage);
			reject(new Error(buildUnavailableMessage()));
		}, REQUEST_TIMEOUT_MS);

		const handleMessage = (event: MessageEvent) => {
			if (event.source !== window || event.origin !== window.location.origin) {
				return;
			}

			const message = event.data;
			if (
				!message ||
				message.namespace !== PAGE_BRIDGE_NAMESPACE ||
				message.direction !== "response" ||
				message.requestId !== requestId
			) {
				return;
			}

			window.clearTimeout(timeoutId);
			window.removeEventListener("message", handleMessage);

			if (!message.ok) {
				reject(
					new Error(
						typeof message.error === "string" && message.error.length > 0
							? message.error
							: buildUnavailableMessage(),
					),
				);
				return;
			}

			resolve(message.payload);
		};

		window.addEventListener("message", handleMessage);
		window.postMessage(
			{
				namespace: PAGE_BRIDGE_NAMESPACE,
				direction: "request",
				requestId,
				type,
				payload,
			},
			window.location.origin,
		);
	});
}

export async function startCursorTrackingCaptureSession({
	shouldHideNativeCursor = false,
}: {
	shouldHideNativeCursor?: boolean;
} = {}): Promise<void> {
	await sendBridgeRequest({
		type: "session-start",
		payload: { shouldHideNativeCursor },
	});
}

export async function cancelCursorTrackingCaptureSession(): Promise<void> {
	try {
		await sendBridgeRequest({ type: "session-cancel" });
	} catch {
	}
}

export async function stopAndExportCursorTrackingCaptureSession(): Promise<RecordedCursorData> {
	const payload = await sendBridgeRequest({ type: "session-stop-export" });
	return parseRecordedCursorData({ data: unwrapRecordedCursorPayload(payload) });
}
