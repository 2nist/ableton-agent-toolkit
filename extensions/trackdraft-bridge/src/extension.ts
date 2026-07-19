import * as fs from "node:fs";
import * as path from "node:path";
import { initialize, MidiTrack, type ActivationContext, type Handle, type NoteDescription } from "@ableton-extensions/sdk";
import { cuePointNamesFor, planCuePoints, sectionSpans, type BlueprintSong } from "./blueprint.js";
import { planChordClips } from "./chordClips.js";
import { planDrumClips } from "./drumClips.js";
import { planBassLine } from "./bassLine.js";
import { buildPickerHtml } from "./picker.js";
import { buildViewerHtml } from "./viewer.js";
import { buildProbeHtml, CLOSE_SCRIPT, findDrumRack, probeDrumRack } from "./drumRackProbe.js";

const APPLY_COMMAND_ID = "trackdraftBridge.applySongBlueprint";
const VIEW_COMMAND_ID = "trackdraftBridge.viewSongBlueprint";
const GENERATE_CHORDS_COMMAND_ID = "trackdraftBridge.generateChordClips";
const GENERATE_DRUMS_COMMAND_ID = "trackdraftBridge.generateDrumClips";
const GENERATE_BASS_COMMAND_ID = "trackdraftBridge.generateBassLine";
const GENERATE_BLANK_COMMAND_ID = "trackdraftBridge.generateBlankClips";
const PROBE_DRUM_RACK_COMMAND_ID = "trackdraftBridge.probeDrumRack";

interface ClipPlanEntry {
  name: string;
  startBeat: number;
  durationBeats: number;
  notes: NoteDescription[];
}

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
  context.ui.registerContextMenuAction("MidiTrack", "Generate Chord Clips", GENERATE_CHORDS_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Drum Clips", GENERATE_DRUMS_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Bass Line", GENERATE_BASS_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Generate Blank Section Clips", GENERATE_BLANK_COMMAND_ID);
  context.ui.registerContextMenuAction("MidiTrack", "Probe Drum Rack", PROBE_DRUM_RACK_COMMAND_ID);

  // A thrown/rejected command handler kills the whole extension host
  // process (observed directly: one bad fs call took both registered
  // commands out until Live relaunched it) — catch and log instead of
  // letting that happen again.
  const guard =
    (handler: (...args: unknown[]) => Promise<void>) =>
    async (...args: unknown[]) => {
      try {
        await handler(...args);
      } catch (error) {
        console.error("[trackdraft-bridge]", error);
      }
    };

  // Shared by every command that needs a song: show the picker, return the
  // chosen blueprint or undefined if the dialog was cancelled/closed.
  async function pickBlueprint(blueprints: BlueprintSong[]): Promise<BlueprintSong | undefined> {
    const picker = blueprints.map((b) => ({ id: b.id, title: b.title }));
    const dataUrl = `data:text/html,${encodeURIComponent(buildPickerHtml(picker))}`;
    const picked = await context.ui.showModalDialog(dataUrl, 420, 480);
    if (!picked) return undefined;
    return blueprints.find((b) => b.id === picked);
  }

  // Shared by every "one clip per section" command (chords/drums/bass/
  // blank): clears the track's span first so re-running replaces the
  // previous result instead of piling up overlapping clips — clips don't
  // carry a stable identity to dedupe by name the way CuePoints do, so
  // the whole range is cleared instead.
  async function applyClipPlan(track: MidiTrack<"1.0.0">, plan: ClipPlanEntry[]) {
    if (plan.length === 0) return;
    const last = plan[plan.length - 1];
    const totalBeats = last.startBeat + last.durationBeats;

    await context.withinTransaction(() => track.clearClipsInRange(0, totalBeats));

    // Two sequential transactions, per the SDK's documented guidance: an
    // object can't be created and have its properties modified in the
    // same transaction block.
    const clips = await context.withinTransaction(() => {
      return Promise.all(plan.map((entry) => track.createMidiClip(entry.startBeat, entry.durationBeats)));
    });

    await context.withinTransaction(() => {
      clips.forEach((clip, i) => {
        clip.name = plan[i].name;
        clip.notes = plan[i].notes;
      });
    });
  }

  function resolveMidiTrack(args: unknown[]): MidiTrack<"1.0.0"> | undefined {
    const [trackHandle] = args;
    return context.getObjectFromHandle(trackHandle as Handle, MidiTrack) ?? undefined;
  }

  // Reports a loaded Drum Rack's real pad layout and velocity parameters.
  // Read-only by design: it answers what the rack is, and changes nothing.
  context.commands.registerCommand(
    PROBE_DRUM_RACK_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;

      const rack = findDrumRack(track);
      if (!rack) {
        const message = `<!doctype html><meta charset="utf-8">
<body style="font:13px system-ui;background:#1a1a1a;color:#ddd;padding:20px;margin:0">
<p>No Drum Rack on track "${track.name}" — checked its full device chain, including inside other racks.</p>
<button id="closeBtn" style="margin-top:10px;background:transparent;color:#999;border:1px solid #444;border-radius:4px;padding:5px 12px;cursor:pointer;font:inherit">Close</button>
<script>${CLOSE_SCRIPT}</script>
</body>`;
        await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(message)}`, 460, 180);
        return;
      }

      const report = await probeDrumRack(track, rack);
      console.log("[trackdraft-bridge] drum rack probe", JSON.stringify(report, null, 2));
      const dataUrl = `data:text/html,${encodeURIComponent(buildProbeHtml(report))}`;
      await context.ui.showModalDialog(dataUrl, 860, 620);
    }),
  );

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
      const blueprint = await pickBlueprint(blueprints);
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

  context.commands.registerCommand(
    GENERATE_CHORDS_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      await applyClipPlan(track, planChordClips(blueprint));
    }),
  );

  context.commands.registerCommand(
    GENERATE_DRUMS_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      await applyClipPlan(track, planDrumClips(blueprint));
    }),
  );

  context.commands.registerCommand(
    GENERATE_BASS_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      await applyClipPlan(track, planBassLine(blueprint));
    }),
  );

  context.commands.registerCommand(
    GENERATE_BLANK_COMMAND_ID,
    guard(async (...args: unknown[]) => {
      const track = resolveMidiTrack(args);
      if (!track) return;
      const blueprints = loadBlueprints(context.environment.storageDirectory);
      const blueprint = await pickBlueprint(blueprints);
      if (!blueprint) return;
      const plan = sectionSpans(blueprint).map(({ section, startBeat, durationBeats }) => ({
        name: section.name,
        startBeat,
        durationBeats,
        notes: [],
      }));
      await applyClipPlan(track, plan);
    }),
  );
}
