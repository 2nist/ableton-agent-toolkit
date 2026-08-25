import type { DrumTransitionModel } from "../../types/blueprint";

/** Same four-color, four-glyph vocabulary settled on during the concept
 *  exploration for this view — kept here as the single place both the
 *  timeline glyph and the dock's picker read colors/labels from. */
export const TRANSITION_COLOR: Record<DrumTransitionModel, string> = {
  buildUp: "#E8B54A",
  breakDown: "#5B84C4",
  cut: "#D96459",
  dropOut: "#8A8496",
};

export const TRANSITION_LABEL: Record<DrumTransitionModel, string> = {
  buildUp: "Build up",
  breakDown: "Break down",
  cut: "Cut",
  dropOut: "Drop out",
};

export const TRANSITION_MODELS: DrumTransitionModel[] = ["buildUp", "breakDown", "cut", "dropOut"];
