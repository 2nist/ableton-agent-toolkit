/**
 * The harmony corpus — 5,877 lead-sheet songs / 7,980 attributed sections,
 * shipped as a compact key-invariant index by
 * `packages/progression-engine/data/song_sections.json`.
 *
 * It is a different kind of data from the library: no key, meter, tempo,
 * melody or lyrics, just "this song's section plays these degrees in this
 * order". So the rows it produces carry `NaN` / `""` for everything it cannot
 * know, and the report math renders those as "—" instead of inventing a 0.
 *
 * Loaded lazily: the index is ~400 KB, and most sessions never open Study.
 */

import {
  decodeProgression,
  findMatchingSongs,
  type SongIndex,
  type SongMatch,
} from "@platform/progression-engine";
import type { ChordRow, SectionRow, SongRow, StudyDataset } from "./types";

let indexPromise: Promise<SongIndex> | null = null;

export function loadCorpusIndex(): Promise<SongIndex> {
  indexPromise ??= import("@platform/progression-engine/data/song_sections.json").then((module) => {
    const raw = module.default as unknown as SongIndex;
    if (!raw || !Array.isArray(raw.names) || !Array.isArray(raw.sections)) {
      throw new Error("The harmony corpus index is not in the expected shape");
    }
    return raw;
  });
  return indexPromise;
}

/** Corpus rows, built from the index. Cheap enough to rebuild per load. */
export function corpusDataset(index: SongIndex): StudyDataset {
  const sections: SectionRow[] = [];
  const chords: ChordRow[] = [];
  const perSong = new Map<number, { sections: number; chords: number; degrees: Set<string> }>();
  const na = Number.NaN;

  index.sections.forEach((entry, sectionIndex) => {
    const degrees = decodeProgression(entry.d);
    if (degrees.length === 0) return;
    const name = index.names[entry.n] ?? "Unknown";
    const { artist, title } = splitName(name);
    const sectionId = `corpus-${entry.n}-${sectionIndex}`;
    const borrowed = degrees.some(isBorrowedDegree);

    sections.push({
      grain: "section",
      songId: `corpus-${entry.n}`,
      title,
      artist,
      genre: "",
      key: "",
      scale: "",
      meter: "",
      sectionId,
      section: `#${sectionIndex + 1}`,
      role: "",
      velocity: "",
      bars: na,
      beatsPerChord: na,
      chordCount: degrees.length,
      distinctDegrees: new Set(degrees).size,
      borrowed,
      appliedCount: 0,
      avgTension: na,
      hasMelody: false,
      hasLyrics: false,
      hasDrums: false,
      sectionIndex,
      startBar: na,
      cadences: "",
    });

    degrees.forEach((degree, index2) => {
      chords.push({
        grain: "chord",
        songId: `corpus-${entry.n}`,
        title,
        artist,
        genre: "",
        key: "",
        scale: "",
        meter: "",
        sectionId,
        section: `#${sectionIndex + 1}`,
        role: "",
        index: index2,
        roman: degree,
        nextRoman: degrees[index2 + 1] ?? "(end)",
        degree,
        quality: "",
        fn: "",
        borrowed: isBorrowedDegree(degree),
        applied: false,
        cadence: "",
        tension: na,
        durationBeats: na,
        startBeat: index2,
      });
    });

    const acc = perSong.get(entry.n) ?? { sections: 0, chords: 0, degrees: new Set<string>() };
    acc.sections += 1;
    acc.chords += degrees.length;
    for (const degree of degrees) acc.degrees.add(degree);
    perSong.set(entry.n, acc);
  });

  const songs: SongRow[] = [...perSong.entries()].map(([nameIndex, acc]) => {
    const { artist, title } = splitName(index.names[nameIndex] ?? "Unknown");
    return {
      grain: "song",
      songId: `corpus-${nameIndex}`,
      title,
      artist,
      genre: "",
      key: "",
      scale: "",
      meter: "",
      bpm: na,
      totalBars: na,
      sectionCount: acc.sections,
      form: "",
      formScore: na,
      melodyShare: na,
      lyricShare: na,
      borrowedShare: na,
      avgTension: na,
    };
  });

  return { scope: "catalogue", songs, sections, chords, builtAt: Date.now() };
}

/** "Artist - Title" — split on the first separator; titles may contain more. */
export function splitName(name: string): { artist: string; title: string } {
  const at = name.indexOf(" - ");
  if (at < 0) return { artist: "", title: name };
  return { artist: name.slice(0, at), title: name.slice(at + 3) };
}

/** Bare degree for corpus matching: strip an applied target and a quality
 *  suffix ("V7/V" → "V", "iv7" → "iv", "♭VIImaj7" → "♭VII"). Same rule the
 *  Study desk already used to compare against preset shapes. */
export function baseNumeral(roman: string): string {
  return roman
    .replace(/^V[0-9maj♭♯]*\//, "")
    .replace(/(maj7|m7♭5|7♭5|m7|7|°|sus4)$/u, "");
}

function isBorrowedDegree(degree: string): boolean {
  return degree.startsWith("♭") || degree.startsWith("♯") || degree === "iv";
}

/** Catalogue songs whose section contains this run of degrees (contiguous
 *  first, then passing-chord matches) — the promise the Study desk's old
 *  footnote made. */
export function corpusMatches(index: SongIndex, romans: readonly string[], limit = 6): SongMatch[] {
  const degrees = romans.map(baseNumeral).filter(Boolean);
  return findMatchingSongs(index, degrees, { maxResults: limit });
}
