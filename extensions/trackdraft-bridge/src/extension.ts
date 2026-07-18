import * as fs from "node:fs";
import * as path from "node:path";
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
import { cuePointNamesFor, planCuePoints, type BlueprintSong } from "./blueprint.js";
import { buildPickerHtml } from "./picker.js";
import { buildViewerHtml } from "./viewer.js";

const APPLY_COMMAND_ID = "trackdraftBridge.applySongBlueprint";
const VIEW_COMMAND_ID = "trackdraftBridge.viewSongBlueprint";

// Extensions run under a restricted filesystem permission model and may
// only read/write context.environment.storageDirectory/tempDirectory —
// reading arbitrary paths (e.g. apps/trackdraft/scripts/output directly)
// is unsupported and crashes the extension host outside dev mode. Blueprint
// JSON files need to be synced into this directory first — see
// scripts/sync-blueprints.sh.
function blueprintDir(storageDirectory: string | undefined): string | undefined {
  return storageDirectory ? path.join(storageDirectory, "blueprints") : undefined;
}

function loadBlueprints(storageDirectory: string | undefined): BlueprintSong[] {
  const dir = blueprintDir(storageDirectory);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".trackdraft.json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as BlueprintSong)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.ui.registerContextMenuAction("MidiTrack", "Apply Song Blueprint", APPLY_COMMAND_ID);
  context.ui.registerContextMenuAction("AudioTrack", "Apply Song Blueprint", APPLY_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "View Song Blueprint", VIEW_COMMAND_ID);
  context.ui.registerContextMenuAction("AudioTrack", "View Song Blueprint", VIEW_COMMAND_ID);

  // A thrown/rejected command handler kills the whole extension host
  // process (observed directly: one bad fs call took both registered
  // commands out until Live relaunched it) — catch and log instead of
  // letting that happen again.
  const guard = (handler: () => Promise<void>) => async () => {
    try {
      await handler();
    } catch (error) {
      console.error("[trackdraft-bridge]", error);
    }
  };

  context.commands.registerCommand(
    VIEW_COMMAND_ID,
    guard(async () => {
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const dataUrl = `data:text/html,${encodeURIComponent(buildViewerHtml(blueprints))}`;
      await context.ui.showModalDialog(dataUrl, 640, 560);
    }),
  );

  context.commands.registerCommand(
    APPLY_COMMAND_ID,
    guard(async () => {
      const song = context.application.song;
      if (!song) return;

      const blueprints = loadBlueprints(context.environment.storageDirectory);
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
      // object can't be created and have its properties modified in the
      // same transaction block.
      const cuePoints = await context.withinTransaction(() => {
        return Promise.all(plan.map((entry) => song.createCuePoint(entry.beat)));
      });

      await context.withinTransaction(() => {
        cuePoints.forEach((cuePoint, i) => {
          cuePoint.name = plan[i].name;
        });
        song.tempo = blueprint.bpm;
      });
    }),
  );
}
