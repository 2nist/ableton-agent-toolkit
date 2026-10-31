/**
 * `BlueprintSong[]` → Study rows.
 *
 * The analysis is the same `analyzeSection()` the harmony surfaces use, so a
 * report can never disagree with the chord strip about a numeral or a
 * tension. Building the library index is chunked across event-loop turns: 977
 * songs is seconds of analysis, and blocking the first paint of a view for
 * that long reads as a crash.
 */

import { analyzeSection } from "../harmony/analysis";
import { classifySong } from "../classification";
import { grooveOf } from "../drums/grooveModel";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import type { ChordRow, SectionRow, SongRow, StudyDataset, StudyScope } from "./types";

function meterOf(num: number, denPower: number): string {
  return `${num}/${2 ** denPower}`;
}

function hasMelody(section: BlueprintSection): boolean {
  return (section.melody?.notes?.length ?? 0) > 0;
}

function hasLyrics(section: BlueprintSection): boolean {
  return !!section.lyrics?.trim() || (section.lyricsTimeline?.length ?? 0) > 0;
}

function hasDrums(section: BlueprintSection): boolean {
  const source = grooveOf(section);
  return source.kind === "preset" || source.kind === "outline" || (section.drumBlocks?.length ?? 0) > 0;
}

function accidentalMark(accidental: number): string {
  if (accidental < 0) return "♭";
  if (accidental > 0) return "♯";
  return "";
}

export function songRows(song: BlueprintSong): { song: SongRow; sections: SectionRow[]; chords: ChordRow[] } {
  const sectionRows: SectionRow[] = [];
  const chordRows: ChordRow[] = [];
  const classification = classifySong(song);

  let startBar = 0;
  song.sections.forEach((section, index) => {
    const key = section.key ?? song.key;
    const scale = section.scale ?? song.scale;
    const meter = meterOf(section.timeSignatureNumerator, section.timeSignatureDenPower);
    const analysis = analyzeSection(section.chords, {
      key,
      scale,
      regions: section.tonicRegions,
    });
    const cadenceAt = new Map<number, string>();
    for (const cadence of analysis.cadences) cadenceAt.set(cadence.toIndex, cadence.kind);
    const cadenceKinds = [...new Set(analysis.cadences.map((c) => c.kind))].join(",");

    sectionRows.push({
      grain: "section",
      songId: song.id,
      title: song.title,
      artist: song.artist ?? "",
      genre: song.genre ?? "",
      key,
      scale,
      meter,
      sectionId: section.id,
      section: section.name,
      role: section.role,
      velocity: section.velocity,
      bars: section.bars,
      beatsPerChord: section.beatsPerChord,
      chordCount: section.chords.length,
      distinctDegrees: analysis.stats.distinctDegrees,
      borrowed: analysis.stats.borrowedCount > 0,
      appliedCount: analysis.stats.appliedCount,
      avgTension: analysis.stats.averageTension,
      hasMelody: hasMelody(section),
      hasLyrics: hasLyrics(section),
      hasDrums: hasDrums(section),
      sectionIndex: index,
      startBar,
      cadences: cadenceKinds,
    });

    analysis.events.forEach((event, eventIndex) => {
      chordRows.push({
        grain: "chord",
        songId: song.id,
        title: song.title,
        artist: song.artist ?? "",
        genre: song.genre ?? "",
        key,
        scale,
        meter,
        sectionId: section.id,
        section: section.name,
        role: section.role,
        index: eventIndex,
        roman: event.roman,
        nextRoman: analysis.events[eventIndex + 1]?.roman ?? "(end)",
        degree: `${event.degree + 1}${accidentalMark(event.accidental)}`,
        quality: section.chords[eventIndex]?.quality ?? "",
        fn: event.function ?? "—",
        borrowed: event.borrowed,
        applied: !!event.appliedTo,
        cadence: cadenceAt.get(eventIndex) ?? "",
        tension: event.tension,
        durationBeats: event.durationBeats,
        startBeat: event.startBeat,
      });
    });

    startBar += section.bars;
  });

  const count = Math.max(1, sectionRows.length);
  const songRow: SongRow = {
    grain: "song",
    songId: song.id,
    title: song.title,
    artist: song.artist ?? "",
    genre: song.genre ?? "",
    key: song.key,
    scale: song.scale,
    meter: meterOf(song.timeSignatureNumerator, song.timeSignatureDenominator),
    bpm: song.bpm,
    totalBars: sectionRows.reduce((sum, row) => sum + row.bars, 0),
    sectionCount: sectionRows.length,
    form: classification.label,
    formScore: classification.match.score,
    melodyShare: sectionRows.filter((row) => row.hasMelody).length / count,
    lyricShare: sectionRows.filter((row) => row.hasLyrics).length / count,
    borrowedShare: sectionRows.filter((row) => row.borrowed).length / count,
    avgTension:
      sectionRows.reduce((sum, row) => sum + row.avgTension, 0) / count,
  };

  return { song: songRow, sections: sectionRows, chords: chordRows };
}

export function buildDataset(songs: readonly BlueprintSong[], scope: StudyScope): StudyDataset {
  const songRowsOut: SongRow[] = [];
  const sectionRowsOut: SectionRow[] = [];
  const chordRowsOut: ChordRow[] = [];
  for (const song of songs) {
    const built = songRows(song);
    songRowsOut.push(built.song);
    sectionRowsOut.push(...built.sections);
    chordRowsOut.push(...built.chords);
  }
  return {
    scope,
    songs: songRowsOut,
    sections: sectionRowsOut,
    chords: chordRowsOut,
    builtAt: Date.now(),
  };
}

const CHUNK = 25;

/** Same dataset, built without holding the event loop for seconds. The
 *  progress callback drives the view's "indexing 320/977" line. */
export async function buildDatasetChunked(
  songs: readonly BlueprintSong[],
  scope: StudyScope,
  onProgress?: (done: number, total: number) => void,
): Promise<StudyDataset> {
  const songRowsOut: SongRow[] = [];
  const sectionRowsOut: SectionRow[] = [];
  const chordRowsOut: ChordRow[] = [];
  for (let index = 0; index < songs.length; index += 1) {
    const built = songRows(songs[index]!);
    songRowsOut.push(built.song);
    sectionRowsOut.push(...built.sections);
    chordRowsOut.push(...built.chords);
    if (index % CHUNK === CHUNK - 1 || index === songs.length - 1) {
      onProgress?.(index + 1, songs.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return {
    scope,
    songs: songRowsOut,
    sections: sectionRowsOut,
    chords: chordRowsOut,
    builtAt: Date.now(),
  };
}

/**
 * A cheap structural signature. Hashing 30MB of song JSON on every edit would
 * cost more than the rebuild it is trying to avoid; counts + total bars +
 * title lengths catch structural edits, renames and new songs, which is what
 * the index actually depends on.
 */
export function datasetFingerprint(songs: readonly BlueprintSong[]): string {
  let sections = 0;
  let chords = 0;
  let bars = 0;
  let titleLength = 0;
  for (const song of songs) {
    titleLength += song.title.length + (song.artist?.length ?? 0);
    for (const section of song.sections) {
      sections += 1;
      chords += section.chords.length;
      bars += section.bars;
    }
  }
  return `${songs.length}:${sections}:${chords}:${bars}:${titleLength}`;
}
