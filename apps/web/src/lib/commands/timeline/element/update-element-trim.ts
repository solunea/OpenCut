import { Command } from "@/lib/commands/base-command";
import type { TimelineTrack } from "@/types/timeline";
import { EditorCore } from "@/core";
import { clampAnimationsToDuration } from "@/lib/animation";
import { rippleShiftElements } from "@/lib/timeline";

export class UpdateElementTrimCommand extends Command {
	private savedState: TimelineTrack[] | null = null;
	private readonly elementId: string;
	private readonly trimStart: number;
	private readonly trimEnd: number;
	private readonly freezeFrameStart: number | undefined;
	private readonly freezeFrameEnd: number | undefined;
	private readonly startTime: number | undefined;
	private readonly duration: number | undefined;
	private readonly rippleEnabled: boolean;

	constructor({
		elementId,
		trimStart,
		trimEnd,
		freezeFrameStart,
		freezeFrameEnd,
		startTime,
		duration,
		rippleEnabled = false,
	}: {
		elementId: string;
		trimStart: number;
		trimEnd: number;
		freezeFrameStart?: number;
		freezeFrameEnd?: number;
		startTime?: number;
		duration?: number;
		rippleEnabled?: boolean;
	}) {
		super();
		this.elementId = elementId;
		this.trimStart = trimStart;
		this.trimEnd = trimEnd;
		this.freezeFrameStart = freezeFrameStart;
		this.freezeFrameEnd = freezeFrameEnd;
		this.startTime = startTime;
		this.duration = duration;
		this.rippleEnabled = rippleEnabled;
	}

	execute(): void {
		const editor = EditorCore.getInstance();
		this.savedState = editor.timeline.getTracks();

		const updatedTracks = this.savedState.map((track) => {
			const targetElement = track.elements.find(
				(element) => element.id === this.elementId,
			);
			if (!targetElement) return track;

			const nextDuration = this.duration ?? targetElement.duration;
			const nextStartTime = this.startTime ?? targetElement.startTime;

			const oldEndTime = targetElement.startTime + targetElement.duration;
			const newEndTime = nextStartTime + nextDuration;
			const shiftAmount = oldEndTime - newEndTime;

			const updatedElement = {
				...targetElement,
				trimStart: this.trimStart,
				trimEnd: this.trimEnd,
				...(targetElement.type === "video"
					? {
							freezeFrameStart:
								this.freezeFrameStart ?? targetElement.freezeFrameStart ?? 0,
							freezeFrameEnd:
								this.freezeFrameEnd ?? targetElement.freezeFrameEnd ?? 0,
						}
					: {}),
				startTime: nextStartTime,
				duration: nextDuration,
				animations: clampAnimationsToDuration({
					animations: targetElement.animations,
					duration: nextDuration,
				}),
			};

			if (this.rippleEnabled && Math.abs(shiftAmount) > 0) {
				const shiftedOthers = rippleShiftElements({
					elements: track.elements.filter((element) => element.id !== this.elementId),
					afterTime: oldEndTime,
					shiftAmount,
				});
				return {
					...track,
					elements: track.elements.map((element) =>
						element.id === this.elementId
							? updatedElement
							: (shiftedOthers.find((shifted) => shifted.id === element.id) ?? element)
					),
				} as typeof track;
			}

			return {
				...track,
				elements: track.elements.map((element) =>
					element.id === this.elementId ? updatedElement : element
				),
			} as typeof track;
		});

		editor.timeline.updateTracks(updatedTracks);
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
