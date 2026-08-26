import {
  initialize,
  MidiTrack,
  ClipSlot,
  DataModelObject,
  type ActivationContext,
  type Handle,
  type NoteDescription,
} from "@ableton-extensions/sdk";
import {
  findDrumRackWithKitFallback,
  probeDrumRack,
  resolvePadMapping,
  remapPitch,
  type LogicalDrumRole,
} from "@drum/rack-kit";
import * as fs from "node:fs";
import * as path from "node:path";
import { renderStudioResult, type StudioResult } from "./render-drum-studio.js";
import { buildStudioHtml, type StudioLive } from "./studio.js";
import {
  STUDIO_APP_JS,
  STUDIO_PATTERNS_JSON,
  STUDIO_PATTERN_ORDER,
  STUDIO_PATTERN_LABELS,
  STUDIO_BAR_OPTIONS,
  STUDIO_OUTLINE_NUMERATORS,
  STUDIO_OUTLINE_DENOMINATORS,
  STUDIO_TRANSITION_LABELS,
  STUDIO_TRANSITION_ORDER,
} from "./generated/studio-bundle.js";

const COMMAND_ID = "drumStudio.open";

/** Writes a debug trace to the SDK's writable storage dir (survives host restarts). */
function makeLogger(storageDirectory: string | undefined) {
  const file = storageDirectory ? path.join(storageDirectory, "drum-studio.log") : undefined;
  return (msg: string) => {
    try {
      if (file) fs.appendFileSync(file, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {
      // logging must never take the extension down
    }
    console.error(`[drum-studio] ${msg}`);
  };
}

/** Where the rendered clip should land. */
type RenderTarget = { kind: "track"; track: MidiTrack<"1.0.0"> } | { kind: "slot"; slot: ClipSlot<"1.0.0"> };

/** The MidiTrack a target actually writes to — a ClipSlot's containing track for the session case. */
function trackFor(target: RenderTarget): MidiTrack<"1.0.0"> | null {
  if (target.kind === "track") return target.track;
  return target.slot.parent instanceof MidiTrack ? target.slot.parent : null;
}

/** Reads Live's best-available time signature (informational readout only — presets aren't re-metered to match it). */
function readLive(context: ReturnType<typeof initialize>): StudioLive {
  try {
    const scene = context.application.song.scenes[0];
    const num = Number(scene?.signatureNumerator ?? -1);
    const den = Number(scene?.signatureDenominator ?? -1);
    return { signatureNumerator: num > 0 ? num : 4, signatureDenominator: den > 0 ? den : 4 };
  } catch {
    return { signatureNumerator: 4, signatureDenominator: 4 };
  }
}

/**
 * Real pad mapping for a target, falling back to the project's `kit` track
 * when neither the target track nor (for a Session slot) its containing
 * track has a DrumRack — returns an empty mapping (no remapping applied,
 * notes render at @drum/library's assumed GM-ish pitches) rather than
 * failing the render over a missing/unreachable rack.
 */
async function resolvePadMappingFor(
  context: ReturnType<typeof initialize>,
  target: RenderTarget,
): Promise<Partial<Record<LogicalDrumRole, number>>> {
  const track = trackFor(target);
  if (!track) return {};
  const song = context.application.song;
  const rack = song ? findDrumRackWithKitFallback(track, song) : null;
  if (!rack) return {};
  const report = await probeDrumRack(track, rack);
  return resolvePadMapping(report);
}

function remapNotes(notes: NoteDescription[], mapping: Partial<Record<LogicalDrumRole, number>>): NoteDescription[] {
  if (Object.keys(mapping).length === 0) return notes;
  return notes.map((note) => ({ ...note, pitch: remapPitch(note.pitch, mapping) }));
}

/** Creates an arrangement clip after the last existing one and fills it. */
async function createArrangementClip(
  context: ReturnType<typeof initialize>,
  track: MidiTrack<"1.0.0">,
  rendered: NonNullable<ReturnType<typeof renderStudioResult>>,
  notes: NoteDescription[],
  log: (msg: string) => void,
): Promise<void> {
  let start = 0;
  for (const clip of track.arrangementClips) start = Math.max(start, clip.endTime);
  const clip = await context.withinTransaction(() => track.createMidiClip(start, Math.max(rendered.totalBeats, 1)));
  await context.withinTransaction(() => {
    clip.name = rendered.name;
    clip.notes = notes;
  });
  log(`created arrangement clip "${rendered.name}" at ${start}, ${rendered.totalBeats} beats, ${notes.length} notes`);
}

/** Creates a clip in a Session clip slot and fills it. */
async function createSessionClip(
  context: ReturnType<typeof initialize>,
  slot: ClipSlot<"1.0.0">,
  rendered: NonNullable<ReturnType<typeof renderStudioResult>>,
  notes: NoteDescription[],
  log: (msg: string) => void,
): Promise<void> {
  const clip = await context.withinTransaction(() => slot.createMidiClip(Math.max(rendered.totalBeats, 1)));
  await context.withinTransaction(() => {
    clip.name = rendered.name;
    clip.notes = notes;
  });
  log(`created session clip "${rendered.name}" (${rendered.totalBeats} beats, ${notes.length} notes)`);
}

function describeStudioResult(studio: StudioResult): string {
  return studio.mode === "outline" ? `outline ${studio.cells.join("+")}/${studio.denominator}` : `pattern "${studio.pattern}"`;
}

async function runStudio(context: ReturnType<typeof initialize>, target: RenderTarget, log: (msg: string) => void) {
  const live = readLive(context);
  const html = buildStudioHtml(
    STUDIO_APP_JS,
    STUDIO_PATTERNS_JSON,
    STUDIO_PATTERN_ORDER,
    STUDIO_PATTERN_LABELS,
    STUDIO_BAR_OPTIONS,
    STUDIO_OUTLINE_NUMERATORS,
    STUDIO_OUTLINE_DENOMINATORS,
    STUDIO_TRANSITION_LABELS,
    STUDIO_TRANSITION_ORDER,
    live,
  );
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  log(`modal url length: ${dataUrl.length} (html ${html.length}) live=${live.signatureNumerator}/${live.signatureDenominator}`);

  const raw = await context.ui.showModalDialog(dataUrl, 700, 520);
  log(`modal returned: ${raw === undefined || raw === null || raw === "" ? "none/empty" : raw.length + " chars"}`);
  if (!raw) return;

  const studio = JSON.parse(raw) as StudioResult | null;
  if (studio === null) return; // explicit Cancel
  log(
    `parsed: ${describeStudioResult(studio)}, transitionModel=${studio.transitionModel}, transitionBars=${studio.transitionBars}, nextGridDenominator=${studio.nextGridDenominator ?? "unset"}`,
  );

  const rendered = renderStudioResult(studio);
  if (!rendered) {
    log(`nothing to render for ${describeStudioResult(studio)}`);
    return;
  }

  // Pad-mapping-aware note placement: land on this kit's actual pads
  // (falling back to a track named "kit") rather than an assumed GM
  // layout — closes the gap @drum/rack-kit's probe already diagnoses but,
  // until now, nothing acted on.
  const mapping = await resolvePadMappingFor(context, target);
  const notes = remapNotes(rendered.notes, mapping);
  log(`pad mapping: ${Object.keys(mapping).length} role(s) resolved`);

  if (target.kind === "track") {
    await createArrangementClip(context, target.track, rendered, notes, log);
  } else {
    await createSessionClip(context, target.slot, rendered, notes, log);
  }
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  const log = makeLogger(context.environment.storageDirectory);
  log("activate: registered");

  // Register on both scopes: right-click a MIDI track (arrangement) or a
  // Session clip slot (renders into that slot) — same dual-scope pattern
  // Progression Studio uses.
  for (const scope of ["MidiTrack", "ClipSlot"] as const) {
    context.ui.registerContextMenuAction(scope, "Open Drum Studio", COMMAND_ID);
  }

  // A thrown/rejected handler kills the whole extension host process — catch
  // and log instead (same lesson progression-studio and trackdraft-bridge
  // both learned).
  context.commands.registerCommand(COMMAND_ID, async (...args: unknown[]) => {
    try {
      log(`command fired: ${COMMAND_ID} (args=${args.length})`);
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
      await runStudio(context, target, log);
    } catch (error) {
      log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      console.error("[drum-studio]", error);
    }
  });
}
