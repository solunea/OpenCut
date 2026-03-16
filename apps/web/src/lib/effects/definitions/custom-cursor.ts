import type { EffectDefinition } from "@/types/effects";

export const customCursorEffectDefinition: EffectDefinition = {
	type: "custom-cursor",
	name: "Custom Cursor",
	keywords: ["cursor", "mouse", "pointer", "click", "screen recording"],
	params: [
		{
			key: "size",
			label: "Size",
			type: "number",
			default: 28,
			min: 10,
			max: 96,
			step: 1,
		},
		{
			key: "opacity",
			label: "Opacity",
			type: "number",
			default: 100,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "color",
			label: "Color",
			type: "color",
			default: "#ffffff",
		},
		{
			key: "accentColor",
			label: "Accent",
			type: "color",
			default: "#3b82f6",
		},
		{
			key: "shadowOpacity",
			label: "Shadow",
			type: "number",
			default: 42,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "trackingSmoothness",
			label: "Tracking",
			type: "number",
			default: 55,
			min: 0,
			max: 100,
			step: 1,
		},
		{
			key: "clickPulse",
			label: "Click Pulse",
			type: "boolean",
			default: true,
		},
	],
	renderer: {
		type: "custom",
	},
};
