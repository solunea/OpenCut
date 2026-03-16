import { hasEffect, registerEffect } from "../registry";
import { blurEffectDefinition } from "./blur";
import { customCursorEffectDefinition } from "./custom-cursor";
import { zoomEffectDefinition } from "./zoom";

const defaultEffects = [blurEffectDefinition, zoomEffectDefinition, customCursorEffectDefinition];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (hasEffect({ effectType: definition.type })) {
			continue;
		}
		registerEffect({ definition });
	}
}
