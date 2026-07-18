import * as fs from "node:fs";
import * as path from "node:path";
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { cuePointNamesFor, planCuePoints, type BlueprintSong } from "./blueprint.js";
import { buildPickerHtml } from "./picker.js";

const COMMAND_ID = "trackdraftBridge.applySongBlueprint";

// TrackDraft's ingestion/export output. Re-exporting a song after editing
// it in TrackDraft and saving over the matching file here is how the
// picker sees the latest version.
const BLUEPRINT_DIR = "/Users/Matthew/ableton-agent-toolkit/apps/trackdraft/scripts/output";

function loadBlueprints(): BlueprintSong[] {
  if (!fs.existsSync(BLUEPRINT_DIR)) return [];
  return fs
    .readdirSync(BLUEPRINT_DIR)
    .filter((file) => file.endsWith(".trackdraft.json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(BLUEPRINT_DIR, file), "utf8")) as BlueprintSong)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.ui.registerContextMenuAction("MidiTrack", "Apply Song Blueprint", COMMAND_ID);
  context.ui.registerContextMenuAction("AudioTrack", "Apply Song Blueprint", COMMAND_ID);

  context.commands.registerCommand(COMMAND_ID, async () => {
    const song = context.application.song;
    if (!song) return;

    const blueprints = loadBlueprints();
    const picker = blueprints.map((b) => ({ id: b.id, title: b.title }));
    const dataUrl = `data:text/html,${encodeURIComponent(buildPickerHtml(picker))}`;
    const picked = await context.ui.showModalDialog(dataUrl, 420, 480);
    if (!picked) return;

    const blueprint = blueprints.find((b) => b.id === picked);
    if (!blueprint) return;

    const plan = planCuePoints(blueprint);
    const namesToReplace = cuePointNamesFor(blueprint);
    const staleCuePoints = song.cuePoints.filter((cuePoint) => namesToReplace.has(cuePoint.name));

    if (staleCuePoints.length > 0) {
      await context.withinTransaction(() => {
        return Promise.all(staleCuePoints.map((cuePoint) => song.deleteCuePoint(cuePoint)));
      });
    }

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
