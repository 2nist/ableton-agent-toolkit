import type { NoteName, ScaleType, ChordQuality } from "@music-theory/core";
import type {
  ArrangementEntry,
  SectionChord,
  SectionRole,
  DrumPattern,
  VelocityPreset,
} from "@music-theory/song-structure";

export type { ArrangementEntry, SectionChord, SectionRole, DrumPattern, VelocityPreset };

/** A single roman-numeral-analysis lyric row, matching the schema already
 *  present (unused) in lalo-chezia's per-song lyrics .xlsx files. */
export interface LyricMetricalRow {
  chordProgression: string;
  metricalFeet: string;
  syllableCount: string;
  rhymeScheme: string;
  notes: string;
}

/** A chord in the Harmony view's progression builder. Distinct from
 *  song-structure's SectionChord (which is arrangement-DSL shaped) —
 *  this is the authoring-time representation with a resolved MIDI root. */
export interface Chord {
  id: string;
  romanNumeral: string;
  root: NoteName;
  quality: ChordQuality;
  function?: string;
  beats: number;
  isSubstitution?: boolean;
  substitutedFrom?: string;
}

/** A section as authored in the app. Mirrors song-structure's SongSection
 *  shape (name/role/bars/beatsPerChord/drumPattern/velocity/time
 *  signature) but uses `Chord` (this file, UI-shaped, has an id for
 *  React/dnd-kit keys) as the live source of truth for its progression
 *  rather than song-structure's own `SectionChord[]` — that DSL shape is
 *  only produced at export time, via `toSectionChords()` below, when
 *  handing off to song-structure's S()/buildSong() or the Ableton
 *  extension. Keeping one authoring-time representation avoids two
 *  chord arrays silently drifting out of sync on the same section. */
export interface BlueprintSection {
  id: string;
  name: string;
  role: SectionRole;
  bars: number;
  chords: Chord[];
  beatsPerChord: number;
  drumPattern: DrumPattern;
  velocity: VelocityPreset;
  timeSignatureNumerator: number;
  timeSignatureDenPower: number;
  subBars?: number;

  lyrics?: string;
  lyricsMetrical?: LyricMetricalRow[];
  transitionNote?: string;
}

/** Converts a BlueprintSection's authoring-time chords into
 *  song-structure's SectionChord[] DSL shape for export/S()/buildSong(). */
export function toSectionChords(section: BlueprintSection): SectionChord[] {
  return section.chords.map((c) => ({
    root: c.root,
    degree: c.romanNumeral,
    quality: c.quality,
    duration: c.beats,
    isSubstitution: c.isSubstitution ?? false,
    substitutedFrom: c.substitutedFrom,
  }));
}

export interface SongNotes {
  vocalDelivery?: string;
  dynamics?: string;
  instrumentation?: string[];
  lyricalContent?: string;
}

export interface SuiteGroup {
  id: string;
  role: string;
  narrativeNote?: string;
}

export interface AlternateDraft {
  label: string;
  note: string;
}

export interface ProductionStatus {
  arrange: boolean;
  tracking: boolean;
  mix: boolean;
  master: boolean;
}

/** The top-level authoring unit. Extends what TrackDraft's documented
 *  Song shape carried (title/key/tempo/sections/progression) with the
 *  concept-album blueprint fields lalo-chezia's source docs have but
 *  nothing currently surfaces. */
export interface BlueprintSong {
  id: string;
  title: string;
  artist?: string;
  key: NoteName;
  scale: ScaleType;
  bpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;

  sections: BlueprintSection[];
  arrangement: ArrangementEntry[];

  concept?: string;
  notes?: SongNotes;
  additionalIdeas?: string[];
  references?: string[];
  suiteGroup?: SuiteGroup;
  alternates?: AlternateDraft[];
  status?: ProductionStatus;

  createdAt: string;
  updatedAt: string;
}

export function createEmptySong(title: string): BlueprintSong {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    createdAt: now,
    updatedAt: now,
  };
}
