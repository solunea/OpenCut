(() => {
	if (globalThis.__opencutCursorTrackerLoaded) {
		return;
	}

	globalThis.__opencutCursorTrackerLoaded = true;

	const MAX_EVENT_COUNT = 20000;
	const MAX_MOVE_SAMPLE_RATE_MS = 16;
	const MIN_MOVE_DISTANCE = 0.0015;
	const CURSOR_STATE_SAMPLE_RATE_MS = 120;
	const MESSAGE_NAMESPACE = "opencut-cursor";
	const PAGE_BRIDGE_NAMESPACE = "opencut-cursor-bridge";

	const state = {
		isTracking: false,
		startedAt: null,
		startedAtPerf: 0,
		events: [],
		lastPointer: null,
		lastButtons: 0,
		lastMoveAt: 0,
		lastMoveX: null,
		lastMoveY: null,
		shouldHideNativeCursor: false,
	};

	function clamp(value, min, max) {
		return Math.min(Math.max(value, min), max);
	}

	function getViewport() {
		const doc = document.documentElement;
		return {
			viewportWidth: Math.max(doc?.clientWidth ?? 0, window.innerWidth ?? 0, 1),
			viewportHeight: Math.max(doc?.clientHeight ?? 0, window.innerHeight ?? 0, 1),
			devicePixelRatio: window.devicePixelRatio || 1,
		};
	}

	function getNormalizedPosition(x, y, viewportWidth, viewportHeight) {
		return {
			normalizedX: clamp(x / Math.max(viewportWidth, 1), 0, 1),
			normalizedY: clamp(y / Math.max(viewportHeight, 1), 0, 1),
		};
	}

	function getCursor(target) {
		if (target instanceof Element) {
			const cursor = window.getComputedStyle(target).cursor;
			if (cursor) {
				return cursor;
			}
		}

		return window.getComputedStyle(document.documentElement).cursor || "default";
	}

	function getRelativeTimeSeconds() {
		if (!state.startedAt) {
			return 0;
		}

		return Math.max(0, (performance.now() - state.startedAtPerf) / 1000);
	}

	function resetTracking({ shouldHideNativeCursor = false } = {}) {
		state.isTracking = true;
		state.startedAt = new Date().toISOString();
		state.startedAtPerf = performance.now();
		state.events = [];
		state.lastPointer = null;
		state.lastButtons = 0;
		state.lastMoveAt = 0;
		state.lastMoveX = null;
		state.lastMoveY = null;
		state.shouldHideNativeCursor = shouldHideNativeCursor;
	}

	function recordEvent({
		type,
		x,
		y,
		cursor,
		button,
		buttons,
		deltaX,
		deltaY,
		scrollX,
		scrollY,
		force,
	}) {
		if (!state.isTracking || !state.startedAt) {
			return;
		}

		const viewport = getViewport();
		const safeX = clamp(
			typeof x === "number" ? x : state.lastPointer?.x ?? 0,
			0,
			viewport.viewportWidth,
		);
		const safeY = clamp(
			typeof y === "number" ? y : state.lastPointer?.y ?? 0,
			0,
			viewport.viewportHeight,
		);
		const position = getNormalizedPosition(
			safeX,
			safeY,
			viewport.viewportWidth,
			viewport.viewportHeight,
		);

		if (type === "move" && !force) {
			const now = performance.now();
			const distance =
				state.lastMoveX === null || state.lastMoveY === null
					? 1
					: Math.hypot(
						position.normalizedX - state.lastMoveX,
						position.normalizedY - state.lastMoveY,
					);
			if (
				now - state.lastMoveAt < MAX_MOVE_SAMPLE_RATE_MS &&
				distance < MIN_MOVE_DISTANCE
			) {
				return;
			}
			state.lastMoveAt = now;
			state.lastMoveX = position.normalizedX;
			state.lastMoveY = position.normalizedY;
		}

		const resolvedCursor = cursor || state.lastPointer?.cursor || "default";
		const resolvedButtons =
			typeof buttons === "number" ? buttons : state.lastButtons;
		const event = {
			time: getRelativeTimeSeconds(),
			type,
			x: safeX,
			y: safeY,
			normalizedX: position.normalizedX,
			normalizedY: position.normalizedY,
			cursor: resolvedCursor,
			button,
			buttons: resolvedButtons,
			deltaX,
			deltaY,
			scrollX,
			scrollY,
			viewportWidth: viewport.viewportWidth,
			viewportHeight: viewport.viewportHeight,
			devicePixelRatio: viewport.devicePixelRatio,
		};

		state.events.push(event);
		if (state.events.length > MAX_EVENT_COUNT) {
			state.events.shift();
		}

		state.lastPointer = {
			x: safeX,
			y: safeY,
			cursor: resolvedCursor,
		};
		state.lastButtons = resolvedButtons;
	}

	function buildCursorTracking() {
		const samples = [];
		let lastSample = null;

		for (const event of state.events) {
			const sample = {
				time: event.time,
				x: event.normalizedX,
				y: event.normalizedY,
				confidence: 1,
			};
			if (lastSample) {
				const timeDelta = sample.time - lastSample.time;
				const movement = Math.hypot(sample.x - lastSample.x, sample.y - lastSample.y);
				if (timeDelta < 0.05 && movement < 0.002) {
					continue;
				}
			}
			samples.push(sample);
			lastSample = sample;
		}

		return {
			status: samples.length > 0 ? "ready" : "failed",
			samples,
			averageConfidence: samples.length > 0 ? 1 : undefined,
			analyzedAt: state.startedAt,
			analysisWidth: getViewport().viewportWidth,
			analysisHeight: getViewport().viewportHeight,
			error: samples.length > 0 ? undefined : "No cursor samples were recorded",
		};
	}

	function buildPayload() {
		const viewport = getViewport();
		const duration = state.events.length > 0 ? state.events[state.events.length - 1].time : 0;

		return {
			version: 1,
			source: "opencut-chrome-extension",
			startedAt: state.startedAt ?? new Date().toISOString(),
			duration,
			viewportWidth: viewport.viewportWidth,
			viewportHeight: viewport.viewportHeight,
			devicePixelRatio: viewport.devicePixelRatio,
			page: {
				url: window.location.href,
				title: document.title,
			},
			events: state.events,
			cursorTracking: buildCursorTracking(),
		};
	}

	function postBridgeResponse({ requestId, ok, payload, error }) {
		window.postMessage(
			{
				namespace: PAGE_BRIDGE_NAMESPACE,
				direction: "response",
				requestId,
				ok,
				payload,
				error,
			},
			window.location.origin,
		);
	}

	window.addEventListener(
		"mousemove",
		(event) => {
			recordEvent({
				type: "move",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(event.target),
				buttons: event.buttons,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"mousedown",
		(event) => {
			recordEvent({
				type: "down",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(event.target),
				button: event.button,
				buttons: event.buttons,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"mouseup",
		(event) => {
			recordEvent({
				type: "up",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(event.target),
				button: event.button,
				buttons: event.buttons,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"wheel",
		(event) => {
			recordEvent({
				type: "wheel",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(event.target),
				buttons: event.buttons,
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				scrollX: window.scrollX,
				scrollY: window.scrollY,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"scroll",
		() => {
			const pointerX = state.lastPointer?.x ?? 0;
			const pointerY = state.lastPointer?.y ?? 0;
			const target = document.elementFromPoint(pointerX, pointerY);
			recordEvent({
				type: "scroll",
				x: pointerX,
				y: pointerY,
				cursor: getCursor(target),
				scrollX: window.scrollX,
				scrollY: window.scrollY,
			});
		},
		{ capture: true, passive: true },
	);

	window.setInterval(() => {
		if (!state.isTracking || !state.lastPointer) {
			return;
		}

		const target = document.elementFromPoint(state.lastPointer.x, state.lastPointer.y);
		const cursor = getCursor(target);
		if (cursor === state.lastPointer.cursor) {
			return;
		}

		recordEvent({
			type: "move",
			x: state.lastPointer.x,
			y: state.lastPointer.y,
			cursor,
			buttons: state.lastButtons,
			force: true,
		});
	}, CURSOR_STATE_SAMPLE_RATE_MS);

	window.addEventListener("message", (event) => {
		if (event.source !== window || event.origin !== window.location.origin) {
			return;
		}

		const message = event.data;
		if (
			!message ||
			message.namespace !== PAGE_BRIDGE_NAMESPACE ||
			message.direction !== "request" ||
			typeof message.requestId !== "string" ||
			typeof message.type !== "string"
		) {
			return;
		}

		let runtimeRequest;
		try {
			runtimeRequest = chrome.runtime.sendMessage({
				namespace: MESSAGE_NAMESPACE,
				type: message.type,
				payload: message.payload,
			});
		} catch (error) {
			postBridgeResponse({
				requestId: message.requestId,
				ok: false,
				error:
					error instanceof Error
						? error.message
						: "OpenCut Cursor Tracker bridge is unavailable",
			});
			return;
		}

		void runtimeRequest
			.then((response) => {
				postBridgeResponse({
					requestId: message.requestId,
					ok: Boolean(response?.ok),
					payload: response?.payload,
					error:
						typeof response?.error === "string"
							? response.error
							: response?.ok
								? undefined
								: "OpenCut Cursor Tracker request failed",
				});
			})
			.catch((error) => {
				postBridgeResponse({
					requestId: message.requestId,
					ok: false,
					error:
						error instanceof Error
							? error.message
							: "OpenCut Cursor Tracker bridge is unavailable",
				});
			});
	});

	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (!message || message.namespace !== MESSAGE_NAMESPACE) {
			return undefined;
		}

		if (message.type === "start") {
			resetTracking({
				shouldHideNativeCursor: Boolean(message.payload?.shouldHideNativeCursor),
			});
			sendResponse({
				ok: true,
				tracking: true,
				eventCount: 0,
				shouldHideNativeCursor: state.shouldHideNativeCursor,
			});
			return false;
		}

		if (message.type === "stop") {
			state.isTracking = false;
			state.shouldHideNativeCursor = false;
			sendResponse({ ok: true, tracking: false, eventCount: state.events.length });
			return false;
		}

		if (message.type === "status") {
			sendResponse({
				ok: true,
				tracking: state.isTracking,
				eventCount: state.events.length,
				startedAt: state.startedAt,
				title: document.title,
			});
			return false;
		}

		if (message.type === "export") {
			sendResponse({ ok: true, payload: buildPayload() });
			return false;
		}

		sendResponse({ ok: false, error: "Unsupported message" });
		return false;
	});
})();
