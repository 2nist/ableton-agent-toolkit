import type { RawCatalogSong, RawSection } from "./types.js";

// Real vocabulary confirmed against actual files on disk (102 unique
// chord strings sampled from Beatles-Chords/*.jcrd.json). Extended
// qualities (6ths/9ths/dim7/sus7/sus9) get simplified to the nearest
// quality @music-theory/core's ChordQuality union actually supports —
// same level of simplification the docx ingestion script already
// applies (it only ever infers maj/min), just with a wider vocabulary
// recognized here. Each simplification is honest, not silent — see
// warnings in parseBeatlesJcrd.
const QUALITY_MAP: Record<string, string> = {
  "": "maj",
  m: "min",
  "7": "7",
  m7: "min7",
  maj7: "maj7",
  dim: "dim",
  dim7: "dim",
  aug: "aug",
  sus: "sus4",
  sus2: "sus2",
  sus4: "sus4",
  sus7: "sus4",
  sus9: "sus4",
  "6": "maj",
  m6: "min",
  "9": "7",
  m9: "min7",
};

const SIMPLIFIED_SUFFIXES = new Set(["dim7", "sus7", "sus9", "6", "m6", "9", "m9"]);

function parseChordText(text: string, warnings: Set<string>): { root: string | null; quality: string | null } {
  if (text === "N" || text === "") return { root: null, quality: null };

  const match = text.match(/^([A-G][#b]?)(.*)$/);
  if (!match) {
    warnings.add(`Unrecognized chord text "${text}" — skipped`);
    return { root: null, quality: null };
  }

  const [, root, suffix] = match;
  const quality = QUALITY_MAP[suffix];
  if (!quality) {
    warnings.add(`Unrecognized chord quality suffix "${suffix}" (in "${text}") — skipped`);
    return { root: null, quality: null };
  }
  if (SIMPLIFIED_SUFFIXES.has(suffix)) {
    warnings.add(`Chord extensions simplified (e.g. "${text}" → nearest supported triad/seventh)`);
  }
  return { root, quality };
}

/** "Key A" / "Key C#:minor" / "Key D:mixolydian" / bare "C" (no "Key " prefix, seen on at least one file). */
function parseKeyAndMode(raw: string | undefined, warnings: Set<string>): { key?: string; mode?: RawCatalogSong["mode"] } {
  if (!raw) return {};
  const stripped = raw.replace(/^Key\s+/, "");
  const [keyPart, modePart] = stripped.split(":");
  const key = keyPart?.match(/^[A-G][#b]?$/) ? keyPart : undefined;

  if (!modePart) return { key, mode: "ionian" };
  const modeMap: Record<string, RawCatalogSong["mode"]> = {
    minor: "aeolian",
    aeolian: "aeolian",
    dorian: "dorian",
    phrygian: "phrygian",
    lydian: "lydian",
    mixolydian: "mixolydian",
    locrian: "locrian",
  };
  const mode = modeMap[modePart];
  if (!mode) {
    warnings.add(`Ambiguous mode tag "${modePart}" — defaulted to ionian`);
    return { key, mode: "ionian" };
  }
  return { key, mode };
}

export function parseBeatlesJcrd(raw: unknown): RawCatalogSong {
  const warnings = new Set<string>();
  const data = raw as {
    metadata?: { title?: string; artist?: string; key?: string; tempo?: number };
    sections?: Array<{
      name?: string;
      start_time?: number;
      end_time?: number;
      chords?: Array<{ chord?: string; start_time?: number; end_time?: number }>;
    }>;
  };

  const { key, mode } = parseKeyAndMode(data.metadata?.key, warnings);

  const sections: RawSection[] = (data.sections ?? []).map((s) => ({
    name: s.name,
    startSec: s.start_time ?? 0,
    endSec: s.end_time ?? 0,
    chords: (s.chords ?? []).flatMap((c) => {
      if (!c.chord) return [];
      const { root, quality } = parseChordText(c.chord, warnings);
      if (root === null || quality === null) return [];
      return [{ startSec: c.start_time ?? 0, endSec: c.end_time ?? 0, root, quality }];
    }),
  }));

  return {
    title: data.metadata?.title ?? "Untitled",
    artist: data.metadata?.artist,
    key,
    mode,
    bpm: data.metadata?.tempo,
    sections,
    sourceFormat: "beatles-jcrd",
    warnings: [...warnings],
  };
}
