import {
  voiceOf,
  type DrumLaneId,
  type KitVoice,
  type PackedVariant,
} from "@drum/library";
import type { BlueprintSection, BlueprintSong, SavedBeat, SavedBeatNote } from "../../types/blueprint";
import { beatsPerBar, sectionDurationBeats } from "../../types/blueprint";
import { resolveSectionLaneHits } from "../timeline/drumLaneHits";
import { resolveSectionVariant } from "../playback/drumPreview";
import { laneFigureBlock } from "./laneFigure";
import { getHost } from "../host";
import { STORAGE_KEYS } from "../persistence/keys";

/**
 * Saved beats — the writer's own vocabulary.
 *
 * A beat is a set of per-lane figures, which is exactly what a lane-by-lane
 * build produces (kick from one pattern, snare from another). It is stored as
 * notes rather than "pattern id + overrides" so it survives a library re-bake:
 * the library's patterns can be re-mined, replaced or tuned, and a beat you
 * saved still sounds like the beat you saved.
 *
 * Two homes, one shape:
 *  - `song.savedBeats`   — belongs to this song, travels with it, no bloat
 *                          beyond the couple of hundred numbers it is;
 *  - `USER_BEATS_KEY`    — reachable from every song (a small localStorage
 *                          list; see `readUserBeats`).
 */

/** Lanes in draw order, so a captured beat always reads the same way. */
const LANE_ORDER: DrumLaneId[] = ["kick", "snare", "rim", "hat", "cym", "tom"];

export const USER_BEATS_KEY = STORAGE_KEYS.userBeats.key;
/** The portable file: `<library>/tables/beats.json`, exported as `trackdraft.beats.json`. */
export const BEATS_FILENAME = "trackdraft.beats.json";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The section's current beat, captured as ONE loop.
 *
 * Captured from the RESOLVED hits (`resolveSectionLaneHits`), not from
 * `drumBlocks`: what the writer hears and sees is the base groove plus every
 * block on top of it, and a saved beat has to be that, or saving anything
 * would quietly drop whatever came from the pattern underneath.
 */
export function captureBeat(
  section: BlueprintSection,
  name: string,
  options: { song?: BlueprintSong; occurrenceIndex?: number } = {},
): SavedBeat | null {
  const hits = resolveSectionLaneHits(section, options.song, options.occurrenceIndex ?? 0);
  const barBeats = beatsPerBar(section);
  // ONE LOOP, not the section. A beat you save is the thing that repeats — an
  // 8-bar verse whose pattern is one bar saves one bar, which is what makes it
  // reusable. The loop length is the resolved variant's own (`standard` is one
  // bar, some corpus takes are two), falling back to a single bar.
  const loopBeats = resolveSectionVariant(section, options.song, options.occurrenceIndex ?? 0)?.lengthBeats ?? barBeats;
  const bars = Math.max(1, Math.round(loopBeats / barBeats));
  const span = Math.min(sectionDurationBeats(section), bars * barBeats);

  const lanes: Partial<Record<DrumLaneId, SavedBeatNote[]>> = {};
  for (const lane of LANE_ORDER) {
    const notes = (hits.get(lane) ?? [])
      .filter((hit) => hit.beat < span - 1e-9)
      .map((hit) => ({ beat: round4(hit.beat), pitch: pitchOfVoice(hit.voice), velocity: hit.velocity }))
      .filter((note) => note.pitch > 0);
    if (notes.length > 0) lanes[lane] = notes;
  }
  if (Object.keys(lanes).length === 0) return null;
  return { id: `beat-${Date.now().toString(36)}`, name: name.trim() || "untitled beat", bars, lanes };
}

/** The pitch a lane hit was played on — `SavedBeatNote` stores the note, not
 *  the voice name, so a kit map change can't silently re-point a saved beat. */
function pitchOfVoice(voice: KitVoice): number {
  return PITCH_BY_VOICE[voice] ?? 0;
}

/** GM pitches for the voices a lane figure can hold. Single source: the kit
 *  map the rest of the app reads. */
const PITCH_BY_VOICE: Partial<Record<KitVoice, number>> = (() => {
  const table: Partial<Record<KitVoice, number>> = {};
  for (let pitch = 0; pitch < 128; pitch += 1) {
    const voice = voiceOf(pitch);
    if (voice && table[voice] === undefined) table[voice] = pitch;
  }
  return table;
})();

/** A saved beat as a playable variant, for the shelf's card + feel lens. */
export function savedBeatVariant(beat: SavedBeat, beatsPerBarValue: number): PackedVariant {
  const notes = LANE_ORDER.flatMap((lane) => (beat.lanes[lane] ?? []).map((n) => [n.beat, n.pitch, n.velocity] as [number, number, number]));
  return {
    lengthBeats: beat.bars * beatsPerBarValue,
    beatsPerBar: beatsPerBarValue,
    notes: notes.sort((a, b) => a[0] - b[0]),
    source: { origin: "synth", generator: "saved-beat" },
  };
}

/**
 * Apply a saved beat: replace the lanes it defines, leave the others.
 *
 * Same rule as a lane pick, for several lanes at once — so a beat saved from a
 * full section (all six lanes) replaces the groove, while one saved from a
 * single kick only replaces the kick.
 */
export function withSavedBeat(section: BlueprintSection, beat: SavedBeat): BlueprintSection {
  const duration = sectionDurationBeats(section);
  const lengthBeats = beat.bars * beatsPerBar(section);
  const blocks = LANE_ORDER.flatMap((lane) => {
    const notes = beat.lanes[lane] ?? [];
    if (notes.length === 0) return [];
    const block = laneFigureBlock({
      lane,
      notes: notes.map((n) => ({ beat: n.beat, voice: voiceOf(n.pitch) ?? "kick", velocity: n.velocity })),
      lengthBeats,
      durationBeats: duration,
    });
    return block ? [block] : [];
  });
  if (blocks.length === 0) return section;
  return { ...section, drumBlocks: upsertLaneBlocks(section.drumBlocks, duration, blocks) };
}

/** Upsert several lanes in one pass — `upsertModeBlocks` takes a range for all
 *  of them, so they cannot overwrite each other's work. */
function upsertLaneBlocks(
  blocks: BlueprintSection["drumBlocks"],
  duration: number,
  next: NonNullable<BlueprintSection["drumBlocks"]>,
): NonNullable<BlueprintSection["drumBlocks"]> {
  const lanes = new Set(next.map((block) => block.lane));
  const kept = (blocks ?? []).filter((block) => {
    if (!lanes.has(block.lane)) return true;
    // A lane being replaced loses only the blocks inside the new range.
    return block.endBeat <= 0 || block.startBeat >= duration;
  });
  return [...kept, ...next];
}

/**
 * The library-wide list.
 *
 * On the desktop it is `<library>/tables/beats.json` beside the engine tables — portable,
 * hand-editable, and exported/imported as a file. In a browser there is no
 * library directory, so it falls back to localStorage: same shape, same
 * functions, so nothing above this layer branches on the host.
 */
let beatCache: SavedBeat[] | null = null;

export function readUserBeats(): SavedBeat[] {
  if (beatCache !== null) return beatCache;
  try {
    const raw = localStorage.getItem(USER_BEATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedBeat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Load from the desktop library file (async) and cache it. */
export async function loadUserBeats(): Promise<SavedBeat[]> {
  const host = getHost();
  if (host) {
    try {
      const { beats } = await host.beatsLoad();
      beatCache = sanitiseBeats(beats);
      return beatCache;
    } catch {
      /* fall through to whatever localStorage has */
    }
  }
  return readUserBeats();
}

export function writeUserBeats(beats: SavedBeat[]): void {
  beatCache = beats;
  const host = getHost();
  if (host) {
    void host.beatsSave(beats).catch(() => {
      /* an unwritable library is reported by the caller, not swallowed here */
    });
    return;
  }
  try {
    localStorage.setItem(USER_BEATS_KEY, JSON.stringify(beats));
  } catch {
    /* a saved beat is never worth breaking the editor over */
  }
}

/** Tolerant of hand-edited files: drop anything that isn't a beat. */
export function sanitiseBeats(value: unknown): SavedBeat[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is SavedBeat => {
    if (!entry || typeof entry !== "object") return false;
    const beat = entry as Partial<SavedBeat>;
    return typeof beat.id === "string" && typeof beat.name === "string" && typeof beat.bars === "number" && !!beat.lanes;
  });
}

/** The file an export writes / an import expects. */
export interface BeatsFile {
  format: "trackdraft.beats.v1";
  updatedAt?: string;
  beats: SavedBeat[];
}

export function beatsFile(beats: SavedBeat[]): BeatsFile {
  return { format: "trackdraft.beats.v1", updatedAt: new Date().toISOString(), beats };
}

/** Parse an imported beats file — a bare array is accepted too. */
export function parseBeatsFile(text: string): SavedBeat[] {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return sanitiseBeats(parsed);
  const file = parsed as Partial<BeatsFile>;
  return sanitiseBeats(file?.beats);
}

/** Merge imported beats over the current list, by id. */
export function mergeBeats(current: readonly SavedBeat[], incoming: readonly SavedBeat[]): { beats: SavedBeat[]; added: number; replaced: number } {
  const byId = new Map(current.map((beat) => [beat.id, beat]));
  let added = 0;
  let replaced = 0;
  for (const beat of incoming) {
    if (byId.has(beat.id)) replaced += 1;
    else added += 1;
    byId.set(beat.id, beat);
  }
  return { beats: [...byId.values()], added, replaced };
}

export function addUserBeat(beat: SavedBeat): SavedBeat[] {
  const next = [...readUserBeats().filter((b) => b.id !== beat.id), beat];
  writeUserBeats(next);
  return next;
}

export function removeUserBeat(id: string): SavedBeat[] {
  const next = readUserBeats().filter((b) => b.id !== id);
  writeUserBeats(next);
  return next;
}
