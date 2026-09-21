import { pitchClass } from "@music-theory/core";
import type { RawCatalogSong, RawChordEvent, RawSection } from "./types.js";

/**
 * McGill Billboard + SALAMI JCRD corpus → RawCatalogSong (the catalog
 * pipeline's shared intermediate shape). This is the batch-ingest sibling
 * of the app's drag-drop parser (src/lib/parsers/parseJcrd.ts): that one
 * builds a BlueprintSong directly, this one feeds the catalog merge
 * (`toBlueprintSong`) that all three corpora share.
 *
 * Corpus facts (verified across all 739 files in one pass, 2026-09):
 *  - Section timing: `start_ms` + `duration_ms` — real, contiguous,
 *    high-confidence (tagged `timing_confidence:high`).
 *  - Chords are label LISTS with no per-chord timing. Slots are
 *    distributed uniformly across each section, stopping TAIL_ZONE_SEC
 *    before the boundary: toBlueprintSong defers any chord starting in a
 *    section's last 2 seconds into the next section as an annotation-lag
 *    correction (see TAIL_ZONE_BEATS there), and blindly-even slots would
 *    otherwise trip that deferral on most sections — last chords would
 *    hop boundaries and repeated sections would stop looking identical.
 *    Ending early keeps every section's chord set exactly as annotated;
 *    the merge's hold-last-chord pad covers the tail.
 *  - Chord vocabulary (full census): root:suffix where suffix carries
 *    quality, parenthesized tensions (`sus4(b7,9,13)`, `maj(9)`, `7(#9)`),
 *    and slash-bass degrees (`maj/5` = inversion). Two special forms:
 *    `1/1` (single note / pedal / riff event — melodic, not a chord) and
 *    `5` (power chord, no third). Both are unrepresentable in the
 *    blueprint schema; singles are skipped, power chords simplify to
 *    major. Every simplification is counted into an honest warning.
 *  - No key, no scale in any file; bpm is a 120 placeholder everywhere.
 *    Key/mode are estimated from the chord stream (Krumhansl-Kessler
 *    profiles over the duration-weighted root histogram) and flagged for
 *    review — the corpus ships no key data to be more faithful to.
 */

/** Matches toBlueprintSong's tail zone (2 seconds, in beats = 2 * bpm/60 —
 *  i.e. exactly 2 s of wall time at any tempo). */
const TAIL_ZONE_SEC = 2;

interface McGillSection {
  id?: string;
  start_ms?: number;
  duration_ms?: number;
  chords?: string[];
  sectionType?: string;
  sectionLabel?: string;
  sectionFunction?: string;
  tags?: string[];
}

type MappedChord = {
  root: string;
  quality: string;
  power: boolean;
  extension: boolean;
  slashBass: boolean;
};

/** Suffix canonicalization: exact matches first, then contains-fallbacks
 *  for the long tail of combined annotations. Returns null for suffixes
 *  nothing recognizable can be salvaged from. */
function resolveQuality(s: string): { quality: string; extension: boolean } | "power" | null {
  const EXACT: Record<string, string> = {
    "": "maj",
    maj: "maj",
    min: "min",
    "7": "7",
    min7: "min7",
    maj7: "maj7",
    dim: "dim",
    dim7: "dim",
    hdim7: "m7b5",
    m7b5: "m7b5",
    aug: "aug",
    aug7: "aug",
    sus: "sus4",
    sus2: "sus2",
    sus4: "sus4",
    "6": "maj",
    maj6: "maj",
    min6: "min",
    m6: "min",
    "9": "7",
    "11": "7",
    "13": "7",
    min9: "min7",
    min11: "min7",
    min13: "min7",
    maj9: "maj7",
    maj11: "maj7",
    maj13: "maj7",
    minmaj7: "min7",
    mmaj7: "min7",
  };
  const EXTENSIONS = new Set([
    "6", "maj6", "min6", "m6", "9", "11", "13", "min9", "min11", "min13",
    "maj9", "maj11", "maj13", "minmaj7", "mmaj7",
  ]);

  if (s === "5") return "power";
  const exact = EXACT[s];
  if (exact) return { quality: exact, extension: EXTENSIONS.has(s) };
  if (s.includes("hdim")) return { quality: "m7b5", extension: false };
  if (s.includes("sus4")) return { quality: "sus4", extension: false };
  if (s.includes("sus2")) return { quality: "sus2", extension: false };
  if (s.includes("dim")) return { quality: "dim", extension: false };
  if (s.includes("aug")) return { quality: "aug", extension: false };
  if (s.includes("min7")) return { quality: "min7", extension: false };
  if (s.includes("maj7")) return { quality: "maj7", extension: false };
  if (s.includes("min")) return { quality: "min", extension: false };
  if (s.includes("maj")) return { quality: "maj", extension: false };
  if (/\d/.test(s)) return { quality: "7", extension: false };
  return null;
}

/** "B:min/b7" → B min (slash bass dropped) · "N" → rest · "1/1" → single
 *  note · returns null for labels with no salvageable chord meaning. */
function mapChordText(text: string): MappedChord | "rest" | "single" | null {
  const t = text.trim();
  if (t === "" || t === "N" || t === "X" || t === "R") return "rest";
  if (/^1(\/\d+)?$/.test(t)) return "single";

  const m = t.match(/^([A-G][#b]?):(.*)$/);
  if (!m) return null;
  const root = m[1];
  const suffixRaw = m[2].trim();
  // Single-note / pedal / rhythmic-hit forms (v1 script comment: "1/1 & 1
  // = single note / pedal / rhythmic hit"). Abacab's intro is 11 × C:1/1;
  // a chromatic bass run reads D:1/1 C#:1/1 C:1/1... — melodic, not chords.
  if (/^1(\/\d+)?$/.test(suffixRaw)) return "single";

  let s = suffixRaw.toLowerCase().replace(/\(.*?\)/g, "");
  const slashBass = s.includes("/");
  s = s.split("/")[0].trim();

  const resolved = resolveQuality(s);
  if (resolved === null) return null;
  if (resolved === "power") {
    return { root, quality: "maj", power: true, extension: false, slashBass };
  }
  return { root, quality: resolved.quality, power: false, extension: resolved.extension, slashBass };
}

const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

// Krumhansl-Kessler key profiles (probe-tone ratings, C-rooted).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Song-level key/mode estimation from the chord stream — the corpus has
 * no key data, so this is the honest best-effort (the prior session's
 * harmonic-phonology report recommends exactly this upgrade over their
 * first-chord heuristic: Krumhansl-Kessler over pitch-class statistics).
 * Weight = chord duration, +2 s for the first chord and +1.5 s for the
 * last (pop songs open/close on tonic material far more often than not).
 * The tonic chord's own quality may flip the estimated mode when it
 * strongly contradicts the profile winner (power/single events can't
 * vote — they carry no third).
 */
export function estimateKey(
  events: RawChordEvent[],
): { key: string; mode: "ionian" | "aeolian"; confidence: number } | null {
  const played = events.filter((e) => e.root);
  if (played.length === 0) return null;

  const hist = new Array<number>(12).fill(0);
  for (const e of played) hist[pitchClass(e.root!)] += Math.max(0.25, e.endSec - e.startSec);
  hist[pitchClass(played[0].root!)] += 2;
  hist[pitchClass(played[played.length - 1].root!)] += 1.5;

  const scores: Array<{ keyPc: number; mode: "ionian" | "aeolian"; score: number }> = [];
  for (let k = 0; k < 12; k++) {
    for (const [mode, profile] of [
      ["ionian", MAJOR_PROFILE],
      ["aeolian", MINOR_PROFILE],
    ] as const) {
      let score = 0;
      for (let p = 0; p < 12; p++) score += hist[p] * profile[(p - k + 12) % 12];
      scores.push({ keyPc: k, mode, score });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  // Margin against the best DIFFERENT-tonic key: the raw runner-up is
  // almost always the same tonic's other mode (a mode question, settled
  // by the tonic-quality vote below) and would make every song read
  // near-zero confidence for nothing.
  const runnerUp = scores.find((s) => s.keyPc !== best.keyPc) ?? scores[1];
  const bestKeyPc = best.keyPc;
  let bestMode = best.mode;

  const MAJORISH = new Set(["maj", "maj7", "7"]);
  const MINORISH = new Set(["min", "min7", "m7b5", "dim"]);
  let majWeight = 0;
  let minWeight = 0;
  for (const e of played) {
    if (!e.root || pitchClass(e.root) !== bestKeyPc) continue;
    const w = Math.max(0.25, e.endSec - e.startSec);
    if (MAJORISH.has(e.quality ?? "")) majWeight += w;
    else if (MINORISH.has(e.quality ?? "")) minWeight += w;
  }
  if (bestMode === "ionian" && minWeight > majWeight * 1.5 && minWeight > 0) bestMode = "aeolian";
  else if (bestMode === "aeolian" && majWeight > minWeight * 1.5 && majWeight > 0) bestMode = "ionian";

  const confidence =
    best.score > 0 ? Math.max(0, (best.score - runnerUp.score) / best.score) : 0;
  return { key: KEY_NAMES[bestKeyPc], mode: bestMode, confidence };
}

export function parseMcgillJcrd(raw: unknown): RawCatalogSong {
  const data = raw as {
    title?: string;
    artist?: string;
    bpm?: number;
    sections?: McGillSection[];
  };

  const warnings: string[] = [];
  const stats = {
    single: 0,
    power: 0,
    extension: 0,
    slashBass: 0,
    unknown: 0,
    unknownSamples: new Set<string>(),
  };

  const sections: RawSection[] = (data.sections ?? []).map((s) => {
    const startSec = (s.start_ms ?? 0) / 1000;
    const spanSec = Math.max(0, (s.duration_ms ?? 0) / 1000);
    const slots = s.chords ?? [];

    const usableSec = spanSec > TAIL_ZONE_SEC + 0.25 ? spanSec - TAIL_ZONE_SEC : spanSec;
    const stepSec = slots.length > 0 ? usableSec / slots.length : 0;

    const chords: RawChordEvent[] = [];
    for (let i = 0; i < slots.length; i++) {
      const mapped = mapChordText(slots[i]);
      if (mapped === "rest") continue;
      if (mapped === "single") {
        stats.single++;
        continue;
      }
      if (mapped === null) {
        stats.unknown++;
        if (stats.unknownSamples.size < 4) stats.unknownSamples.add(slots[i].trim());
        continue;
      }
      if (mapped.power) stats.power++;
      if (mapped.extension) stats.extension++;
      if (mapped.slashBass) stats.slashBass++;
      chords.push({
        startSec: startSec + i * stepSec,
        endSec: startSec + (i + 1) * stepSec,
        root: mapped.root,
        quality: mapped.quality,
      });
    }

    return {
      name: s.sectionType,
      startSec,
      endSec: startSec + spanSec,
      chords,
    };
  });

  if (data.bpm === 120) {
    warnings.push("Corpus tempo is a placeholder (120 BPM) — set the real tempo to taste");
  }
  if (stats.slashBass > 0) {
    warnings.push(
      `Slash-bass notation (inversions) dropped on ${stats.slashBass} chords — bass notes not represented`,
    );
  }
  if (stats.power > 0) {
    warnings.push(`${stats.power} power chords (no third, "5") simplified to major`);
  }
  if (stats.extension > 0) {
    warnings.push(
      `Chord extensions simplified on ${stats.extension} chords (e.g. maj(9)→maj, 7(#9)→7, min9→min7)`,
    );
  }
  if (stats.single > 0) {
    warnings.push(
      `${stats.single} single-note events ("1/1" pedal/riff notation) skipped — they are melodic, not chords`,
    );
  }
  if (stats.unknown > 0) {
    const samples = [...stats.unknownSamples].map((x) => `"${x}"`).join(", ");
    warnings.push(`${stats.unknown} unrecognized chord labels skipped (e.g. ${samples})`);
  }

  const allEvents = sections.flatMap((sec) => sec.chords);
  const estimated = estimateKey(allEvents);
  let key: string | undefined;
  let mode: RawCatalogSong["mode"];
  if (estimated) {
    key = estimated.key;
    mode = estimated.mode;
    const pct = Math.round(estimated.confidence * 100);
    const thin = allEvents.length < 3;
    const low = estimated.confidence < 0.02 || thin;
    warnings.push(
      `No key/scale in source — estimated ${estimated.key} ${estimated.mode} from chord statistics (confidence ${pct}%${low ? ", LOW" : ""} over the runner-up key) — verify`,
    );
  }

  return {
    title: data.title ?? "Untitled",
    artist: data.artist,
    key,
    mode,
    bpm: data.bpm,
    sections,
    sourceFormat: "mcgill-jcrd",
    warnings,
  };
}
