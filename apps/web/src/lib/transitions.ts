import { isVisualElement } from "@/lib/timeline/element-utils";
import type { AnimationPropertyPath } from "@/types/animation";
import type { TimelineTrack, VisualElement } from "@/types/timeline";

export type TransitionType = "fade";

export interface TransitionDefinition {
	type: TransitionType;
	name: string;
	description: string;
}

export interface TransitionKeyframeInput {
	trackId: string;
	elementId: string;
	propertyPath: AnimationPropertyPath;
	time: number;
	value: number;
}

interface TransitionSelectionRef {
	trackId: string;
	elementId: string;
}

interface ResolvedTransitionElement {
	trackId: string;
	track: TimelineTrack;
	element: VisualElement;
}

export interface TransitionCandidate {
	isValid: boolean;
	reason: string;
	appliedDurationSeconds: number | null;
	elements: [ResolvedTransitionElement, ResolvedTransitionElement] | null;
}

export interface TransitionApplicationResult {
	ok: boolean;
	message: string;
	appliedDurationSeconds: number | null;
	keyframes: TransitionKeyframeInput[];
	elements: [ResolvedTransitionElement, ResolvedTransitionElement] | null;
}

const TRANSITION_MIN_DURATION_SECONDS = 0.05;
const ADJACENT_GAP_EPSILON_SECONDS = 1 / 240;

export const TRANSITION_DEFINITIONS: TransitionDefinition[] = [
	{
		type: "fade",
		name: "Fade",
		description:
			"Fade out the first clip and fade in the next clip at the cut.",
	},
];

function formatDurationSeconds(value: number): string {
	return `${Number(value.toFixed(2))}s`;
}

function resolveSelectedVisualElements({
	tracks,
	selectedElements,
}: {
	tracks: TimelineTrack[];
	selectedElements: TransitionSelectionRef[];
}): {
	ok: boolean;
	message: string;
	elements: [ResolvedTransitionElement, ResolvedTransitionElement] | null;
} {
	if (selectedElements.length !== 2) {
		return {
			ok: false,
			message: "Select exactly 2 visual clips.",
			elements: null,
		};
	}

	const resolvedElements = selectedElements
		.map(({ trackId, elementId }) => {
			const track = tracks.find(
				(timelineTrack) => timelineTrack.id === trackId,
			);
			const element = track?.elements.find(
				(timelineElement) => timelineElement.id === elementId,
			);

			if (!track || !element || !isVisualElement(element)) {
				return null;
			}

			return {
				trackId,
				track,
				element,
			} satisfies ResolvedTransitionElement;
		})
		.filter(
			(element): element is ResolvedTransitionElement => element !== null,
		);

	if (resolvedElements.length !== 2) {
		return {
			ok: false,
			message: "Transitions are currently available only for visual clips.",
			elements: null,
		};
	}

	const sortedElements = [...resolvedElements].sort((left, right) => {
		if (left.trackId !== right.trackId) {
			return left.trackId.localeCompare(right.trackId);
		}
		return left.element.startTime - right.element.startTime;
	}) as [ResolvedTransitionElement, ResolvedTransitionElement];

	if (sortedElements[0].trackId !== sortedElements[1].trackId) {
		return {
			ok: false,
			message: "Select 2 clips on the same track.",
			elements: null,
		};
	}

	return {
		ok: true,
		message: "Selection ready.",
		elements: sortedElements,
	};
}

export function getTransitionCandidate({
	tracks,
	selectedElements,
	requestedDurationSeconds,
}: {
	tracks: TimelineTrack[];
	selectedElements: TransitionSelectionRef[];
	requestedDurationSeconds: number;
}): TransitionCandidate {
	const selectionResult = resolveSelectedVisualElements({
		tracks,
		selectedElements,
	});

	if (!selectionResult.ok || !selectionResult.elements) {
		return {
			isValid: false,
			reason: selectionResult.message,
			appliedDurationSeconds: null,
			elements: null,
		};
	}

	const [firstElement, secondElement] = selectionResult.elements;
	const firstEnd =
		firstElement.element.startTime + firstElement.element.duration;
	const gap = secondElement.element.startTime - firstEnd;

	if (Math.abs(gap) > ADJACENT_GAP_EPSILON_SECONDS) {
		return {
			isValid: false,
			reason: "The selected clips must touch at the cut.",
			appliedDurationSeconds: null,
			elements: selectionResult.elements,
		};
	}

	const maxDuration = Math.min(
		firstElement.element.duration,
		secondElement.element.duration,
	);

	if (maxDuration < TRANSITION_MIN_DURATION_SECONDS) {
		return {
			isValid: false,
			reason: "The selected clips are too short for a transition.",
			appliedDurationSeconds: null,
			elements: selectionResult.elements,
		};
	}

	const appliedDurationSeconds = Math.min(
		Math.max(requestedDurationSeconds, TRANSITION_MIN_DURATION_SECONDS),
		maxDuration,
	);

	if (appliedDurationSeconds < TRANSITION_MIN_DURATION_SECONDS) {
		return {
			isValid: false,
			reason: "Transition duration is too short.",
			appliedDurationSeconds: null,
			elements: selectionResult.elements,
		};
	}

	const adjustedReason =
		appliedDurationSeconds < requestedDurationSeconds
			? `Duration adjusted to ${formatDurationSeconds(appliedDurationSeconds)} to fit the selected clips.`
			: `Ready to apply a ${formatDurationSeconds(appliedDurationSeconds)} transition.`;

	return {
		isValid: true,
		reason: adjustedReason,
		appliedDurationSeconds,
		elements: selectionResult.elements,
	};
}

export function buildTransitionApplication({
	tracks,
	selectedElements,
	transitionType,
	requestedDurationSeconds,
}: {
	tracks: TimelineTrack[];
	selectedElements: TransitionSelectionRef[];
	transitionType: TransitionType;
	requestedDurationSeconds: number;
}): TransitionApplicationResult {
	const candidate = getTransitionCandidate({
		tracks,
		selectedElements,
		requestedDurationSeconds,
	});

	if (
		!candidate.isValid ||
		!candidate.elements ||
		candidate.appliedDurationSeconds === null
	) {
		return {
			ok: false,
			message: candidate.reason,
			appliedDurationSeconds: null,
			keyframes: [],
			elements: candidate.elements,
		};
	}

	if (transitionType !== "fade") {
		return {
			ok: false,
			message: "Unsupported transition type.",
			appliedDurationSeconds: null,
			keyframes: [],
			elements: candidate.elements,
		};
	}

	const [firstElement, secondElement] = candidate.elements;
	const duration = candidate.appliedDurationSeconds;
	const firstOpacity = firstElement.element.opacity;
	const secondOpacity = secondElement.element.opacity;

	return {
		ok: true,
		message: `Applied ${formatDurationSeconds(duration)} fade transition.`,
		appliedDurationSeconds: duration,
		elements: candidate.elements,
		keyframes: [
			{
				trackId: firstElement.trackId,
				elementId: firstElement.element.id,
				propertyPath: "opacity",
				time: Math.max(firstElement.element.duration - duration, 0),
				value: firstOpacity,
			},
			{
				trackId: firstElement.trackId,
				elementId: firstElement.element.id,
				propertyPath: "opacity",
				time: firstElement.element.duration,
				value: 0,
			},
			{
				trackId: secondElement.trackId,
				elementId: secondElement.element.id,
				propertyPath: "opacity",
				time: 0,
				value: 0,
			},
			{
				trackId: secondElement.trackId,
				elementId: secondElement.element.id,
				propertyPath: "opacity",
				time: duration,
				value: secondOpacity,
			},
		],
	};
}
