import {
	POPULAR_COLLECTIONS,
	getIconSvgUrl,
	searchIcons,
} from "@/lib/iconify-api";
import { buildStickerId, parseStickerId } from "../sticker-id";
import type {
	StickerItem,
	StickerProvider,
	StickerSearchResult,
} from "../types";

const EMOJI_PROVIDER_ID = "emoji";
const DEFAULT_SEARCH_LIMIT = 100;

const EMOJI_PREFIXES = POPULAR_COLLECTIONS.emoji.map(
	(collection) => collection.prefix,
);

type EmojiCatalogItem = {
	iconName: string;
	terms: string[];
};

const EMOJI_CATALOG: EmojiCatalogItem[] = [
	{ iconName: "noto:grinning-face", terms: ["😀", "grinning face", "grin", "smile", "happy"] },
	{ iconName: "noto:beaming-face-with-smiling-eyes", terms: ["😁", "beaming face", "smile", "happy", "joy"] },
	{ iconName: "noto:face-with-tears-of-joy", terms: ["😂", "tears of joy", "laugh", "lol", "funny"] },
	{ iconName: "noto:rolling-on-the-floor-laughing", terms: ["🤣", "rofl", "laughing", "funny"] },
	{ iconName: "noto:smiling-face-with-heart-eyes", terms: ["😍", "heart eyes", "love", "cute"] },
	{ iconName: "noto:star-struck", terms: ["🤩", "star struck", "wow", "excited"] },
	{ iconName: "noto:thinking-face", terms: ["🤔", "thinking face", "thinking", "hmm"] },
	{ iconName: "noto:face-with-monocle", terms: ["🧐", "monocle", "inspect", "curious"] },
	{ iconName: "noto:loudly-crying-face", terms: ["😭", "crying", "sad", "tears"] },
	{ iconName: "noto:face-screaming-in-fear", terms: ["😱", "scream", "shock", "scared"] },
	{ iconName: "noto:exploding-head", terms: ["🤯", "mind blown", "shock", "brain"] },
	{ iconName: "noto:smiling-face-with-sunglasses", terms: ["😎", "cool", "sunglasses", "swag"] },
	{ iconName: "noto:partying-face", terms: ["🥳", "party", "celebration", "birthday"] },
	{ iconName: "noto:sleeping-face", terms: ["😴", "sleep", "tired", "zzz"] },
	{ iconName: "noto:hot-face", terms: ["🥵", "hot", "heat", "warm"] },
	{ iconName: "noto:cold-face", terms: ["🥶", "cold", "freeze", "winter"] },
	{ iconName: "noto:face-with-symbols-on-mouth", terms: ["🤬", "angry", "mad", "rage"] },
	{ iconName: "noto:red-heart", terms: ["❤️", "heart", "love", "like"] },
	{ iconName: "noto:fire", terms: ["🔥", "fire", "lit", "hot", "trend"] },
	{ iconName: "noto:sparkles", terms: ["✨", "sparkles", "magic", "shine"] },
	{ iconName: "noto:hundred-points", terms: ["💯", "hundred", "100", "score"] },
	{ iconName: "noto:collision", terms: ["💥", "boom", "explosion", "impact"] },
	{ iconName: "noto:speech-balloon", terms: ["💬", "speech", "chat", "comment"] },
	{ iconName: "noto:rocket", terms: ["🚀", "rocket", "launch", "fast", "growth"] },
	{ iconName: "noto:glowing-star", terms: ["🌟", "star", "glow", "favorite"] },
	{ iconName: "noto:party-popper", terms: ["🎉", "party popper", "celebrate", "party"] },
	{ iconName: "noto:wrapped-gift", terms: ["🎁", "gift", "present", "surprise"] },
	{ iconName: "noto:trophy", terms: ["🏆", "trophy", "winner", "award"] },
	{ iconName: "noto:clapping-hands", terms: ["👏", "clap", "applause", "bravo"] },
	{ iconName: "noto:raising-hands", terms: ["🙌", "raising hands", "celebrate", "success"] },
	{ iconName: "noto:folded-hands", terms: ["🙏", "prayer", "thanks", "please"] },
	{ iconName: "noto:thumbs-up", terms: ["👍", "thumbs up", "like", "approve", "ok"] },
	{ iconName: "noto:thumbs-down", terms: ["👎", "thumbs down", "dislike", "reject"] },
	{ iconName: "noto:flexed-biceps", terms: ["💪", "muscle", "strong", "power"] },
	{ iconName: "noto:eyes", terms: ["👀", "eyes", "look", "watch"] },
	{ iconName: "noto:waving-hand", terms: ["👋", "wave", "hello", "hi"] },
	{ iconName: "noto:check-mark-button", terms: ["✅", "check", "done", "success"] },
	{ iconName: "noto:cross-mark", terms: ["❌", "cross", "error", "wrong", "close"] },
	{ iconName: "noto:warning", terms: ["⚠️", "warning", "alert", "danger"] },
	{ iconName: "noto:bulb", terms: ["💡", "idea", "light bulb", "tip"] },
];

function getDisplayNameFromIconName({
	iconName,
}: {
	iconName: string;
}): string {
	const parts = iconName.split(":");
	const rawName = parts[parts.length - 1] ?? iconName;
	return rawName.replaceAll("-", " ").replaceAll("_", " ");
}

function toStickerItem({ iconName }: { iconName: string }): StickerItem {
	return {
		id: buildStickerId({
			providerId: EMOJI_PROVIDER_ID,
			providerValue: iconName,
		}),
		provider: EMOJI_PROVIDER_ID,
		name: getDisplayNameFromIconName({ iconName }),
		previewUrl: getIconSvgUrl(iconName, { width: 64, height: 64 }),
		metadata: { iconName },
	};
}

function normalizeQuery({ query }: { query: string }): string {
	return query.trim().toLowerCase();
}

function getCatalogItemsByQuery({ query }: { query: string }): EmojiCatalogItem[] {
	const normalizedQuery = normalizeQuery({ query });
	if (!normalizedQuery) {
		return [...EMOJI_CATALOG];
	}

	return EMOJI_CATALOG.filter((item) =>
		item.terms.some((term) => term.toLowerCase().includes(normalizedQuery)),
	);
}

function mergeStickerItems({ items }: { items: StickerItem[] }): StickerItem[] {
	const seen = new Set<string>();
	const merged: StickerItem[] = [];

	for (const item of items) {
		if (seen.has(item.id)) {
			continue;
		}
		seen.add(item.id);
		merged.push(item);
	}

	return merged;
}

function computeHasMore({
	total,
	limit,
	start = 0,
}: {
	total: number;
	limit: number;
	start?: number;
}): boolean {
	return start + limit < total;
}

export const emojiProvider: StickerProvider = {
	id: EMOJI_PROVIDER_ID,
	async search({
		query,
		options,
	}: {
		query: string;
		options?: { limit?: number };
	}): Promise<StickerSearchResult> {
		const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT;
		const localItems = getCatalogItemsByQuery({ query }).map(({ iconName }) =>
			toStickerItem({ iconName }),
		);
		const searchResult = await searchIcons(query, limit, EMOJI_PREFIXES);
		const remoteItems = searchResult.icons.map((iconName) =>
			toStickerItem({ iconName }),
		);
		const items = mergeStickerItems({
			items: [...localItems, ...remoteItems],
		}).slice(0, limit);
		return {
			items,
			total: Math.max(searchResult.total, items.length),
			hasMore:
				computeHasMore({
					total: searchResult.total,
					limit: searchResult.limit,
					start: searchResult.start,
				}) || items.length < localItems.length,
		};
	},
	async browse({
		options,
	}: {
		options?: { page?: number; limit?: number };
	}): Promise<StickerSearchResult> {
		const page = Math.max(1, options?.page ?? 1);
		const limit = Math.max(1, options?.limit ?? EMOJI_CATALOG.length);
		const start = (page - 1) * limit;
		const end = start + limit;
		const items = EMOJI_CATALOG.slice(start, end).map(({ iconName }) =>
			toStickerItem({ iconName }),
		);
		return {
			items,
			total: EMOJI_CATALOG.length,
			hasMore: end < EMOJI_CATALOG.length,
		};
	},
	resolveUrl({
		stickerId,
		options,
	}: {
		stickerId: string;
		options?: { width?: number; height?: number };
	}): string {
		const { providerValue } = parseStickerId({ stickerId });
		return getIconSvgUrl(providerValue, {
			width: options?.width,
			height: options?.height,
		});
	},
};
