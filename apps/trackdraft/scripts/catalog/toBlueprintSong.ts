import { pitchClass } from "@music-theory/core";
import type { NoteName, ChordQuality, ScaleType } from "@music-theory/core";
import type { BlueprintSection, BlueprintSong, Chord, LyricsTimelineEntry, SectionRole } from "@music-theory/song-blueprint";
import { normalizeRole } from "@music-theory/song-taxonomy";
import type { RawCatalogSong } from "./types.js";
import type { LrcLine } from "./lrc.js";
import { cleanDisplayTitle } from "./normalizeTitle.js";

/**
 * Maps @music-theory/song-taxonomy's CanonicalRole (the shared vocabulary
 * used for narrative-form mining) onto song-structure's SectionRole. The
 * two aren't identical: taxonomy collapses transitional material into
 * "link" and anything unrecognized into "other", where SectionRole has a
 * dedicated "breakdown" and a "custom" catch-all — so "link" maps to
 * "breakdown" (the closest existing concept) and "other" maps to "custom"
 * (there's no better fit).
 */
const CANONICAL_TO_SECTION_ROLE: Record<string, SectionRole> = {
  verse: "verse",
  chorus: "chorus",
  pre_chorus: "pre_chorus",
  bridge: "bridge",
  solo: "solo",
  intro: "intro",
  outro: "outro",
  link: "breakdown",
  other: "custom",
};

/**
 * Guess a real SectionRole from the catalog's raw section name, instead of
 * stamping every section "custom" — the bug that made narrative-form
 * mining and the drum engine's role signal both dead for all 179 catalog
 * files (every section came in as "custom"). Names normalizeRole drops
 * entirely (e.g. "silence" — not a real section) keep "custom" rather
 * than a guess, since there's nothing to guess from.
 */
function guessSectionRole(rawName: string): SectionRole {
  const canonical = normalizeRole(rawName);
  if (!canonical) return "custom";
  return CANONICAL_TO_SECTION_ROLE[canonical];
}

const DEFAULT_BPM = 120;
const DEFAULT_TIME_SIG_NUMERATOR = 4;

// Standard chromatic Roman-numeral degree names, independent of any
// particular mode — used because real songs (especially Beatles-scale
// harmonic range) routinely borrow/modulate outside their annotated
// mode's 7 diatonic degrees. Lowercase = minor-ish quality, matching
// standard notation convention.
const CHROMATIC_DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
const MINOR_ISH: ReadonlySet<ChordQuality> = new Set(["min", "min7", "dim", "m7b5"]);

function romanNumeralFor(root: NoteName, keyPc: number, quality: ChordQuality): string {
  const interval = (((pitchClass(root) - keyPc) % 12) + 12) % 12;
  const base = CHROMATIC_DEGREES[interval];
  return MINOR_ISH.has(quality) ? base.toLowerCase() : base;
}

function roundToQuarterBeat(beats: number): number {
  return Math.round(beats * 4) / 4;
}

export interface ToBlueprintSongOptions {
  id: string;
  raw: RawCatalogSong;
  lyricLines?: LrcLine[];
  hasSyncedLyrics: boolean;
}

export function catalogSongToBlueprintSong({ id, raw, lyricLines, hasSyncedLyrics }: ToBlueprintSongOptions): BlueprintSong {
  const warnings = [...raw.warnings];
  const now = new Date().toISOString();

  const bpm = raw.bpm ?? DEFAULT_BPM;
  if (!raw.bpm) warnings.push(`No tempo in source data — defaulted to ${DEFAULT_BPM} BPM`);
  const beatsPerSec = bpm / 60;

  const key = raw.key ?? "C";
  if (!raw.key) warnings.push("No key in source data — defaulted to C");
  const scale: ScaleType = raw.mode ?? "ionian";
  const keyPc = pitchClass(key);

  if (lyricLines && !hasSyncedLyrics) {
    warnings.push("LRCLIB had plain lyrics only (no line-level timestamps) — lyricsTimeline not populated");
  } else if (!lyricLines) {
    warnings.push("No LRCLIB match found — lyrics not populated");
  }

  const sections: BlueprintSection[] = raw.sections.map((rawSection, sectionIndex) => {
    const durationBeats = (rawSection.endSec - rawSection.startSec) * beatsPerSec;
    const bars = Math.max(1, Math.round(durationBeats / DEFAULT_TIME_SIG_NUMERATOR));

    const chords: Chord[] = rawSection.chords.map((c, chordIndex) => {
      const chordBeats = roundToQuarterBeat((c.endSec - c.startSec) * beatsPerSec);
      const quality = c.quality as ChordQuality;
      return {
        id: `${id}-s${sectionIndex}-c${chordIndex}`,
        root: c.root as NoteName,
        quality,
        romanNumeral: romanNumeralFor(c.root as NoteName, keyPc, quality),
        beats: Math.max(0.25, chordBeats),
      };
    });

    const mostCommonBeats = chords.length
      ? [...chords]
          .sort(
            (a, b) =>
              chords.filter((c) => c.beats === b.beats).length - chords.filter((c) => c.beats === a.beats).length,
          )[0].beats
      : DEFAULT_TIME_SIG_NUMERATOR;

    const sectionStartBeat = raw.sections
      .slice(0, sectionIndex)
      .reduce((sum, s) => sum + Math.max(1, Math.round((s.endSec - s.startSec) * beatsPerSec / DEFAULT_TIME_SIG_NUMERATOR)) * DEFAULT_TIME_SIG_NUMERATOR, 0);
    const sectionEndBeat = sectionStartBeat + bars * DEFAULT_TIME_SIG_NUMERATOR;

    const linesInSection = (lyricLines ?? []).filter((line) => {
      const lineBeat = line.startSec * beatsPerSec;
      return lineBeat >= sectionStartBeat && lineBeat < sectionEndBeat;
    });
    const lyricsTimeline: LyricsTimelineEntry[] | undefined = linesInSection.length
      ? linesInSection.map((line) => ({ text: line.text, startBeat: line.startSec * beatsPerSec }))
      : undefined;

    return {
      id: `${id}-section-${sectionIndex}`,
      name: rawSection.name ?? `Section ${sectionIndex + 1}`,
      role: guessSectionRole(rawSection.name ?? ""),
      bars,
      chords,
      beatsPerChord: mostCommonBeats,
      drumPattern: "standard",
      velocity: "mf",
      timeSignatureNumerator: DEFAULT_TIME_SIG_NUMERATOR,
      timeSignatureDenPower: 2,
      lyrics: linesInSection.length ? linesInSection.map((l) => l.text).join("\n") : undefined,
      lyricsTimeline,
    };
  });

  if (sections.some((s) => s.chords.length === 0)) {
    warnings.push("Some sections have no recognized chords (silence, or all chord text was unrecognized)");
  }
  warnings.push("Section timing quantized to whole bars at 4/4 — some drift from source timestamps is expected");

  return {
    id,
    title: cleanDisplayTitle(raw.title),
    artist: raw.artist,
    key,
    scale,
    bpm,
    timeSignatureNumerator: DEFAULT_TIME_SIG_NUMERATOR,
    timeSignatureDenominator: 4,
    sections,
    arrangement: sections.map((s) => ({ sectionName: s.name, repeats: 1 })),
    provenance: { source: "catalog-lookup", extractedAt: now, warnings },
    createdAt: now,
    updatedAt: now,
  };
}
