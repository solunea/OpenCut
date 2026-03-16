const MESSAGE_NAMESPACE = "opencut-cursor";
const sessions = new Map();

function buildErrorMessage(error, fallback) {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return fallback;
}

function isTrackableUrl(url) {
	return (
		typeof url === "string" &&
		!url.startsWith("chrome://") &&
		!url.startsWith("chrome-extension://") &&
		!url.startsWith("devtools://") &&
		!url.startsWith("edge://") &&
		!url.startsWith("about:")
	);
}

async function getTrackableTabs({ controllerTabId, controllerWindowId }) {
	const tabs = await chrome.tabs.query({});
	return tabs
		.filter(
			(tab) =>
				typeof tab.id === "number" &&
				tab.id !== controllerTabId &&
				isTrackableUrl(tab.url),
		)
		.sort((left, right) => {
			const leftSameWindow = left.windowId === controllerWindowId ? 1 : 0;
			const rightSameWindow = right.windowId === controllerWindowId ? 1 : 0;
			if (leftSameWindow !== rightSameWindow) {
				return rightSameWindow - leftSameWindow;
			}
			const leftActive = left.active ? 1 : 0;
			const rightActive = right.active ? 1 : 0;
			return rightActive - leftActive;
		});
}

async function injectTrackerIntoTab({ tabId }) {
	try {
		await chrome.scripting.executeScript({
			target: { tabId, allFrames: true },
			files: ["content.js"],
		});
		return true;
	} catch {
		return false;
	}
}

async function sendTabMessage({ tabId, type, payload, allowInject = false }) {
	try {
		return await chrome.tabs.sendMessage(tabId, {
			namespace: MESSAGE_NAMESPACE,
			type,
			payload,
		});
	} catch {
		if (!allowInject) {
			return null;
		}
		const injected = await injectTrackerIntoTab({ tabId });
		if (!injected) {
			return null;
		}
		try {
			return await chrome.tabs.sendMessage(tabId, {
				namespace: MESSAGE_NAMESPACE,
				type,
				payload,
			});
		} catch {
			return null;
		}
	}
}

function getPayloadScore(payload) {
	const sampleCount = Array.isArray(payload?.cursorTracking?.samples)
		? payload.cursorTracking.samples.length
		: 0;
	const eventCount = Array.isArray(payload?.events) ? payload.events.length : 0;
	const duration =
		typeof payload?.duration === "number" && Number.isFinite(payload.duration)
			? payload.duration
			: 0;
	return sampleCount * 100000 + eventCount * 10 + duration;
}

async function resolveSessionTabs({ controllerTabId, controllerWindowId }) {
	const session = sessions.get(controllerTabId);
	if (session?.startedTabIds?.length > 0) {
		const tabs = await Promise.all(
			session.startedTabIds.map(async (tabId) => await chrome.tabs.get(tabId).catch(() => null)),
		);
		const aliveTabs = tabs.filter((tab) => tab && typeof tab.id === "number");
		if (aliveTabs.length > 0) {
			return aliveTabs;
		}
	}
	return await getTrackableTabs({ controllerTabId, controllerWindowId });
}

async function startSession({
	controllerTabId,
	controllerWindowId,
	shouldHideNativeCursor = false,
}) {
	const tabs = await getTrackableTabs({ controllerTabId, controllerWindowId });
	const startedTabIds = [];

	for (const tab of tabs) {
		const response = await sendTabMessage({
			tabId: tab.id,
			type: "start",
			payload: { shouldHideNativeCursor },
			allowInject: true,
		});
		if (response?.ok) {
			startedTabIds.push(tab.id);
		}
	}

	if (startedTabIds.length === 0) {
		throw new Error(
			tabs.length === 0
				? "OpenCut Cursor Tracker found no trackable browser tab. Open the tab you want to capture, then try again."
				: "OpenCut Cursor Tracker could not start on any browser tab. Reload the target tab after reloading the extension, then try again.",
		);
	}

	sessions.set(controllerTabId, {
		controllerWindowId,
		startedTabIds,
		shouldHideNativeCursor,
	});

	return { startedCount: startedTabIds.length, candidateCount: tabs.length };
}

async function stopSession({ controllerTabId, controllerWindowId }) {
	const session = sessions.get(controllerTabId);
	if (!session?.startedTabIds?.length) {
		return { stoppedCount: 0 };
	}

	const tabs = await resolveSessionTabs({ controllerTabId, controllerWindowId });
	let stoppedCount = 0;

	for (const tab of tabs) {
		const response = await sendTabMessage({ tabId: tab.id, type: "stop" });
		if (response?.ok) {
			stoppedCount += 1;
		}
	}

	sessions.delete(controllerTabId);
	return { stoppedCount };
}

async function stopAndExportSession({ controllerTabId, controllerWindowId }) {
	const tabs = await resolveSessionTabs({ controllerTabId, controllerWindowId });
	const payloads = [];

	for (const tab of tabs) {
		await sendTabMessage({ tabId: tab.id, type: "stop" });
		const response = await sendTabMessage({ tabId: tab.id, type: "export" });
		if (response?.ok && response.payload) {
			payloads.push(response.payload);
		}
	}

	sessions.delete(controllerTabId);

	if (payloads.length === 0) {
		throw new Error("No cursor tracking data was exported from the extension");
	}

	payloads.sort((left, right) => getPayloadScore(right) - getPayloadScore(left));
	const payload = payloads[0];
	const sampleCount = Array.isArray(payload?.cursorTracking?.samples)
		? payload.cursorTracking.samples.length
		: 0;

	if (sampleCount === 0) {
		throw new Error("The extension recorded no usable cursor samples for the captured tab");
	}

	return payload;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (!message || message.namespace !== MESSAGE_NAMESPACE) {
		return undefined;
	}

	if (
		message.type !== "session-start" &&
		message.type !== "session-stop-export" &&
		message.type !== "session-cancel"
	) {
		return undefined;
	}

	const handleMessage = async () => {
		const controllerTabId = sender.tab?.id;
		const controllerWindowId = sender.tab?.windowId;
		if (typeof controllerTabId !== "number") {
			throw new Error("OpenCut Cursor Tracker controller tab is unavailable");
		}

		if (message.type === "session-start") {
			return await startSession({
				controllerTabId,
				controllerWindowId,
				shouldHideNativeCursor: Boolean(message.payload?.shouldHideNativeCursor),
			});
		}
		if (message.type === "session-stop-export") {
			return await stopAndExportSession({ controllerTabId, controllerWindowId });
		}
		return await stopSession({ controllerTabId, controllerWindowId });
	};

	void handleMessage()
		.then((payload) => {
			sendResponse({ ok: true, payload });
		})
		.catch((error) => {
			sendResponse({
				ok: false,
				error: buildErrorMessage(
					error,
					"OpenCut Cursor Tracker could not complete the session request",
				),
			});
		});

	return true;
});
