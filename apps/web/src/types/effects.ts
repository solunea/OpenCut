export interface Effect {
	id: string;
	type: string;
	params: EffectParamValues;
	enabled: boolean;
}

export type EffectParamType = "number" | "boolean" | "select" | "color";

export type EffectParamValues = Record<string, number | string | boolean>;

export interface ZoomTransitionState {
	zoom: number;
	focusX: number;
	focusY: number;
	keepFrameFixed: boolean;
	tiltX: number;
	tiltY: number;
	rotationX: number;
	perspective: number;
}

export interface ZoomEffectTransition {
	previous?: ZoomTransitionState;
	next?: ZoomTransitionState;
}

interface BaseEffectParamDefinition {
	key: string;
	label: string;
}

export interface NumberEffectParamDefinition extends BaseEffectParamDefinition {
	type: "number";
	default: number;
	min: number;
	max: number;
	step: number;
}

interface BooleanEffectParamDefinition extends BaseEffectParamDefinition {
	type: "boolean";
	default: boolean;
}

interface SelectEffectParamDefinition extends BaseEffectParamDefinition {
	type: "select";
	default: string;
	options: Array<{ value: string; label: string }>;
}

interface ColorEffectParamDefinition extends BaseEffectParamDefinition {
	type: "color";
	default: string;
}

export type EffectParamDefinition =
	| NumberEffectParamDefinition
	| BooleanEffectParamDefinition
	| SelectEffectParamDefinition
	| ColorEffectParamDefinition;

export interface WebGLEffectPass {
	fragmentShader: string;
	uniforms(params: {
		effectParams: EffectParamValues;
		width: number;
		height: number;
		localTime?: number;
		duration?: number;
		progress?: number;
		zoomTransition?: ZoomEffectTransition;
	}): Record<string, number | number[]>;
}

export interface WebGLEffectRenderer {
	type: "webgl";
	passes: WebGLEffectPass[];
}

export interface CustomEffectRenderer {
	type: "custom";
}

export type EffectRenderer = WebGLEffectRenderer | CustomEffectRenderer;

export interface EffectDefinition {
	type: string;
	name: string;
	keywords: string[];
	params: EffectParamDefinition[];
	renderer: EffectRenderer;
}
