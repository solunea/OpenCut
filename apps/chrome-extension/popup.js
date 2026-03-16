const MESSAGE_NAMESPACE = "opencut-cursor";

const elements = {
	start: document.getElementById("start"),
	stop: document.getElementById("stop"),
	export: document.getElementById("export"),
	status: document.getElementById("status"),
};

function setStatus(message, isError = false) {
	elements.status.textContent = message;
	elements.status.dataset.error = String(isError);
}

async function getActiveTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.id) {
		throw new Error("No active tab found");
	}
	return tab;
}

async function sendMessage(type) {
	const tab = await getActiveTab();
	return await chrome.tabs.sendMessage(tab.id, {
		namespace: MESSAGE_NAMESPACE,
		type,
	});
}

function buildFilename(title) {
	const safeTitle = (title || "tracking")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${safeTitle || "tracking"}-${timestamp}.opencut-cursor.json`;
}

async function refreshStatus() {
	try {
		const response = await sendMessage("status");
		if (!response?.ok) {
			throw new Error(response?.error || "Tracking status is unavailable");
		}

		elements.start.disabled = response.tracking;
		elements.stop.disabled = !response.tracking;
		elements.export.disabled = Boolean(response.tracking);

		setStatus(
			response.tracking
				? `Tracking in progress. ${response.eventCount} events recorded.`
				: `${response.eventCount} events ready to export.`,
		);
	} catch (error) {
		elements.start.disabled = false;
		elements.stop.disabled = true;
		elements.export.disabled = true;
		setStatus(
			error instanceof Error
				? error.message
				: "This page cannot be tracked from the extension.",
			true,
		);
	}
}

async function startTracking() {
	try {
		await sendMessage("start");
		setStatus("Tracking started on the current tab.");
		await refreshStatus();
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "Failed to start tracking.",
			true,
		);
	}
}

async function stopTracking() {
	try {
		await sendMessage("stop");
		setStatus("Tracking stopped. You can export the JSON file now.");
		await refreshStatus();
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "Failed to stop tracking.",
			true,
		);
	}
}

async function exportTracking() {
	try {
		const response = await sendMessage("export");
		if (!response?.ok || !response.payload) {
			throw new Error(response?.error || "No tracking data is available");
		}

		const blob = new Blob([JSON.stringify(response.payload, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		await chrome.downloads.download({
			url,
			filename: buildFilename(response.payload.page?.title),
			saveAs: true,
		});
		setTimeout(() => URL.revokeObjectURL(url), 5000);
		setStatus(
			`${response.payload.cursorTracking?.samples?.length || 0} cursor samples exported.`,
		);
	} catch (error) {
		setStatus(
			error instanceof Error ? error.message : "Failed to export tracking.",
			true,
		);
	}
}

elements.start.addEventListener("click", () => {
	void startTracking();
});

elements.stop.addEventListener("click", () => {
	void stopTracking();
});

elements.export.addEventListener("click", () => {
	void exportTracking();
});

void refreshStatus();
