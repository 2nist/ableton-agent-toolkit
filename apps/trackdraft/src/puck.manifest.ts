/**
 * The components the Puck sandbox and Design Lab may compose.
 *
 * This is deliberately an allow-list, not a directory scan. The scanner used
 * to register every `.tsx` under `src/components`, which meant a component
 * nothing imported still had one "consumer" (the registry), still shipped in
 * the Design Lab chunk, and still passed a manual dead-code check. Six
 * components — ~1,100 lines — sat there for exactly that reason.
 *
 * Adding a component here is the deliberate act of making it a design
 * surface. Removing one is a one-line change with no side effects.
 *
 * Three entries (`Select`, `TextField`, `Modal`) are T1 primitives rather than
 * product surfaces: they live in the sandbox because it is where new controls
 * get prototyped against real tokens, and `Modal` is used by `ConfirmHost`.
 * Everything else here has a real consumer in the app.
 */
export const PUCK_COMPONENTS = [
  "DirSetupModal",
  "EffectsLane",
  "FloorBand",
  "FloorScene",
  "HarmonyScene",
  "HexReadout",
  "HoneycombWheel",
  "Knob",
  "LaneGutter",
  "LyricDocumentView",
  "LyricsEditor",
  "MapPicker",
  "MarkerRail",
  "MelodyNoteEditor",
  "MelodyStaff",
  "MetricalTable",
  "Modal",
  "ModeInferenceCard",
  "PresetPicker",
  "ProgressionEditor",
  "ProgressionFloor",
  "RhymeSuggestions",
  "SectionCard",
  "Select",
  "SelectionEditorModal",
  "SongTable",
  "TextField",
] as const;