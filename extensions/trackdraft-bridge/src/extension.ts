import * as fs from "node:fs";
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { planCuePoints, type BlueprintSong } from "./blueprint.js";

const COMMAND_ID = "trackdraftBridge.applySongBlueprint";

// TODO: replace with a proper song picker once TrackDraft can export a
// blueprint pointer alongside the .als, instead of a hardcoded path.
const DEFAULT_BLUEPRINT_PATH =
  "/Users/Matthew/ableton-agent-toolkit/apps/trackdraft/scripts/output/03_twin_fish.trackdraft.json";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.ui.registerContextMenuAction("MidiTrack", "Apply Song Blueprint", COMMAND_ID);
  context.ui.registerContextMenuAction("AudioTrack", "Apply Song Blueprint", COMMAND_ID);

  context.commands.registerCommand(COMMAND_ID, async () => {
    const song = context.application.song;
    if (!song) return;

    const blueprint = JSON.parse(fs.readFileSync(DEFAULT_BLUEPRINT_PATH, "utf8")) as BlueprintSong;
    const plan = planCuePoints(blueprint);

    // Two sequential transactions, per the SDK's documented guidance: an
    // object can't be created and have its properties modified in the same
    // transaction block.
    const cuePoints = await context.withinTransaction(() => {
      return Promise.all(plan.map((entry) => song.createCuePoint(entry.beat)));
    });

    await context.withinTransaction(() => {
      cuePoints.forEach((cuePoint, i) => {
        cuePoint.name = plan[i].name;
      });
      song.tempo = blueprint.bpm;
    });
  });
}
