import type { EffectDefinition } from "@/types/effects";
import zoomFragmentShader from "./zoom.frag.glsl";

function resolveNumber({
	value,
	fallback,
}: {
	value: number | string | boolean | undefined;
	fallback: number;
}): number {
	if (typeof value === "number") {
		return value;
	}
	const parsed = Number.parseFloat(String(value));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value: number): number {
	return Math.min(Math.max(value, 0), 1);
}

function easeOutCubic(value: number): number {
	const t = clamp01(value);
	return 1 - (1 - t) * (1 - t) * (1 - t);
}

function easeInCubic(value: number): number {
	const t = clamp01(value);
	return t * t * t;
}

function resolveStrength({
	progress,
	easeInPercent,
	easeOutPercent,
}: {
	progress: number;
	easeInPercent: number;
	easeOutPercent: number;
}): number {
	const normalizedProgress = clamp01(progress);
	const easeIn = clamp01(easeInPercent / 100);
	const easeOut = clamp01(easeOutPercent / 100);
	const easeOutStart = 1 - easeOut;

	if (easeIn > 0 && normalizedProgress < easeIn) {
		return easeOutCubic(normalizedProgress / easeIn);
	}

	if (easeOut > 0 && normalizedProgress > easeOutStart) {
		return easeInCubic((1 - normalizedProgress) / easeOut);
	}

	if (easeIn > easeOutStart) {
		const enter = easeIn > 0 ? easeOutCubic(normalizedProgress / easeIn) : 1;
		const exit =
			easeOut > 0 ? easeInCubic((1 - normalizedProgress) / easeOut) : 1;
		return Math.min(enter, exit);
	}

	return 1;
}

export const zoomEffectDefinition: EffectDefinition = {
	type: "zoom",
	name: "Zoom",
	keywords: ["zoom", "focus", "punch in", "shots"],
	params: [
		{
			key: "zoom",
			label: "Zoom",
			type: "number",
			default: 1.35,
			min: 1,
			max: 4,
			step: 0.01,
		},
		{
			key: "focusX",
			label: "Focus X",
			type: "number",
			default: 50,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "focusY",
			label: "Focus Y",
			type: "number",
			default: 50,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "easeIn",
			label: "Ease In",
			type: "number",
			default: 20,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "easeOut",
			label: "Ease Out",
			type: "number",
			default: 20,
			min: 0,
			max: 100,
			step: 1,
		},
	],
	renderer: {
		type: "webgl",
		passes: [
			{
				fragmentShader: zoomFragmentShader,
				uniforms: ({ effectParams, progress }) => {
					const zoom = Math.max(resolveNumber({ value: effectParams.zoom, fallback: 1.35 }), 1);
					const focusX = clamp01(resolveNumber({ value: effectParams.focusX, fallback: 50 }) / 100);
					const focusY = clamp01(resolveNumber({ value: effectParams.focusY, fallback: 50 }) / 100);
					const easeIn = resolveNumber({ value: effectParams.easeIn, fallback: 20 });
					const easeOut = resolveNumber({ value: effectParams.easeOut, fallback: 20 });
					const strength = resolveStrength({
						progress: progress ?? 1,
						easeInPercent: easeIn,
						easeOutPercent: easeOut,
					});

					return {
						u_focus: [focusX, focusY],
						u_zoom: zoom,
						u_strength: strength,
					};
				},
			},
		],
	},
};
