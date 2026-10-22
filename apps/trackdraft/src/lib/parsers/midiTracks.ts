/**
 * What a MIDI file's tracks actually are.
 *
 * Import used to treat every note as evidence of harmony: it stacked all
 * tracks together and ran chord detection on the result. That is fine for a
 * full arrangement and actively wrong for the corpora we import most —
 * BiMMuDa and CoCoPops are **monophonic melody annotations**, so stacking
 * them produced chords that were never in the file (a single melody line was
 * "detected" as `D#aug, C#…`) while the melody itself was dropped.
 *
 * So classify first, then use each track for what it is:
 *
 *   channel 9                                   → drums (GM percussion)
 *   ≥ 20 % of onsets sound more than one note   → harmony
 *   monophonic, mean pitch < 52                 → bass
 *   monophonic                                  → melody
 *
 * The thresholds are deliberately blunt: MIDI from a corpus is clean, and a
 * wrong guess here is visible immediately (no chords, or a melody in the
 * wrong octave), whereas a clever heuristic would fail quietly.
 */

import type { DrumBlock, DrumBlockNote, MelodyNote } from "@music-theory/song-blueprint";
import { DRUM_LANE_VOICES, type DrumLaneId } from "@drum/library";
import { voiceOf } from "@drum/library";

/** One note as the binary parser reports it. */
export interface TrackNote {
  note: number;
  velocity: number;
  startTick: number;
  endTick: number;
  track: number;
  channel: number;
}

export type TrackRole = "melody" | "harmony" | "bass" | "drums" | "ignored";

export interface TrackProfile {
  track: number;
  channel: number;
  name?: string;
  role: TrackRole;
  noteCount: number;
  lowPitch: number;
  highPitch: number;
  meanPitch: number;
  /** Share of onsets where another note is already sounding (0..1). */
  polyphony: number;
  /** Human-readable justification, surfaced in the import's provenance. */
  reason: string;
}

/** General MIDI's percussion channel (zero-based, as the parser reports it). */
export const GM_DRUM_CHANNEL = 9;
/** An onset counts as "polyphonic" when it adds a note to a sounding one. */
const POLYPHONIC_ONSET_SHARE = 0.2;
/** Below this mean pitch a monophonic line reads as a bass part rather than
 *  a melody. MIDI 52 = E3; melodies sit above it in practice. */
const BASS_MEAN_PITCH_CEILING = 52;
/** Two notes at the same tick are one chord, not a flam. */
const SIMULTANEITY_TICKS = 6;

function statsFor(track: number, notes: TrackNote[]): Omit<TrackProfile, "role" | "reason" | "name"> {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  const pitches = notes.map((n) => n.note);
  const meanPitch = pitches.reduce((sum, p) => sum + p, 0) / Math.max(1, pitches.length);

  let polyphonic = 0;
  let onsets = 0;
  for (let i = 0; i < sorted.length; i++) {
    const onset = sorted[i].startTick;
    // Only the first note of a cluster counts as the onset — otherwise a
    // three-note chord would be counted three times and inflate the share.
    if (i > 0 && onset - sorted[i - 1].startTick < SIMULTANEITY_TICKS) continue;
    onsets += 1;
    const sounding = notes.filter((n) => n.startTick <= onset && n.endTick > onset).length;
    if (sounding > 1) polyphonic += 1;
  }

  return {
    track,
    channel: notes[0]?.channel ?? 0,
    noteCount: notes.length,
    lowPitch: Math.min(...pitches),
    highPitch: Math.max(...pitches),
    meanPitch,
    polyphony: onsets === 0 ? 0 : polyphonic / onsets,
  };
}

/**
 * Classify every track in a file. Tracks with no notes are omitted.
 *
 * At most one track is assigned each of `melody` and `bass`, and at most one
 * is assigned `drums`; the rest of the candidates are `ignored` with a reason,
 * so the import can say what it skipped instead of silently discarding it.
 * Multiple harmony tracks are all kept — a piano part split across staves is
 * still one harmony.
 */
export function classifyTracks(
  notes: TrackNote[],
  trackNames: Record<number, string | undefined> = {},
): TrackProfile[] {
  const byTrack = new Map<number, TrackNote[]>();
  for (const note of notes) {
    const list = byTrack.get(note.track);
    if (list) list.push(note);
    else byTrack.set(note.track, [note]);
  }

  const profiles: TrackProfile[] = [];
  let melodyAssigned = false;
  let bassAssigned = false;

  // Highest mean pitch first, so when several monophonic tracks compete the
  // top line becomes the melody.
  const ordered = [...byTrack.entries()].sort(
    ([, a], [, b]) =>
      b.reduce((s, n) => s + n.note, 0) / b.length - a.reduce((s, n) => s + n.note, 0) / a.length,
  );

  for (const [track, trackNotes] of ordered) {
    const stats = statsFor(track, trackNotes);
    const name = trackNames[track];

    if (stats.channel === GM_DRUM_CHANNEL) {
      profiles.push({ ...stats, name, role: "drums", reason: "percussion channel" });
      continue;
    }
    if (stats.polyphony >= POLYPHONIC_ONSET_SHARE) {
      profiles.push({
        ...stats,
        name,
        role: "harmony",
        reason: `${Math.round(stats.polyphony * 100)}% of onsets are polyphonic`,
      });
      continue;
    }
    if (stats.meanPitch < BASS_MEAN_PITCH_CEILING && !bassAssigned) {
      bassAssigned = true;
      profiles.push({ ...stats, name, role: "bass", reason: "monophonic and low" });
      continue;
    }
    if (!melodyAssigned) {
      melodyAssigned = true;
      profiles.push({
        ...stats,
        name,
        role: "melody",
        reason: bassAssigned ? "monophonic" : "monophonic and highest",
      });
      continue;
    }
    profiles.push({
      ...stats,
      name,
      role: "ignored",
      reason: "a melody track was already found",
    });
  }

  return profiles.sort((a, b) => a.track - b.track);
}

/**
 * The melody track's notes as section-relative beats.
 *
 * Chords (simultaneous notes) are reduced to their top note: the field is a
 * monophonic line and a chord's highest note is what a listener hears as the
 * tune. A zero-length or reversed note is clamped to one tick's worth rather
 * than dropped, so a legato passage keeps every note.
 */
export function melodyFromTrack(
  notes: TrackNote[],
  ticksPerQuarter: number,
  sectionStartTick = 0,
): MelodyNote[] {
  if (ticksPerQuarter <= 0) return [];
  const minDuration = 1 / ticksPerQuarter;

  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.note - b.note);
  const seen = new Set<number>();
  const melody: MelodyNote[] = [];

  for (const note of sorted) {
    // Keep the top note of a simultaneous cluster.
    if (seen.has(note.startTick)) {
      const previous = melody[melody.length - 1];
      if (previous && note.note > previous.pitch) previous.pitch = note.note;
      continue;
    }
    seen.add(note.startTick);
    const start = Math.max(0, (note.startTick - sectionStartTick) / ticksPerQuarter);
    const end = (note.endTick - sectionStartTick) / ticksPerQuarter;
    melody.push({
      pitch: note.note,
      startTime: round3(start),
      duration: round3(Math.max(minDuration, end - start)),
      velocity: note.velocity,
    });
  }
  return melody;
}

/**
 * A drum track as Drum Blocks — one `steps` block per lane covering the whole
 * section. `steps` mode stores the notes verbatim, so this is a faithful
 * import rather than a groove guess: what Live plays is what the file said.
 * Pitches with no GM percussion meaning are skipped and counted.
 */
export function drumsToBlocks(
  notes: TrackNote[],
  ticksPerQuarter: number,
  sectionStartTick: number,
  sectionBeats: number,
): { blocks: DrumBlock[]; unmapped: number } {
  if (ticksPerQuarter <= 0 || sectionBeats <= 0) return { blocks: [], unmapped: 0 };

  const perLane = new Map<DrumLaneId, DrumBlockNote[]>();
  let unmapped = 0;

  for (const note of [...notes].sort((a, b) => a.startTick - b.startTick)) {
    const voice = voiceOf(note.note);
    if (!voice) {
      unmapped += 1;
      continue;
    }
    const lane = (Object.keys(DRUM_LANE_VOICES) as DrumLaneId[]).find((id) =>
      DRUM_LANE_VOICES[id].includes(voice),
    );
    if (!lane) {
      unmapped += 1;
      continue;
    }
    const beat = (note.startTick - sectionStartTick) / ticksPerQuarter;
    if (beat < 0 || beat >= sectionBeats) continue;
    const hit: DrumBlockNote = {
      beat: round3(beat),
      voice,
      velocity: note.velocity,
    };
    const list = perLane.get(lane);
    if (list) list.push(hit);
    else perLane.set(lane, [hit]);
  }

  const blocks: DrumBlock[] = [];
  for (const [lane, laneNotes] of perLane) {
    blocks.push({
      id: `midi-${lane}`,
      lane,
      startBeat: 0,
      endBeat: sectionBeats,
      mode: "steps",
      notes: laneNotes,
    });
  }
  return { blocks, unmapped };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
