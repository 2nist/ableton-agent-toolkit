export * from "./types.js";
export * from "./limbs.js";
export * from "./kit.js";
export * from "./catalog.js";
export * from "./take.js";
export * from "./features.js";
export * from "./segment.js";
export * from "./ableton.js";
export * from "./library-index.js";
export * from "./presets.js";
export * from "./select.js";
export * from "./resolve.js";
export * from "./presetData.js";
export * from "./synthesize.js";
export * from "./infer.js";
export * from "./vary.js";
export * from "./groove.js";
export * from "./handoffs.js";
export * from "./meter.js";
export * from "./chordCycle.js";
export * from "./transitions.js";
export * from "./grooves.js";
export * from "./section.js";
export * from "./blocks.js";
export * from "./bass.js";
export * from "./melody.js";
export * from "./style.js";
export * from "./match.js";

// Drum import (grid → Drum Block[]). Explicit names only: the module's
// structural copies of DrumBlock / DrumLaneId / DrumBlockNote / KitVoice /
// DrumPattern / VelocityPreset would ambiguously collide with the real
// exports above under `export *`.
export {
  ALL_LANES,
  LANE_PRIMARY_VOICE,
  gridToBlocks,
  transitionVector,
  fitEuclid,
  libraryOnsets,
  stepsToString,
  nearestVelocityPreset,
  toSectionPatch,
} from "./drumImport/index.js";
export type {
  DrumGrid,
  GridBar,
  StepVelocities,
  SectionInput,
  ImportOptions,
  ImportedSection,
  BarKind,
  BarReport,
  Transition,
  TransitionGesture,
  SectionDrumPatch,
  EuclidFit,
  EuclidParams,
  OnsetFn,
} from "./drumImport/index.js";
