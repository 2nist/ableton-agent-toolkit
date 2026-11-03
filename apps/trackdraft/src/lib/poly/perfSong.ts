/**
 * A song big enough to stress the canvas, built in memory.
 *
 * Spike S3 asks one question: at 64 sections with all six lanes full, does the
 * DOM renderer hold 60 fps while the camera pans and zooms? Answering it needs a
 * song no human would hand-write, and it must never touch storage — so this
 * builds one from a seed and the perf lab renders it without a store write.
 */

import type {
  BlueprintSection,
  BlueprintSong,
  Chord,
  MelodyNote,
} from "../../types/blueprint";
import { syncArrangementToSections } from "../../types/blueprint";

const ROOTS = ["C", "G", "D", "A", "E", "F", "Bb", "Eb"] as const;
const QUALITIES = ["maj", "min", "maj7", "min7", "sus4", "7"] as const;
const ROMANS = ["I", "V", "vi", "IV", "ii", "bVII", "III", "♭VI"] as const;
const GROOVES = ["standard", "half_time", "driving", "kick_only", "intense"];
const ROLES = ["intro", "verse", "chorus", "bridge", "solo", "outro"] as const;

/** Deterministic pseudo-random in [0,1), so two runs measure the same song. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function chordsFor(index: number, bars: number): Chord[] {
  const perBar = Math.max(1, Math.round(bars / 4));
  const chords: Chord[] = [];
  for (let cell = 0; cell < perBar * 4; cell += 1) {
    const pick = Math.floor(noise(index * 31 + cell) * ROOTS.length);
    chords.push({
      id: `s${index}-c${cell}`,
      root: ROOTS[pick],
      quality: QUALITIES[(index + cell) % QUALITIES.length],
      beats: 4,
      romanNumeral: ROMANS[(index + cell) % ROMANS.length],
    });
  }
  return chords;
}

function melodyFor(index: number, beats: number): { notes: MelodyNote[] } {
  const notes: MelodyNote[] = [];
  const steps = Math.max(4, Math.floor(beats / 2));
  for (let step = 0; step < steps; step += 1) {
    notes.push({
      pitch: 60 + Math.floor(noise(index * 17 + step) * 24),
      startTime: step * 2,
      duration: 1.5,
    });
  }
  return { notes };
}

function bassFor(index: number, beats: number): MelodyNote[] {
  const notes: MelodyNote[] = [];
  for (let beat = 0; beat < beats; beat += 2) {
    notes.push({
      pitch: 36 + Math.floor(noise(index * 7 + beat) * 12),
      startTime: beat,
      duration: 1.5,
    });
  }
  return notes;
}

function sectionAt(index: number, bars: number): BlueprintSection {
  const beats = bars * 4;
  return {
    id: `perf-${index}`,
    name: `${ROLES[index % ROLES.length]} ${Math.floor(index / ROLES.length) + 1}`,
    role: ROLES[index % ROLES.length],
    bars,
    chords: chordsFor(index, bars),
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    drumPattern: GROOVES[index % GROOVES.length],
    drumVariantIndex: index % 2,
    lyrics: `line one of section ${index}\nline two, the second line\nline three, and the pull\nline four lands the phrase`,
    melody: melodyFor(index, beats),
    bassNotes: bassFor(index, beats),
  } as BlueprintSection;
}

/**
 * `count` sections, cycling the same handful of roles and grooves — which is
 * what a real long song looks like, and what makes the drum and chord lanes
 * repeat work the renderer could cache.
 */
export function synthesiseSections(count: number): BlueprintSection[] {
  const sections: BlueprintSection[] = [];
  for (let index = 0; index < count; index += 1) {
    // Mostly eight bars, with the occasional four and twelve so the columns are
    // not all the same width (equal widths would flatter any culling test).
    const bars = index % 7 === 3 ? 4 : index % 11 === 5 ? 12 : 8;
    sections.push(sectionAt(index, bars));
  }
  return sections;
}

export function synthesiseSong(count: number): BlueprintSong {
  const sections = synthesiseSections(count);
  const draft = {
    id: "perf-song",
    title: `Perf ${count}`,
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections,
    arrangement: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as BlueprintSong;
  // The arrangement must cover the sections 1:1 or `sectionSpans` sees nothing.
  return syncArrangementToSections(draft);
}
