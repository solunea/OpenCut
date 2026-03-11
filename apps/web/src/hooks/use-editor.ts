import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { EditorCore } from "@/core";

const EDITOR_SUBSCRIPTIONS = [
	"playback",
	"timeline",
	"scenes",
	"project",
	"media",
	"renderer",
	"selection",
] as const;

type EditorSubscriptionKey = (typeof EDITOR_SUBSCRIPTIONS)[number];

interface UseEditorOptions {
	subscribeTo?: EditorSubscriptionKey[];
}

export function useEditor({ subscribeTo }: UseEditorOptions = {}): EditorCore {
	const editor = useMemo(() => EditorCore.getInstance(), []);
	const versionRef = useRef(0);
	const subscriptionSignature =
		subscribeTo === undefined
			? "__all__"
			: subscribeTo.length === 0
				? "__none__"
				: subscribeTo.join(",");
	const normalizedSubscriptions = useMemo(
		() =>
			subscriptionSignature === "__all__"
				? [...EDITOR_SUBSCRIPTIONS]
				: subscriptionSignature === "__none__"
					? []
					: (subscriptionSignature.split(",") as EditorSubscriptionKey[]),
		[subscriptionSignature],
	);

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const handleStoreChange = () => {
				versionRef.current += 1;
				onStoreChange();
			};

			const unsubscribers = normalizedSubscriptions.map((subscriptionKey) =>
				editor[subscriptionKey].subscribe(handleStoreChange),
			);

			return () => {
				for (const unsubscribe of unsubscribers) {
					unsubscribe();
				}
			};
		},
		[editor, normalizedSubscriptions],
	);

	const getSnapshot = useCallback(() => versionRef.current, []);

	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	return editor;
}
