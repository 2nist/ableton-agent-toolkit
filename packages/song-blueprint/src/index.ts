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

/** A single timestamped lyric fragment — a line (from e.g. LRCLIB) or a
 *  word (from e.g. Whisper), in beats to stay consistent with everything
 *  else in this schema. This is the timing data a ChordPro-style
 *  scrolling display would need; nothing populated it before audio/MIDI
 *  ingestion adapters existed to produce it. */
export interface LyricsTimelineEntry {
  text: string;
  startBeat: number;
  endBeat?: number;
}

/** A timed articulation change applied to a single chord: strum-spread,
 *  velocity pulse, legato overlap — shape-in-time effects that are worth
 *  seeing at a glance in a per-step lane (like a DAW automation lane under
 *  the progression) rather than buried in a dropdown. The params bag is
 *  deliberately per-style so a chord can only carry one effect at a time,
 *  keeping it a deliberate choice rather than an unmanageable stack. */
export interface ChordPerformanceEffect {
  style: "strum" | "pulse" | "legato";
  params?: Record<string, number>;
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
  /** When the chord has a richer quality than ChordQuality can express
   *  (e.g. "maj9", "7b13", "m11"), this holds the honeycomb-style suffix
   *  the hex/inspector prefer for display and voicing. `quality` stays
   *  the closest basic equivalent for the export pipeline (which only
   *  needs to know major/minor/dominant-ish). Optional — when absent,
   *  quality is the single source of truth, exactly as before. */
  extendedSuffix?: string;
  /** Optional per-step articulation effect (strum/pulse/legato). When
   *  absent the chord plays as a plain block chord — no change from
   *  current behaviour. */
  performance?: ChordPerformanceEffect;
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
  /** @deprecated Legacy field from the removed per-section drum dropdown.
   *  Drums are now inferred heuristically by the Ableton extension (role +
   *  velocity + meter + tempo); this is kept only so old blueprints and the
   *  lalo-chezia S() format still parse, and nothing reads it anymore. */
  drumPattern?: DrumPattern;
  velocity: VelocityPreset;
  timeSignatureNumerator: number;
  timeSignatureDenPower: number;
  subBars?: number;

  lyrics?: string;
  lyricsMetrical?: LyricMetricalRow[];
  lyricsTimeline?: LyricsTimelineEntry[];
  transitionNote?: string;

  /** Section-level key override. When present, this section is in a
   *  different key than the song's global key — supporting real
   *  modulation rather than just borrowed-chord workarounds. Falls
   *  back to the song's `key` when absent, so every existing section
   *  stays valid without migration. */
  key?: NoteName;
  /** Section-level scale/mode override. Works the same way as `key`:
   *  absent → falls back to the song's global `scale`. */
  scale?: ScaleType;
}

/** One pass of a section through the song timeline. Lets one canonical
 *  `BlueprintSection` (written once, in Harmony/Lyrics) repeat without
 *  duplicating itself into independent, driftable objects — which is what
 *  both `SongMap` templates and the lyric editor's chorus-consolidation
 *  did before this existed (three separate "Chorus"/"Chorus 2"/"Chorus 3"
 *  sections with no relationship to each other).
 *
 *  Keyed by `sectionId`, not name — `BlueprintSection.name` is freely
 *  user-editable and not guaranteed unique, so a name-keyed reference
 *  (song-structure's own `ArrangementEntry`) would be fragile here.
 *  `overrides` is deliberately narrow and typed against real
 *  `BlueprintSection` fields (not the DSL `SongSection` shape
 *  `ArrangementEntry.overrides` uses) — grow it only when a real use case
 *  needs more.
 *
 *  `song.arrangement` is optional-to-author: any section not covered by
 *  an entry here is treated by `sectionSpans` as an implicit
 *  `{sectionId, repeats: 1}` in `sections` list order — today's behavior,
 *  unchanged. Every existing song stays valid with zero migration. */
export interface ArrangementRepeat {
  sectionId: string;
  /** 1 = plays once, the default/current-equivalent behavior. */
  repeats: number;
  /** Display label for a specific pass, e.g. "Chorus (final)". */
  variation?: string;
  overrides?: Partial<Pick<BlueprintSection, "bars" | "velocity" | "chords" | "lyrics" | "lyricsTimeline">>;
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

/** Where a BlueprintSong's data actually came from, and how much of it to
 *  trust. Every non-manual adapter (docx ingestion, audio extraction,
 *  future MIDI import, catalog lookup) produces a *draft* for review in
 *  TrackDraft's UI, not a silent import — `warnings` is where "I
 *  couldn't confidently extract X" surfaces to the user instead of only
 *  a console a user may never see again. "catalog-lookup" (real
 *  human-annotated chord/lyric data matched from a known-song corpus —
 *  see apps/trackdraft/scripts/catalog) is deliberately distinct from
 *  "audio-extract" (inferred from a raw waveform) — conflating the two
 *  would misrepresent real ground-truth data as lower-confidence guesswork. */
export interface Provenance {
  source: "manual" | "docx-ingest" | "audio-extract" | "midi-import" | "catalog-lookup";
  extractedAt: string;
  warnings?: string[];
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
  arrangement: ArrangementRepeat[];

  concept?: string;
  notes?: SongNotes;
  additionalIdeas?: string[];
  references?: string[];
  suiteGroup?: SuiteGroup;
  alternates?: AlternateDraft[];
  status?: ProductionStatus;
  provenance?: Provenance;

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