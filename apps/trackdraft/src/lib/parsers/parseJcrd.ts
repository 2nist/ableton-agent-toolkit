/**
 * McGill Billboard + SALAMI JCRD parser.
 * Converts chord-labeled section data into BlueprintSong format.
 *
 * Two input formats:
 * 1. McGill JCRD JSON (mcgill_jcrd_salami_Billboard/*.json): sections with chord labels
 * 2. Rock Corpus TDC JCRD (.jcrd): metadata + chords[] + beats[] + sections[]
 */

import type { BlueprintSong, BlueprintSection, Chord } from "../../types/blueprint";
import type { NoteName, ChordQuality } from "@music-theory/core";
import type { SectionRole } from "@music-theory/song-structure";

function mapSectionRole(type: string): SectionRole {
  const lower = type.toLowerCase();
  if (lower.includes("intro")) return "intro";
  if (lower.includes("outro") || lower.includes("ending")) return "outro";
  if (lower.includes("chorus") || lower.includes("refrain")) return "chorus";
  if (lower.includes("bridge")) return "bridge";
  if (lower.includes("solo")) return "solo";
  if (lower.includes("break") || lower.includes("interlude")) return "breakdown";
  if (lower.includes("pre-chorus") || lower.includes("prechorus") || lower.includes("pre_chorus")) return "pre_chorus";
  return "verse";
}

function mapChordQuality(str: string): ChordQuality {
  const lower = str.toLowerCase();
  if (lower === "maj" || lower === "major" || lower === "m") return "maj";
  if (lower === "min" || lower === "minor") return "min";
  if (lower === "dim" || lower === "diminished" || lower === "o") return "dim";
  if (lower === "aug" || lower === "augmented" || lower === "+") return "aug";
  if (lower === "7" || lower === "dom" || lower === "dominant" || lower === "dom7") return "7";
  if (lower === "maj7" || lower === "M7") return "maj7";
  if (lower === "min7" || lower === "m7") return "min7";
  if (lower === "m7b5" || lower === "half-dim" || lower === "halfdim") return "m7b5";
  if (lower === "sus2" || (lower.includes("sus2"))) return "sus2";
  if (lower === "sus4" || lower.includes("sus")) return "sus4";
  return "maj";
}

/** Parse "G:maj" / "C#:min7" / "N" into Chord or null. */
function parseLabel(label: string): Chord | null {
  if (!label || label === "N" || label === "R" || label === "X") return null;
  const match = label.match(/^([A-G][#b]?):(.+)$/);
  if (!match) return null;
  return {
    id: crypto.randomUUID(),
    romanNumeral: "",
    root: match[1] as NoteName,
    quality: mapChordQuality(match[2]),
    beats: 4,
  };
}

/** Parse Roman numeral like "Id7", "IV", "vi" from Rock Corpus format. */
function parseRoman(rn: string, key: NoteName): Chord | null {
  if (!rn || rn === "N") return null;
  // Map Roman numeral degree to semitone offset
  const degreeMap: Record<string, number> = {
    "I": 0, "II": 2, "III": 4, "IV": 5, "V": 7, "VI": 9, "VII": 11,
    "i": 0, "ii": 2, "iii": 4, "iv": 5, "v": 7, "vi": 9, "vii": 11,
  };
  const rootNames: NoteName[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const keyIdx = rootNames.indexOf(key);
  if (keyIdx < 0) return null;

  // Extract roman numeral + quality
  const match = rn.match(/^([b#]?)(I{1,3}|IV|VI{0,2}|i{1,3}|iv|vi{0,2})(.*)$/);
  if (!match) return null;

  const accidental = match[1]; // flat or sharp prefix
  const degree = match[2];    // I, IV, V, ii, etc.
  const suffix = match[3];    // dom7, 7, o, +, etc.

  let offset = degreeMap[degree] ?? 0;
  if (accidental === "b") offset -= 1;
  if (accidental === "#") offset += 1;

  const root = rootNames[(keyIdx + offset + 12) % 12];

  let quality: ChordQuality = "maj";
  if (degree === degree.toLowerCase()) quality = "min"; // lowercase = minor
  if (suffix.includes("7") || suffix.includes("dom")) quality = "7";
  if (suffix === "M7" || suffix === "maj7") quality = "maj7";
  if (suffix === "m7" || suffix === "min7") quality = "min7";
  if (suffix.includes("o") || suffix === "dim") quality = "dim";
  if (suffix === "+" || suffix === "aug") quality = "aug";

  return {
    id: crypto.randomUUID(),
    romanNumeral: degree + (suffix || ""),
    root,
    quality,
    beats: 4,
  };
}

// ─── McGill JCRD format ───────────────────────────────────────────────

interface McGillSection {
  id: string;
  start_ms: number;
  duration_ms: number;
  chords: string[];
  sectionType: string;
  sectionLetter: string;
  sectionFunction: string;
  sectionLabel: string;
  tags?: string[];
}

interface McGillSong {
  title: string;
  artist?: string;
  bpm?: number;
  source?: string;
  key?: string;
  scale?: string;
  sections: McGillSection[];
}

export function parseMcgillJcrd(raw: unknown): BlueprintSong {
  if (typeof raw !== "object" || raw === null) throw new Error("Not a valid McGill JCRD file");
  const data = raw as Record<string, unknown>;
  const title = (data.title as string) ?? "Untitled";
  const artist = data.artist as string | undefined;
  const bpm = (data.bpm as number) ?? 120;
  const source = data.source as string | undefined;
  const songKey = (data.key as NoteName) ?? ("C" as NoteName);
  const scale = (data.scale as BlueprintSong["scale"]) ?? "ionian";
  const rawSections = (data.sections as McGillSection[]) ?? [];

  const now = new Date().toISOString();
  const sections: BlueprintSection[] = [];
  const arrangement: BlueprintSong["arrangement"] = [];

  for (const ms of rawSections) {
    const chords = ms.chords.map(parseLabel).filter((c): c is Chord => c !== null);
    const secondsPerBeat = 60 / bpm;
    const durationSeconds = ms.duration_ms / 1000;
    const totalBeats = durationSeconds / secondsPerBeat;
    const bars = Math.max(2, Math.round(totalBeats / 4));

    const section: BlueprintSection = {
      id: crypto.randomUUID(),
      name: ms.sectionLabel || ms.sectionType || ms.id,
      role: mapSectionRole(ms.sectionType),
      bars,
      chords,
      beatsPerChord: chords.length > 0 ? Math.max(1, Math.round(bars * 4 / chords.length)) : 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    };
    sections.push(section);
    arrangement.push({ sectionId: section.id, repeats: 1 });
  }

  return {
    id: crypto.randomUUID(), title, artist, key: songKey, scale, bpm,
    timeSignatureNumerator: 4, timeSignatureDenominator: 4,
    sections, arrangement,
    concept: source ? `McGill/SALAMI: ${source}` : undefined,
    provenance: { source: "catalog-lookup", extractedAt: now },
    createdAt: now, updatedAt: now,
  };
}

// ─── Rock Corpus TDC format ───────────────────────────────────────────

interface RockCorpusChord {
  time: number;
  duration: number;
  chord: string; // Roman numeral: "Id7", "IV", "vi"
}

interface RockCorpusBeat {
  time: number;
  beat: string;
}

interface RockCorpusSection {
  name?: string;
  type?: string;
  start_time?: number;
  duration?: number;
  start_beat?: number;
  end_beat?: number;
}

interface RockCorpusSong {
  metadata: { title: string; artist?: string; key?: string; tempo?: number };
  chords: RockCorpusChord[];
  beats: RockCorpusBeat[];
  sections: RockCorpusSection[];
}

export function parseRockCorpusJcrd(raw: unknown): BlueprintSong {
  if (typeof raw !== "object" || raw === null) throw new Error("Not a valid Rock Corpus JCRD file");
  const data = raw as Record<string, unknown>;
  const meta = data.metadata as RockCorpusSong["metadata"];
  if (!meta?.title) throw new Error("Missing metadata.title");

  const chords = (data.chords as RockCorpusChord[]) ?? [];
  const beats = (data.beats as RockCorpusBeat[]) ?? [];
  const sections = (data.sections as RockCorpusSection[]) ?? [];
  const songKey = (meta.key as NoteName) ?? ("C" as NoteName);
  const bpm = meta.tempo ? Math.round(meta.tempo * 4) : 120; // Rock Corpus stores quarter-note tempo
  const now = new Date().toISOString();

  // Group chords into sections by time
  const blueprintSections: BlueprintSection[] = [];
  const arrangement: BlueprintSong["arrangement"] = [];

  if (sections.length > 0) {
    for (const rs of sections) {
      const startTime = rs.start_time ?? 0;
      const endTime = (rs.start_time ?? 0) + (rs.duration ?? 0);
      const sectionChords = chords
        .filter((c) => c.time >= startTime && c.time < endTime)
        .map((c) => parseRoman(c.chord, songKey))
        .filter((c): c is Chord => c !== null);

      const secondsPerBeat = 60 / (bpm > 0 ? bpm : 120);
      const duration = rs.duration ?? (sectionChords.length * 4 * secondsPerBeat);
      const bars = Math.max(2, Math.round(duration / secondsPerBeat / 4));

      const sec: BlueprintSection = {
        id: crypto.randomUUID(),
        name: rs.name || rs.type || "Section",
        role: mapSectionRole(rs.type ?? rs.name ?? "verse"),
        bars,
        chords: sectionChords,
        beatsPerChord: sectionChords.length > 0 ? Math.max(1, Math.round(bars * 4 / sectionChords.length)) : 4,
        velocity: "mf",
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      };
      blueprintSections.push(sec);
      arrangement.push({ sectionId: sec.id, repeats: 1 });
    }
  } else {
    // Fallback: single section with all chords
    const allChords = chords
      .map((c) => parseRoman(c.chord, songKey))
      .filter((c): c is Chord => c !== null);
    const sec: BlueprintSection = {
      id: crypto.randomUUID(),
      name: "Full Song",
      role: "verse",
      bars: Math.max(8, Math.round(allChords.length / 4)),
      chords: allChords,
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    };
    blueprintSections.push(sec);
    arrangement.push({ sectionId: sec.id, repeats: 1 });
  }

  return {
    id: crypto.randomUUID(),
    title: meta.title,
    artist: meta.artist,
    key: songKey,
    scale: "ionian",
    bpm: bpm > 0 ? bpm : 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: blueprintSections,
    arrangement,
    concept: "Rock Corpus TDC import",
    provenance: { source: "catalog-lookup", extractedAt: now },
    createdAt: now, updatedAt: now,
  };
}