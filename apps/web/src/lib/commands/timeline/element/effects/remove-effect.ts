import { Command } from "@/lib/commands/base-command";
import { EditorCore } from "@/core";
import { isVisualElement, updateElementInTracks } from "@/lib/timeline";
import type {
	AnimationChannel,
	ElementAnimations,
	SelectedKeyframeRef,
} from "@/types/animation";
import type { TimelineTrack, VisualElement } from "@/types/timeline";

const EFFECT_PARAM_PATH_PREFIX = "effects.";
const EFFECT_PARAM_PATH_SUFFIX = ".params.";

function removeEffectAnimations({
	animations,
	effectId,
}: {
	animations: ElementAnimations | undefined;
	effectId: string;
}): ElementAnimations | undefined {
	if (!animations) {
		return undefined;
	}

	const effectPathPrefix = `${EFFECT_PARAM_PATH_PREFIX}${effectId}${EFFECT_PARAM_PATH_SUFFIX}`;
	const remainingChannels = Object.entries(animations.channels).filter(
		([propertyPath, channel]) =>
			Boolean(channel) && !propertyPath.startsWith(effectPathPrefix),
	) as Array<[string, AnimationChannel]>;

	if (remainingChannels.length === 0) {
		return undefined;
	}

	return {
		channels: Object.fromEntries(remainingChannels),
	};
}

function isEffectKeyframeRef({
	keyframe,
	trackId,
	elementId,
	effectId,
}: {
	keyframe: SelectedKeyframeRef;
	trackId: string;
	elementId: string;
	effectId: string;
}): boolean {
	const effectPathPrefix = `${EFFECT_PARAM_PATH_PREFIX}${effectId}${EFFECT_PARAM_PATH_SUFFIX}`;
	return (
		keyframe.trackId === trackId &&
		keyframe.elementId === elementId &&
		keyframe.propertyPath.startsWith(effectPathPrefix)
	);
}

function removeEffectFromElement({
	element,
	effectId,
}: {
	element: VisualElement;
	effectId: string;
}): VisualElement {
	const currentEffects = element.effects ?? [];
	const filtered = currentEffects.filter((effect) => effect.id !== effectId);
	return {
		...element,
		effects: filtered,
		animations: removeEffectAnimations({
			animations: element.animations,
			effectId,
		}),
	};
}

export class RemoveClipEffectCommand extends Command {
	private savedState: TimelineTrack[] | null = null;
	private previousSelectedKeyframes: SelectedKeyframeRef[] = [];
	private previousKeyframeAnchor: SelectedKeyframeRef | null = null;
	private readonly trackId: string;
	private readonly elementId: string;
	private readonly effectId: string;

	constructor({
		trackId,
		elementId,
		effectId,
	}: {
		trackId: string;
		elementId: string;
		effectId: string;
	}) {
		super();
		this.trackId = trackId;
		this.elementId = elementId;
		this.effectId = effectId;
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();
		this.previousSelectedKeyframes = editor.selection.getSelectedKeyframes();
		this.previousKeyframeAnchor = editor.selection.getKeyframeSelectionAnchor();

		const updatedTracks = updateElementInTracks({
			tracks: this.savedState,
			trackId: this.trackId,
			elementId: this.elementId,
			elementPredicate: isVisualElement,
			update: (element) => {
				return removeEffectFromElement({
					element: element as VisualElement,
					effectId: this.effectId,
				});
			},
		});

		editor.timeline.updateTracks(updatedTracks);
		const remainingSelectedKeyframes = this.previousSelectedKeyframes.filter(
			(keyframe) =>
				!isEffectKeyframeRef({
					keyframe,
					trackId: this.trackId,
					elementId: this.elementId,
					effectId: this.effectId,
				}),
		);
		const nextAnchor =
			this.previousKeyframeAnchor &&
			!isEffectKeyframeRef({
				keyframe: this.previousKeyframeAnchor,
				trackId: this.trackId,
				elementId: this.elementId,
				effectId: this.effectId,
			})
				? this.previousKeyframeAnchor
				: remainingSelectedKeyframes[remainingSelectedKeyframes.length - 1] ?? null;
		editor.selection.setSelectedKeyframes({
			keyframes: remainingSelectedKeyframes,
			anchorKeyframe: nextAnchor,
		});
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
			editor.selection.setSelectedKeyframes({
				keyframes: this.previousSelectedKeyframes,
				anchorKeyframe: this.previousKeyframeAnchor,
			});
		}
	}
}
