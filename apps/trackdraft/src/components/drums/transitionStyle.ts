import { useMemo } from "react";
import type { DrumTransitionModel } from "../../types/blueprint";
import { usePalette, type Palette } from "../../theme/palette";

/** Same four-colour, four-glyph vocabulary settled on during the concept
 *  exploration for this view — kept here as the single place both the
 *  timeline glyph and the dock's picker read colours/labels from.
 *
 *  Each transition borrows the colour of the section it prepares: build up =
 *  chorus amber, break down = bridge blue, cut = solo red, drop out = grey. */
const TRANSITION_HUE: Record<DrumTransitionModel, number | null> = {
  buildUp: 0,
  breakDown: 3,
  cut: 4,
  dropOut: null,
};

export function transitionColors(P: Palette): Record<DrumTransitionModel, string> {
  const out = {} as Record<DrumTransitionModel, string>;
  for (const model of Object.keys(TRANSITION_HUE) as DrumTransitionModel[]) {
    const hue = TRANSITION_HUE[model];
    out[model] = hue === null ? P.hues[6].rim : P.hues[hue].rim;
  }
  return out;
}

export function useTransitionColors(): Record<DrumTransitionModel, string> {
  const P = usePalette();
  return useMemo(() => transitionColors(P), [P]);
}

export const TRANSITION_LABEL: Record<DrumTransitionModel, string> = {
  buildUp: "Build up",
  breakDown: "Break down",
  cut: "Cut",
  dropOut: "Drop out",
};

export const TRANSITION_MODELS: DrumTransitionModel[] = ["buildUp", "breakDown", "cut", "dropOut"];
