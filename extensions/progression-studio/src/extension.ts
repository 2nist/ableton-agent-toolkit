import {
  initialize,
  MidiTrack,
  ClipSlot,
  DataModelObject,
  type ActivationContext,
  type Handle,
  type NoteDescription,
  type Track,
} from "@ableton-extensions/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  mergeChordsAndMelody,
  renderBiTonalColorResult,
  renderMelodyResult,
  renderStudioResult,
  type RenderedProgression,
  type StudioResult,
} from "./render-progression.js";
import { buildStudioHtml, type StudioLive, type StudioMode } from "./studio.js";
import {
  STUDIO_APP_JS,
  STUDIO_MODEL,
  STUDIO_TENSION,
  STUDIO_MELODY,
  STUDIO_SONGS,
  STUDIO_PRESETS,
} from "./generated/studio-bundle.js";
import type { MelodyModel } from "@platform/progression-engine";

const COMMAND_ID = "progressionStudio.open";
const MELODY_COMMAND_ID = "progressionStudio.melody";

/** Parse the bundled melody model JSON once. */
const MELODY_MODEL: MelodyModel = JSON.parse(STUDIO_MELODY);

/** Writes a debug trace to the SDK's writable storage dir (survives host restarts). */
function makeLogger(storageDirectory: string | undefined) {
  const file = storageDirectory ? path.join(storageDirectory, "progression-studio.log") : undefined;
  return (msg: string) => {
    try {
      if (file) fs.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
      // logging must never take the extension down
    }
    console.error(`[progression-studio] ${msg}`);
  };
}

/** Where the rendered clip(s) should land. */
type RenderTarget =
  | { kind: "track"; track: MidiTrack<"1.0.0"> }
  | { kind: "slot"; slot: ClipSlot<"1.0.0"> };

/** Reads Live's current key/scale + best-available time signature. */
function readLive(context: ReturnType<typeof initialize>): StudioLive {
  try {
    const song = context.application.song;
    const scene = song.scenes[0];
    // Number() on every numeric — the SDK's native layer can surface these as
    // BigInt (rootNote, scene signatures), which JSON.stringify can't handle.
    // Live reports an unset scene signature as -1/-1, so fall back to 4/4.
    const num = Number(scene?.signatureNumerator ?? -1);
    const den = Number(scene?.signatureDenominator ?? -1);
    return {
      rootNote: Number(song.rootNote),
      scaleName: song.scaleName,
      scaleMode: song.scaleMode,
      signatureNumerator: num > 0 ? num : 4,
      signatureDenominator: den > 0 ? den : 4,
    };
  } catch {
    return { rootNote: 0, scaleName: "Major", scaleMode: false, signatureNumerator: 4, signatureDenominator: 4 };
  }
}

/** Creates an arrangement clip after the last existing one and fills it. */
async function createArrangementClip(
  context: ReturnType<typeof initialize>,
  track: MidiTrack<"1.0.0">,
  name: string,
  totalBeats: number,
  notes: NoteDescription[],
  log: (msg: string) => void,
): Promise<void> {
  let start = 0;
  for (const clip of track.arrangementClips) start = Math.max(start, clip.endTime);
  const clip = await context.withinTransaction(() =>
    track.createMidiClip(start, Math.max(totalBeats, 1)),
  );
  await context.withinTransaction(() => {
    clip.name = name || "Progression Studio";
    clip.notes = notes;
  });
  log(`created arrangement clip "${name}" at ${start}, ${totalBeats} beats, ${notes.length} notes`);
}

/**
 * Look for an existing MIDI track near `fromIndex` whose name matches
 * `namePattern`, scanning forward only a few slots. Used so the melody/color
 * layers land on a project's own dedicated tracks (e.g. a template with
 * `chord, color, melody` already laid out in order) instead of always
 * creating new ones — while still falling back to creating a new track for
 * any project that isn't set up that way.
 */
function findNextNamedTrack(
  tracks: Track<"1.0.0">[],
  fromIndex: number,
  namePattern: RegExp,
): MidiTrack<"1.0.0"> | null {
  const searchLimit = Math.min(tracks.length, fromIndex + 4);
  for (let i = fromIndex + 1; i < searchLimit; i++) {
    const candidate = tracks[i];
    if (candidate instanceof MidiTrack && namePattern.test(candidate.name)) return candidate;
  }
  return null;
}

/** Creates a clip in a Session clip slot and fills it. */
async function createSessionClip(
  context: ReturnType<typeof initialize>,
  slot: ClipSlot<"1.0.0">,
  name: string,
  totalBeats: number,
  notes: NoteDescription[],
  log: (msg: string) => void,
): Promise<void> {
  const clip = await context.withinTransaction(() => slot.createMidiClip(Math.max(totalBeats, 1)));
  await context.withinTransaction(() => {
    clip.name = name || "Progression Studio";
    clip.notes = notes;
  });
  log(`created session clip "${name}" (${totalBeats} beats, ${notes.length} notes)`);
}

async function runStudio(
  context: ReturnType<typeof initialize>,
  target: RenderTarget,
  log: (msg: string) => void,
  mode: StudioMode,
) {
  const live = readLive(context);
  const html = buildStudioHtml(STUDIO_APP_JS, STUDIO_MODEL, STUDIO_TENSION, STUDIO_PRESETS, mode, live, STUDIO_SONGS);
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  log(`modal url length: ${dataUrl.length} (html ${html.length}) live=${live.rootNote}/${live.scaleName}/${live.signatureNumerator}/${live.signatureDenominator}`);

  const result = await context.ui.showModalDialog(dataUrl, 780, 540);
  log(`modal returned: ${result === undefined || result === null || result === "" ? "none/empty" : result.length + " chars"}`);
  if (!result) return;

  const studio: StudioResult = JSON.parse(result);
  if (!Array.isArray(studio.chords) || studio.chords.length === 0) return;

  // One modal drives all three layers. Each layer gets its own instrument:
  //  - Instrument A (anchor block chords) always lands on the right-clicked track
  //  - Melody, when on, goes on a NEW MIDI track right below it
  //  - The bi-tonal COLOR layer, when a flavor is picked, goes on ANOTHER new
  //    MIDI track below (separate instrument, per the bi-tonal design)
  const chords = renderStudioResult(studio);
  const melody = studio.melody ? renderMelodyResult(studio, MELODY_MODEL) : null;
  const color = studio.biTonalFlavor ? renderBiTonalColorResult(studio, studio.biTonalFlavor) : null;

  if (target.kind === "track") {
    await createArrangementClip(context, target.track, chords.name, chords.totalBeats, chords.notes, log);

    // Prefer a project's own dedicated tracks for these layers (e.g. a
    // template laid out as `chord, color, melody` in order) over always
    // creating new ones. `song.tracks` is read once so both lookups see the
    // same snapshot, and only a MidiTrack within the next few slots
    // whose name actually matches counts — anything further away, or of
    // the wrong kind, falls back to creating a fresh track as before.
    const allTracks = context.application.song.tracks;
    const chordsIndex = allTracks.indexOf(target.track);

    if (melody) {
      const existing = chordsIndex >= 0 ? findNextNamedTrack(allTracks, chordsIndex, /melody/i) : null;
      const melodyTrack = existing ?? (await context.application.song.createMidiTrack());
      if (!existing) melodyTrack.name = `${chords.name} · Melody`;
      await createArrangementClip(context, melodyTrack, melody.name, melody.totalBeats, melody.notes, log);
    }
    if (color) {
      const existing = chordsIndex >= 0 ? findNextNamedTrack(allTracks, chordsIndex, /color/i) : null;
      const colorTrack = existing ?? (await context.application.song.createMidiTrack());
      if (!existing) colorTrack.name = `${chords.name} · ${studio.biTonalFlavor!.replace(/_/g, " ")}`;
      await createArrangementClip(context, colorTrack, color.name, color.totalBeats, color.notes, log);
    }
  } else {
    // A clip slot holds exactly one clip: merge chords (+color) + melody into
    // a single self-contained session clip.
    let merged: RenderedProgression = chords;
    if (color) merged = mergeChordsAndMelody(merged, color);
    if (melody) merged = mergeChordsAndMelody(merged, melody);
    await createSessionClip(context, target.slot, merged.name, merged.totalBeats, merged.notes, log);
  }
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const log = makeLogger(context.environment.storageDirectory);
  log("activate: registered");

  // Register on both scopes: right-click a MIDI track (arrangement) or a
  // Session clip slot (renders into that slot).
  for (const scope of ["MidiTrack", "ClipSlot"] as const) {
    context.ui.registerContextMenuAction(scope, "Open Progression Studio", COMMAND_ID);
    context.ui.registerContextMenuAction(scope, "Generate Melody", MELODY_COMMAND_ID);
  }

  // A thrown/rejected handler kills the whole extension host process — catch
  // and log instead (same lesson as trackdraft-bridge).
  const runCommand = (id: string, mode: StudioMode) =>
    async (...args: unknown[]) => {
      try {
        log(`command fired: ${id} (args=${args.length})`);
        const [handle] = args;
        const obj = context.getObjectFromHandle(handle as Handle, DataModelObject);
        let target: RenderTarget | undefined;
        if (obj instanceof MidiTrack) {
          target = { kind: "track", track: obj };
          log("target: MidiTrack (arrangement)");
        } else if (obj instanceof ClipSlot) {
          target = { kind: "slot", slot: obj };
          log("target: ClipSlot (session)");
        } else {
          log(`target: unsupported (${(obj as { className?: string })?.className ?? "unknown"})`);
        }
        if (!target) return;
        await runStudio(context, target, log, mode);
      } catch (error) {
        log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
        console.error("[progression-studio]", error);
      }
    };

  context.commands.registerCommand(COMMAND_ID, runCommand(COMMAND_ID, "studio"));
  context.commands.registerCommand(MELODY_COMMAND_ID, runCommand(MELODY_COMMAND_ID, "melody"));
}
