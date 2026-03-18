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
	const FRAME_RELAY_NAMESPACE = "opencut-cursor-frame-relay";
	const CAPTURE_CURSOR_STYLE_ID = "opencut-capture-cursor-style";
	const CAPTURE_CURSOR_DOT_ID = "opencut-capture-cursor-dot";
	const CAPTURE_CURSOR_SHADOW_STYLE_ATTRIBUTE = "data-opencut-capture-cursor-shadow-style";

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
		cursorAppearanceObserver: null,
		hiddenCursorElements: new Map(),
		activeSuppressedCursorElements: [],
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

	function getCaptureCursorCss({ includeDot }) {
		return `
			html,
			body,
			html *,
			body *,
			html *::before,
			html *::after,
			body *::before,
			body *::after {
				cursor: none !important;
			}

			${includeDot ? `#${CAPTURE_CURSOR_DOT_ID} {
				position: fixed !important;
				left: 0;
				top: 0;
				width: 4px;
				height: 4px;
				border-radius: 9999px;
				background: rgba(255, 255, 255, 0.48);
				box-shadow:
					0 0 0 1px rgba(15, 23, 42, 0.22),
					0 0 6px rgba(255, 255, 255, 0.12);
				transform: translate(-50%, -50%);
				pointer-events: none !important;
				z-index: 2147483647 !important;
				display: none;
			}` : ""}
		`;
	}

	function hideCursorInlineOnElement(element) {
		if (!(element instanceof Element) || !element.style) {
			return;
		}

		if (!state.hiddenCursorElements.has(element)) {
			state.hiddenCursorElements.set(element, {
				value: element.style.getPropertyValue("cursor"),
				priority: element.style.getPropertyPriority("cursor"),
			});
		}

		element.style.setProperty("cursor", "none", "important");
	}

	function restoreHiddenCursorElements() {
		for (const [element, previous] of state.hiddenCursorElements.entries()) {
			if (!(element instanceof Element) || !element.style) {
				continue;
			}

			if (previous.value) {
				element.style.setProperty("cursor", previous.value, previous.priority || undefined);
			} else {
				element.style.removeProperty("cursor");
			}
		}

		state.hiddenCursorElements.clear();
		state.activeSuppressedCursorElements = [];
	}

	function restoreCursorSuppressionChain() {
		for (const element of state.activeSuppressedCursorElements) {
			const previous = state.hiddenCursorElements.get(element);
			if (!(element instanceof Element) || !element.style || !previous) {
				continue;
			}

			if (previous.value) {
				element.style.setProperty("cursor", previous.value, previous.priority || undefined);
			} else {
				element.style.removeProperty("cursor");
			}

			state.hiddenCursorElements.delete(element);
		}

		state.activeSuppressedCursorElements = [];
	}

	function suppressCursorOnTargetChain(target) {
		restoreCursorSuppressionChain();

		const elements = [];
		if (document.documentElement) {
			elements.push(document.documentElement);
		}
		if (document.body) {
			elements.push(document.body);
		}

		let current = target instanceof Element ? target : null;
		while (current) {
			elements.push(current);
			const rootNode = current.getRootNode?.();
			if (rootNode instanceof ShadowRoot && rootNode.host instanceof Element) {
				current = rootNode.host;
				continue;
			}
			current = current.parentElement;
		}

		const uniqueElements = [...new Set(elements)];
		for (const element of uniqueElements) {
			hideCursorInlineOnElement(element);
		}
		state.activeSuppressedCursorElements = uniqueElements;
	}

	function ensureShadowCursorAppearance(shadowRoot) {
		if (!(shadowRoot instanceof ShadowRoot)) {
			return;
		}

		let styleElement = shadowRoot.querySelector(
			`style[${CAPTURE_CURSOR_SHADOW_STYLE_ATTRIBUTE}="true"]`,
		);
		if (!(styleElement instanceof HTMLStyleElement)) {
			styleElement = document.createElement("style");
			styleElement.setAttribute(CAPTURE_CURSOR_SHADOW_STYLE_ATTRIBUTE, "true");
			shadowRoot.append(styleElement);
		}

		styleElement.textContent = getCaptureCursorCss({ includeDot: false });
	}

	function syncOpenShadowRoots(root) {
		if (!state.shouldHideNativeCursor) {
			return;
		}

		const stack = [];
		if (root instanceof Document) {
			if (root.documentElement) {
				stack.push(root.documentElement);
			}
		} else if (root instanceof ShadowRoot) {
			stack.push(...root.querySelectorAll("*"));
		} else if (root instanceof Element) {
			stack.push(root);
		}

		while (stack.length > 0) {
			const node = stack.pop();
			if (!(node instanceof Element)) {
				continue;
			}

			if (node.shadowRoot) {
				ensureShadowCursorAppearance(node.shadowRoot);
				stack.push(...node.shadowRoot.querySelectorAll("*"));
			}

			stack.push(...node.children);
		}
	}

	function startCursorAppearanceObserver() {
		if (state.cursorAppearanceObserver || !document.documentElement) {
			return;
		}

		const observer = new MutationObserver((mutations) => {
			if (!state.shouldHideNativeCursor) {
				return;
			}

			if (!document.getElementById(CAPTURE_CURSOR_STYLE_ID)) {
				ensureCaptureCursorAppearance();
			}
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node instanceof Element) {
						syncOpenShadowRoots(node);
					}
				}
			}
		});

		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
		state.cursorAppearanceObserver = observer;
	}

	function stopCursorAppearanceObserver() {
		state.cursorAppearanceObserver?.disconnect();
		state.cursorAppearanceObserver = null;
	}

	function removeShadowCursorAppearance(root) {
		const stack = [];
		if (root instanceof Document) {
			if (root.documentElement) {
				stack.push(root.documentElement);
			}
		} else if (root instanceof Element) {
			stack.push(root);
		}

		while (stack.length > 0) {
			const node = stack.pop();
			if (!(node instanceof Element)) {
				continue;
			}

			if (node.shadowRoot) {
				node.shadowRoot
					.querySelectorAll(`style[${CAPTURE_CURSOR_SHADOW_STYLE_ATTRIBUTE}="true"]`)
					.forEach((styleElement) => styleElement.remove());
				stack.push(...node.shadowRoot.querySelectorAll("*"));
			}

			stack.push(...node.children);
		}
	}

	function resolvePointerTarget(target) {
		return target instanceof Element ? target : null;
	}

	function removeCaptureCursorAppearance() {
		stopCursorAppearanceObserver();
		restoreHiddenCursorElements();
		removeShadowCursorAppearance(document);
		document.getElementById(CAPTURE_CURSOR_STYLE_ID)?.remove();
		document.getElementById(CAPTURE_CURSOR_DOT_ID)?.remove();
	}

	function ensureCaptureCursorAppearance() {
		const shouldInitializeGlobalSuppression = !state.cursorAppearanceObserver;
		let styleElement = document.getElementById(CAPTURE_CURSOR_STYLE_ID);
		if (!(styleElement instanceof HTMLStyleElement)) {
			styleElement = document.createElement("style");
			styleElement.id = CAPTURE_CURSOR_STYLE_ID;
			(document.head || document.documentElement).append(styleElement);
		}
		const nextCss = getCaptureCursorCss({ includeDot: true });
		if (styleElement.textContent !== nextCss) {
			styleElement.textContent = nextCss;
		}

		let cursorElement = document.getElementById(CAPTURE_CURSOR_DOT_ID);
		if (!(cursorElement instanceof HTMLElement)) {
			cursorElement = document.createElement("div");
			cursorElement.id = CAPTURE_CURSOR_DOT_ID;
			cursorElement.setAttribute("aria-hidden", "true");
			document.documentElement.append(cursorElement);
		}

		if (shouldInitializeGlobalSuppression) {
			startCursorAppearanceObserver();
			syncOpenShadowRoots(document);
			hideCursorInlineOnElement(document.documentElement);
			if (document.body) {
				hideCursorInlineOnElement(document.body);
			}
		}

		return cursorElement;
	}

	function updateCaptureCursorPosition(x, y, target) {
		if (!state.shouldHideNativeCursor) {
			return;
		}

		const cursorElement = ensureCaptureCursorAppearance();
		if (!(cursorElement instanceof HTMLElement)) {
			return;
		}

		cursorElement.style.display = "block";
		cursorElement.style.left = `${x}px`;
		cursorElement.style.top = `${y}px`;
		suppressCursorOnTargetChain(target);
	}

	function syncCaptureCursorAppearance() {
		if (!state.shouldHideNativeCursor) {
			removeCaptureCursorAppearance();
			return;
		}

		const cursorElement = ensureCaptureCursorAppearance();
		if (!(cursorElement instanceof HTMLElement)) {
			return;
		}

		if (!state.lastPointer) {
			cursorElement.style.display = "none";
			return;
		}

		updateCaptureCursorPosition(
			state.lastPointer.x,
			state.lastPointer.y,
			document.elementFromPoint(state.lastPointer.x, state.lastPointer.y),
		);
	}

	function isTopFrame() {
		try {
			return window.top === window;
		} catch {
			return false;
		}
	}

	function findFrameElementForSource(sourceWindow) {
		if (!sourceWindow) {
			return null;
		}
		for (const element of document.querySelectorAll("iframe, frame")) {
			try {
				if (element.contentWindow === sourceWindow) {
					return element;
				}
			} catch {
			}
		}
		return null;
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
		syncCaptureCursorAppearance();
	}

	function stopTrackingState() {
		state.isTracking = false;
		state.shouldHideNativeCursor = false;
		removeCaptureCursorAppearance();
	}

	function broadcastFrameLifecycle(message) {
		for (const element of document.querySelectorAll("iframe, frame")) {
			try {
				element.contentWindow?.postMessage(message, "*");
			} catch {
			}
		}
	}

	function syncTrackingStateToFrame(targetWindow) {
		if (!targetWindow || !state.isTracking) {
			return;
		}

		try {
			targetWindow.postMessage(
				{
					namespace: FRAME_RELAY_NAMESPACE,
					type: "start-tracking",
					payload: {
						shouldHideNativeCursor: state.shouldHideNativeCursor,
					},
				},
				"*",
			);
		} catch {
		}
	}

	function requestTrackingSync() {
		if (isTopFrame()) {
			return;
		}

		try {
			window.parent.postMessage(
				{
					namespace: FRAME_RELAY_NAMESPACE,
					type: "frame-ready",
				},
				"*",
			);
		} catch {
		}
	}

	function recordEvent({
		type,
		x,
		y,
		cursor,
		target,
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
		updateCaptureCursorPosition(safeX, safeY, target ?? null);
	}

	function relayTrackedEvent({
		type,
		x,
		y,
		cursor,
		target,
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
		if (isTopFrame()) {
			recordEvent({
				type,
				x,
				y,
				cursor,
				target,
				button,
				buttons,
				deltaX,
				deltaY,
				scrollX,
				scrollY,
				force,
			});
			return;
		}
		try {
			window.parent.postMessage(
				{
					namespace: FRAME_RELAY_NAMESPACE,
					type: "cursor-event",
					payload: {
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
					},
				},
				"*",
			);
		} catch {
		}
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
			const target = resolvePointerTarget(event.composedPath?.()[0] ?? event.target);
			relayTrackedEvent({
				type: "move",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(target),
				target,
				buttons: event.buttons,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"mousedown",
		(event) => {
			const target = resolvePointerTarget(event.composedPath?.()[0] ?? event.target);
			relayTrackedEvent({
				type: "down",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(target),
				target,
				button: event.button,
				buttons: event.buttons,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"mouseup",
		(event) => {
			const target = resolvePointerTarget(event.composedPath?.()[0] ?? event.target);
			relayTrackedEvent({
				type: "up",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(target),
				target,
				button: event.button,
				buttons: event.buttons,
			});
		},
		{ capture: true, passive: true },
	);

	window.addEventListener(
		"wheel",
		(event) => {
			const target = resolvePointerTarget(event.composedPath?.()[0] ?? event.target);
			relayTrackedEvent({
				type: "wheel",
				x: event.clientX,
				y: event.clientY,
				cursor: getCursor(target),
				target,
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
			relayTrackedEvent({
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
		if (state.shouldHideNativeCursor) {
			updateCaptureCursorPosition(state.lastPointer.x, state.lastPointer.y, target);
		}
		const cursor = getCursor(target);
		if (cursor === state.lastPointer.cursor) {
			return;
		}

		relayTrackedEvent({
			type: "move",
			x: state.lastPointer.x,
			y: state.lastPointer.y,
			cursor,
			buttons: state.lastButtons,
			force: true,
		});
	}, CURSOR_STATE_SAMPLE_RATE_MS);

	window.addEventListener("message", (event) => {
		const message = event.data;
		if (
			message &&
			message.namespace === FRAME_RELAY_NAMESPACE &&
			message.type === "frame-ready"
		) {
			syncTrackingStateToFrame(event.source);
			return;
		}

		if (
			message &&
			message.namespace === FRAME_RELAY_NAMESPACE &&
			(message.type === "start-tracking" || message.type === "stop-tracking")
		) {
			if (message.type === "start-tracking") {
				resetTracking({
					shouldHideNativeCursor: Boolean(message.payload?.shouldHideNativeCursor),
				});
			} else {
				stopTrackingState();
			}
			broadcastFrameLifecycle(message);
			return;
		}
		if (
			!message ||
			message.namespace !== FRAME_RELAY_NAMESPACE ||
			message.type !== "cursor-event" ||
			!message.payload ||
			typeof message.payload.x !== "number" ||
			typeof message.payload.y !== "number"
		) {
			return;
		}
		if (!state.isTracking || !state.startedAt) {
			return;
		}

		const frameElement = findFrameElementForSource(event.source);
		if (!frameElement) {
			return;
		}

		const rect = frameElement.getBoundingClientRect();
		const translatedEvent = {
			...message.payload,
			x: rect.left + message.payload.x,
			y: rect.top + message.payload.y,
		};
		relayTrackedEvent(translatedEvent);
	});

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

	requestTrackingSync();

	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (!message || message.namespace !== MESSAGE_NAMESPACE) {
			return undefined;
		}

		if (message.type === "start") {
			const lifecycleMessage = {
				namespace: FRAME_RELAY_NAMESPACE,
				type: "start-tracking",
				payload: {
					shouldHideNativeCursor: Boolean(message.payload?.shouldHideNativeCursor),
				},
			};
			resetTracking(lifecycleMessage.payload);
			broadcastFrameLifecycle(lifecycleMessage);
			sendResponse({
				ok: true,
				tracking: true,
				eventCount: 0,
				shouldHideNativeCursor: state.shouldHideNativeCursor,
			});
			return false;
		}

		if (message.type === "stop") {
			const lifecycleMessage = {
				namespace: FRAME_RELAY_NAMESPACE,
				type: "stop-tracking",
			};
			stopTrackingState();
			broadcastFrameLifecycle(lifecycleMessage);
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
