import { hasEffect, registerEffect } from "../registry";
import { blurEffectDefinition } from "./blur";
import { zoomEffectDefinition } from "./zoom";

const defaultEffects = [blurEffectDefinition, zoomEffectDefinition];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (hasEffect({ effectType: definition.type })) {
			continue;
		}
		registerEffect({ definition });
	}
}
