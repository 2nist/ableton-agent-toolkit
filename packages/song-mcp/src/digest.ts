import type { BlueprintSong, BlueprintSection } from "@music-theory/song-blueprint";

// ---------------------------------------------------------------------------
// Digest — token-lean summary for library-wide overview (song_query_library)
// ---------------------------------------------------------------------------

export interface SectionDigest {
  id: string;
  name: string;
  label: string;
  bars: number;
  chordCount: number;
  romanNumerals: string[];
  hasLyrics: boolean;
}

export interface SongDigest {
  id: string;
  title: string;
  artist?: string;
  key: string;
  scale: string;
  bpm: number;
  timeSig: string;
  sectionCount: number;
  sections: SectionDigest[];
}

/** A token-lean summary of one song — no lyric text, no lyricsTimeline,
 *  no note-level data. Targeted at keeping a 300-song library well under
 *  ~40k tokens so the model can reason across the whole library without
 *  exhausting its context window. */
export function songDigest(song: BlueprintSong): SongDigest {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    key: song.key,
    scale: song.scale,
    bpm: song.bpm,
    timeSig: `${song.timeSignatureNumerator}/${song.timeSignatureDenominator}`,
    sectionCount: song.sections.length,
    sections: song.sections.map( sectionDigest ),
  };
}

function sectionDigest(section: BlueprintSection): SectionDigest {
  return {
    id: section.id,
    name: section.name,
    label: section.name,
    bars: section.bars,
    chordCount: section.chords.length,
    romanNumerals: section.chords.map((c) => c.romanNumeral),
    hasLyrics: !!(section.lyrics || (section.lyricsTimeline && section.lyricsTimeline.length > 0)),
  };
}

// ---------------------------------------------------------------------------
// Detail — full structural detail for a single song (song_get)
// ---------------------------------------------------------------------------

export interface SectionDetail {
  id: string;
  name: string;
  role: string;
  bars: number;
  velocity: string;
  timeSignature: string;
  key?: string;
  scale?: string;
  chords: {
    romanNumeral: string;
    root: string;
    quality: string;
    beats: number;
  }[];
  lyricLineCount: number;
  firstLyricLine?: string;
}

export interface SongDetail {
  id: string;
  title: string;
  artist?: string;
  key: string;
  scale: string;
  bpm: number;
  timeSig: string;
  sectionCount: number;
  sections: SectionDetail[];
  concept?: string;
  status?: Record<string, boolean>;
}

/** Full structural detail for ONE song — everything except full
 *  lyricsTimeline entries (includes per-section lyric line count and
 *  first line only). */
export function songDetail(song: BlueprintSong): SongDetail {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    key: song.key,
    scale: song.scale,
    bpm: song.bpm,
    timeSig: `${song.timeSignatureNumerator}/${song.timeSignatureDenominator}`,
    sectionCount: song.sections.length,
    sections: song.sections.map( (s) => {
      const timeline = s.lyricsTimeline;
      const firstLine = timeline && timeline.length > 0 ? timeline[0].text : undefined;
      return {
        id: s.id,
        name: s.name,
        role: s.role,
        bars: s.bars,
        velocity: s.velocity,
        timeSignature: `${s.timeSignatureNumerator}/${2 ** s.timeSignatureDenPower}`,
        key: s.key,
        scale: s.scale,
        chords: s.chords.map((c) => ({
          romanNumeral: c.romanNumeral,
          root: c.root,
          quality: c.quality,
          beats: c.beats,
        })),
        lyricLineCount: timeline ? timeline.length : 0,
        firstLyricLine: firstLine,
      };
    }),
    concept: song.concept,
    status: song.status ? { ...song.status } : undefined,
  };
}