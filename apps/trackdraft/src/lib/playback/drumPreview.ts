import { DrumMachine, HttpStorage, type DrumMachine as DrumMachineInstance } from "smplr";
import {
  PRESET_DATA,
  inferDrumPattern,
  tileGrooveVaried,
  type DrumPattern,
  type PackedNote,
  type PackedVariant,
} from "@drum/library";
import { sectionDurationBeats, type BlueprintSection } from "../../types/blueprint";
import { getSharedAudioContext } from "./audioContext";

/**
 * A single drum hit scheduled for playback — the common shape both the
 * Structure-tab Preview button and `songTransport.ts`'s whole-track
 * play() produce. `offsetSec` is a *relative* offset from the loop's own
 * start (already converted from the variant's raw beat position via
 * `secPerBeat` — see `resolveDrumHits`), not an absolute AudioContext
 * time; `playDrumHits` adds its own "now" to it, the same way
 * `PreviewPlayer.playChordObject` does for chord voices.
 */
export interface ScheduledDrumHit {
  midi: number;
  offsetSec: number;
  velocity: number;
}

/**
 * Resolves a `(pattern, variantIndex, section)` triple into a list of
 * `ScheduledDrumHit`s, scaled to the section's velocity preset and tiled
 * to fill the section's *own* bar length (`sectionDurationBeats`) — a
 * section longer than one groove loop repeats it, with the same per-tile
 * micro-variation (`tileGrooveVaried`, seeded off the section id) the
 * export path already applies, rather than playing one loop and going
 * quiet. This matches how it actually needs to sound: an unlooped
 * preview reads as "the drums cut out," not as a deliberate one-shot.
 * Returns `null` when the pattern resolves to no playable material
 * (`none`, unmatched preset, etc.).
 *
 * `secPerBeat` (typically `60 / song.bpm`) converts each note's raw beat
 * position — `PackedVariant.notes` are `[beat, pitch, velocity]` tuples,
 * beat-based like every other groove/tiling function in `@drum/library` —
 * into a real seconds offset. `BlueprintSection` doesn't carry `bpm`
 * itself (it's song-level), so callers must pass it in; there is no way
 * for this function to get it from `section` alone.
 *
 * The variant is clamped modulo `PRESET_DATA[pattern].variants.length`;
 * a missing or out-of-range `variantIndex` falls back to 0. Callers that
 * want the deterministic hash-based variant (the bridge's export path)
 * should pick the variant index themselves — this function is the
 * playback-time projection, not the selection engine.
 */
export function resolveDrumHits(
  pattern: DrumPattern,
  variantIndex: number | undefined,
  section: BlueprintSection,
  secPerBeat: number,
  /** Override the total beat count to tile to — defaults to the section's
   *  full bar count (`sectionDurationBeats`). Pass the chord progression's
   *  beat count when looping in the harmony view so drums match exactly
   *  what you're hearing. */
  totalBeatsOverride?: number,
): ScheduledDrumHit[] | null {
  const preset = PRESET_DATA[pattern];
  if (!preset || preset.variants.length === 0) return null;

  const index = variantIndex !== undefined
    ? Math.max(0, Math.min(variantIndex, preset.variants.length - 1))
    : 0;

  const variant: PackedVariant = preset.variants[index];
  if (variant.notes.length === 0) return null;

  // Scale peak velocity to the section's velocity preset (same formula as
  // the extension's drumClips.ts scaleToVelocityPreset).
  const peak = Math.max(...variant.notes.map(([, , v]) => v), 1);
  const targetPeak = velocityNumber(section.velocity);
  const scale = targetPeak / peak;
  const scaled = variant.notes.map(([beat, pitch, velocity]) => ({
    beat,
    pitch,
    velocity: Math.max(1, Math.min(127, Math.round(velocity * scale))),
  }));

  const totalBeats = totalBeatsOverride ?? sectionDurationBeats(section);
  const tiled = tileGrooveVaried(scaled, variant.lengthBeats, totalBeats, { seed: section.id });

  return tiled.map((note) => ({
    midi: note.pitch,
    offsetSec: note.beat * secPerBeat,
    velocity: note.velocity,
  }));
}

/**
 * Heuristic pattern for a section — the same fallback `planDrumClips`
 * uses, exported so both the Preview button (which has no song context
 * for the electronic/acoustic fork) and `songTransport.ts` (which does)
 * can choose between explicit and inferred patterns consistently.
 */
export function inferPatternForSection(section: BlueprintSection): DrumPattern {
  return inferDrumPattern(
    {
      role: section.role,
      velocity: section.velocity,
      name: section.name,
      timeSignatureNumerator: section.timeSignatureNumerator,
      timeSignatureDenominator: 2 ** section.timeSignatureDenPower,
    },
    {},
  );
}

/**
 * ABLETON_SAFE_NOTES (GM drum map) → TR-808 sample group name.
 *
 * The @drum/library produces `PackedVariant.notes` with GM pitches
 * (kick=36, snare=38, closedHat=42, … from `ableton.ts`/`synthesize.ts`).
 * smplr's DrumMachine assigns samples contiguously from MIDI 36 by the
 * dm.json's alphabetical `samples` list, so GM pitch 36 hits a *clap* on
 * the TR-808 — the wrong voice. The drumMachineToPreset helper sets up
 * group-name aliases though, so `drums.start({ note: "kick" })` resolves
 * to the right sample. This table bridges the two vocabularies.
 */
const GM_TO_GROUP: Record<number, string> = {
  36: "kick",        // kick
  37: "rimshot",     // rim
  38: "snare",       // snare
  39: "clap",        // clap
  42: "hihat-close", // closedHat
  45: "mid-tom",     // tomMid
  46: "hihat-open",  // openHat
  47: "tom-hi",      // tomHigh
  49: "cymbal",      // crash
  51: "cymbal",      // ride → cymbal fallback
};

/**
 * Human-readable enumeration of `GM_TO_GROUP`, for a UI that wants to list
 * or test each voice individually (e.g. a "does this actually sound like
 * a kick?" auditioning panel) rather than trust the mapping blind. One
 * entry per distinct sample group — pitch 51 (ride) is omitted since it
 * aliases to the same "cymbal" group as 49 (crash) and would just be a
 * duplicate button; every other GM_TO_GROUP entry maps 1:1 to a distinct
 * ABLETON_SAFE_NOTES voice.
 */
export const DRUM_VOICES: { label: string; midi: number; group: string }[] = [
  { label: "Kick", midi: 36, group: "kick" },
  { label: "Rim", midi: 37, group: "rimshot" },
  { label: "Snare", midi: 38, group: "snare" },
  { label: "Clap", midi: 39, group: "clap" },
  { label: "Closed Hat", midi: 42, group: "hihat-close" },
  { label: "Mid Tom", midi: 45, group: "mid-tom" },
  { label: "Open Hat", midi: 46, group: "hihat-open" },
  { label: "Hi Tom", midi: 47, group: "tom-hi" },
  { label: "Crash", midi: 49, group: "cymbal" },
];

const VARIANT_OVERRIDE_KEY_PREFIX = "trackdraft.drumVariantIndex.";

/** A manually-confirmed-working variant index for a group, persisted by
 *  the Structure tab's variant stepper (see `DrumKitPanel.tsx`).
 *
 *  Background: smplr's own `drumMachineToPreset` aliases each sample-group
 *  name (e.g. "snare") to whichever of its variants sorts alphabetically
 *  first — for the TR-808's params-encoded-in-the-filename naming
 *  (`snare/sd0000`...`snare/sd7575`), that's every knob at its *minimum*,
 *  which on a real 808 is the least snappy, most tonal snare setting —
 *  audibly closer to a tom than a snare. `resolveSampleName` below picks
 *  the *middle* of the variant list instead as a better-by-default
 *  heuristic, but that's still a heuristic: at least one real case (the
 *  TR-808's `snare/sd2525`, dead center) turned out to be a bad/silent
 *  file despite resolving correctly through
 *  every layer of the alias/region lookup, discovered only by actually
 *  listening. Persisted in localStorage (not the song blueprint — this is
 *  a kit-calibration preference, not song data) so a confirmed-good pick
 *  survives reloads and applies to every song, not just the one being
 *  edited when it was found. */
export function getVariantOverride(group: string): number | undefined {
  const raw = localStorage.getItem(VARIANT_OVERRIDE_KEY_PREFIX + group);
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export function setVariantOverride(group: string, index: number): void {
  localStorage.setItem(VARIANT_OVERRIDE_KEY_PREFIX + group, String(index));
}

export function clearVariantOverride(group: string): void {
  localStorage.removeItem(VARIANT_OVERRIDE_KEY_PREFIX + group);
}

/** All variant sample names for a group, in the same order `resolveSampleName`
 *  indexes into — for a UI that wants to browse/step through them (the
 *  Structure tab's per-voice variant stepper). Loads the shared
 *  DrumMachine if it isn't already. */
export async function getGroupVariants(group: string): Promise<string[]> {
  const drums = await getDrumMachine();
  const variants = drums.getSampleNamesForGroup(group);
  return variants.length > 0 ? variants : [group];
}

/** Middle-of-range picks confirmed *not* to sound like their voice, found
 *  by ear via the Structure tab's stepper — overrides the generic
 *  middle-of-range heuristic for everyone by default (not just whoever
 *  happened to click through and save a `localStorage` override), so a
 *  fresh browser/profile doesn't silently regress back to a known-bad
 *  sample. `snare` at the true middle (index 12, `snare/sd2525`) resolves
 *  correctly through every layer of alias lookup but is inexplicably
 *  silent/broken on the TR-808 CDN; index 10 (`snare/sd2500`) is
 *  confirmed-working. Add to this table as more get found. */
const KNOWN_GOOD_INDEX: Partial<Record<string, number>> = {
  snare: 10,
};

/** The variant index that would actually get played for `group` right
 *  now, absent an explicit choice: the saved `localStorage` override if
 *  one exists, else `KNOWN_GOOD_INDEX`, else the middle of the range.
 *  Exported so the Structure tab's stepper can open on the same index
 *  `resolveSampleName`/`playDrumHits` would actually use — otherwise the
 *  stepper's starting position (a plain middle-of-range guess) could
 *  silently disagree with what's really playing by default. */
export function getDefaultVariantIndex(group: string, variantCount: number): number {
  const index = getVariantOverride(group) ?? KNOWN_GOOD_INDEX[group] ?? Math.floor(variantCount / 2);
  return Math.max(0, Math.min(index, variantCount - 1));
}

/** Resolves a group name to a specific sample: the manually-confirmed
 *  `localStorage` override if one is set (clamped to the current variant
 *  count, in case the underlying data changed since it was saved);
 *  otherwise `KNOWN_GOOD_INDEX` for a voice with a known-bad middle pick;
 *  otherwise the middle of the range as a reasonable general-purpose
 *  default. Validated against `getSampleNames()` either way — falls back
 *  to the bare group alias (smplr's own "first variant" default) rather
 *  than risk an unresolved name, which is a worse failure than "not the
 *  ideal variant." */
function resolveSampleName(drums: DrumMachineInstance, group: string): string {
  const variants = drums.getSampleNamesForGroup(group);
  if (variants.length === 0) return group;

  const index = getDefaultVariantIndex(group, variants.length);
  const picked = variants[index];

  if (!drums.getSampleNames().includes(picked)) {
    console.warn(`[drumPreview] "${picked}" not in getSampleNames() for group "${group}" — falling back to group alias`);
    return group;
  }
  return picked;
}

/** Trigger exactly one voice, immediately — for auditioning/testing the
 *  GM_TO_GROUP mapping directly (see `DRUM_VOICES`), independent of any
 *  section or pattern. `velocity` defaults to a comfortable preview level
 *  (not tied to any section's velocity preset, since there isn't one).
 *
 *  `variantIndex`, when given, previews that *exact* variant instead of
 *  the resolved default (persisted override or middle-of-range) — used
 *  by the Structure tab's stepper to audition candidates before saving
 *  one via `setVariantOverride`, without changing what actually plays
 *  during real preview/playback until the user confirms a choice.
 *
 *  Logs the resolved sample name so a silent voice is diagnosable from
 *  the console (which group/sample was actually requested) instead of
 *  just "nothing happened" — smplr itself already warns on a failed
 *  fetch/decode for that sample, so a warning right above this log line
 *  in the console points at the real cause. */
export async function previewDrumVoice(group: string, velocity = 100, variantIndex?: number): Promise<void> {
  const drums = await getDrumMachine();
  let sampleName: string;
  if (variantIndex !== undefined) {
    const variants = drums.getSampleNamesForGroup(group);
    sampleName = variants.length > 0 ? variants[Math.max(0, Math.min(variantIndex, variants.length - 1))] : group;
  } else {
    sampleName = resolveSampleName(drums, group);
  }
  console.info(`[drumPreview] previewing group "${group}" → sample "${sampleName}"`);
  drums.start({ note: sampleName, time: drums.context.currentTime, velocity });
}

/**
 * Schedule one loop of a section's drum pattern through the shared
 * `DrumMachine` sampler, starting essentially immediately (like
 * `PreviewPlayer.playChordObject`, this triggers relative to its own
 * "now" — it does not accept an external absolute time). Creates the
 * sampler lazily on first call (same pattern as
 * `PreviewPlayer.getContext()` — always inside a user-gesture handler,
 * so autoplay policies aren't an issue).
 *
 * A caller sequencing multiple sections in time (`songTransport.ts`)
 * calls this from within its own per-section `setTimeout`, fired at the
 * right wall-clock moment — the same structure the chord path already
 * uses, rather than this function taking an absolute time itself, which
 * would require exposing the sampler's internal AudioContext.
 *
 * Resolves once all hits for this loop have been dispatched to the
 * scheduler. The sampler may still be loading — in that case hits are
 * queued and will fire once `await drums.ready` finishes.
 *
 * Unmapped pitches (e.g. toms that don't match "tom-hi"/"mid-tom") are
 * silently skipped — the alternative is a wrong-voice hit that reads as
 * a bug in the mix.
 *
 * `startAt`, when given, is an absolute time on the shared AudioContext
 * to schedule the loop's hits against instead of "now" — `songTransport.ts`
 * uses this the same way it does for `playChordObject`, submitting a
 * precise pre-computed time ahead of when it's due rather than whatever
 * moment this async function happens to actually resolve at (itself a
 * source of jitter: `getDrumMachine()` may still be loading, `await`
 * doesn't resume at a precise instant). Every other caller (the Structure
 * tab's test buttons) omits it and gets "right now," same as before.
 */
export async function playDrumHits(
  pattern: DrumPattern,
  variantIndex: number | undefined,
  section: BlueprintSection,
  secPerBeat: number,
  startAt?: number,
  totalBeatsOverride?: number,
): Promise<void> {
  const hits = resolveDrumHits(pattern, variantIndex, section, secPerBeat, totalBeatsOverride);
  if (!hits || hits.length === 0) return;

  const drums = await getDrumMachine();
  const now = startAt ?? drums.context.currentTime;
  for (const hit of hits) {
    const group = GM_TO_GROUP[hit.midi];
    if (!group) continue; // unmapped — skip rather than play the wrong voice
    drums.start({
      note: resolveSampleName(drums, group),
      time: now + hit.offsetSec,
      velocity: hit.velocity,
    });
  }
}

// ---------------------------------------------------------------------------
// Velocity preset → MIDI peak (same table as song-structure's VELOCITY_MAP,
// kept local so this module has zero dependency on the DSL layer).
// ---------------------------------------------------------------------------

const VELOCITY_TO_PEAK: Record<string, number> = {
  ppp: 32, pp: 48, p: 64, mp: 80, mf: 96, f: 112, ff: 120, fff: 127,
};

function velocityNumber(velocity: string): number {
  return VELOCITY_TO_PEAK[velocity] ?? 96;
}

// ---------------------------------------------------------------------------
// Shared DrumMachine singleton
// ---------------------------------------------------------------------------

let sharedDrumMachine: DrumMachineInstance | null = null;
let drumMachinePromise: Promise<DrumMachineInstance> | null = null;
/** 0-127, MIDI-style — same scale and same remembered-until-load pattern
 *  as `PreviewPlayer.pendingVolume` for the chord sampler. */
let pendingVolume = 100;

function getDrumMachine(): Promise<DrumMachineInstance> {
  if (sharedDrumMachine) return Promise.resolve(sharedDrumMachine);
  if (drumMachinePromise) return drumMachinePromise;

  // The whole page's one AudioContext (audioContext.ts) — shared with
  // audioPreview.ts's chord sampler so a whole-song play (songTransport.ts)
  // schedules both against the same clock, not two independently-created
  // contexts with no relationship between their `currentTime` origins.
  const ctx = getSharedAudioContext();

  drumMachinePromise = (async () => {
    const drums = DrumMachine(ctx, {
      instrument: "TR-808",
      storage: HttpStorage,
      volume: pendingVolume,
    });
    await drums.ready;
    sharedDrumMachine = drums;
    drumMachinePromise = null;
    return drums;
  })();

  return drumMachinePromise;
}

/** 0-127, MIDI-style volume — matches `PreviewPlayer.setVolume`'s scale
 *  for the chord sampler, so a UI can present them identically. Applies
 *  immediately if the DrumMachine is already loaded; otherwise remembered
 *  and passed as the `volume` construction option the next time one loads. */
export function setDrumVolume(volume: number): void {
  pendingVolume = volume;
  if (sharedDrumMachine) sharedDrumMachine.output.volume = volume;
}

export function getDrumVolume(): number {
  return pendingVolume;
}

/** Kill the shared DrumMachine (e.g. on app teardown). Safe to call
 *  multiple times — subsequent calls to `playDrumHits`/`previewDrumVoice`
 *  will create a new one lazily. */
export function disposeDrumMachine(): void {
  if (sharedDrumMachine) {
    sharedDrumMachine.dispose();
    sharedDrumMachine = null;
  }
  drumMachinePromise = null;
}