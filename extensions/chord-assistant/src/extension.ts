import {
  initialize,
  DataModelObject,
  MidiTrack,
  TakeLane,
  type ActivationContext,
  type ArrangementSelection,
} from "@ableton-extensions/sdk";
import { buildProgression, DEFAULT_KEY, DEFAULT_PRESET, DEFAULT_OCTAVE } from "./build-progression.js";

const COMMAND_ID = "chordAssistant.insertProgression";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.ui.registerContextMenuAction("MidiTrack.ArrangementSelection", "Insert Chord Progression", COMMAND_ID);

  context.commands.registerCommand(COMMAND_ID, async (...args: unknown[]) => {
    const [arg, presetKeyArg, keyArg, octaveArg] = args;
    const selection = arg as ArrangementSelection;
    const presetKey = typeof presetKeyArg === "string" ? presetKeyArg : DEFAULT_PRESET;
    const key = typeof keyArg === "string" ? keyArg : DEFAULT_KEY;
    const octave = typeof octaveArg === "number" ? octaveArg : DEFAULT_OCTAVE;

    const { notes, totalBeats, name } = buildProgression(presetKey, key, octave);

    const lanes = selection.selected_lanes
      .map((handle) => context.getObjectFromHandle(handle, DataModelObject))
      .filter(
        (obj): obj is MidiTrack<"1.0.0"> | TakeLane<"1.0.0"> =>
          obj instanceof MidiTrack || (obj instanceof TakeLane && obj.parent instanceof MidiTrack),
      );

    if (lanes.length === 0) return;

    // Two sequential transactions, per the SDK's own documented guidance:
    // "you cannot create a track [or clip] and then modify its properties
    // within the same transaction block (since you need the instance
    // first) — you must perform these as sequential transactions."
    const clips = await context.withinTransaction(() => {
      return Promise.all(lanes.map((lane) => lane.createMidiClip(selection.time_selection_start, totalBeats)));
    });

    await context.withinTransaction(() => {
      for (const clip of clips) {
        clip.name = name;
        clip.notes = notes;
      }
    });
  });
}
