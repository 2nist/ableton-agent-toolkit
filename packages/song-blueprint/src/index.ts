import type { NoteName, ScaleType, ChordQuality } from "@music-theory/core";
import type {
  ArrangementEntry,
  SectionChord,
  SectionRole,
  DrumPattern,
  VelocityPreset,
} from "@music-theory/song-structure";

export type { ArrangementEntry, SectionChord, SectionRole, DrumPattern, VelocityPreset };

/**
 * A meter built from 2-beat ("apple") and 3-beat ("galloping") groups, per
 * Kevin Ferguson's "Mastering Odd, Complex Time Signatures and Rhythms" —
 * how Balkan/Hindustani rhythmic cycles (5/16, 7/16, 11/16...) and large
 * irregular meters (25/16, 27/16) actually get built and counted.
 *
 * Structurally identical to `@drum/library`'s `MeterOutline`, but declared
 * here independently rather than imported — same reasoning this file
 * already applies to `DrumPattern` (see `@music-theory/song-structure`'s
 * own copy of that type): this is a schema package, and it stays decoupled
 * from the runtime pattern-generation library on purpose.
 */
/** Which voice a cell's downbeat plays — structurally identical to
 *  `@drum/library`'s `CellVoice`, declared here independently for the
 *  same schema-decoupling reason as `MeterOutline` itself. `"hat"` means
 *  no special voice: just the plain accented click every cell gets. */
export type DrumCellVoice = "kick" | "snare" | "hat";

/** The drum voices a per-voice Euclidean pattern override can target —
 *  mirrors `@drum/library`'s `KitVoice`, declared here independently for
 *  the same schema-decoupling reason as `MeterOutline`/`DrumCellVoice`. */
export type DrumVoiceName =
  | "kick" | "snare" | "rim" | "clap" | "closedHat" | "openHat" | "pedalHat"
  | "ride" | "rideBell" | "crash" | "tomLow" | "tomMid" | "tomHigh";

/** A free-form Euclidean rhythm: `k` onsets spread as evenly as possible
 *  across `n` steps, cyclically shifted by `rotation`. Unlike a
 *  `MeterOutline` (constrained to 2s/3s cells for odd-meter authoring),
 *  any k in 1..n is valid — this is the per-voice "one necklace per
 *  voice" authoring path the drums timeline edits. */
export interface EuclidPattern {
  /** Number of onsets (pulses) — the pattern's density, freely 1..n. */
  k: number;
  /** Number of steps (the grid the onsets are spread across). */
  n: number;
  /** Cyclic shift of the onsets around the ring (0..n-1). */
  rotation: number;
}

export interface MeterOutline {
  /** Quarter-note-beat span of one cell: 0.5 for x/8 meters, 0.25 for x/16. */
  cellBeats: number;
  /** Ordered 2s/3s whose sum is the meter's numerator, in cell units. */
  cells: (2 | 3)[];
  /** Mnemonic counting text, e.g. "1 2 1 2 3" for 5/8 grouped as 2+3. */
  label: string;
  /** Per-cell downbeat voice, same length/order as `cells` — a real
   *  kick/snare/hat groove instead of a flat click. Absent (or shorter
   *  than `cells`) treats the missing entries as `"hat"`, matching
   *  `@drum/library`'s `outlineToGroovePattern` convention exactly, so an
   *  outline authored before this field existed renders identically to
   *  before: a plain accented click on every cell. */
  cellVoices?: DrumCellVoice[];
}

/**
 * Named transition models for a section's final bars — the production
 * vocabulary a section boundary actually gets built from. Structurally
 * identical to `@drum/library`'s `TransitionModel`, declared here
 * independently for the same reason `MeterOutline` is: this schema package
 * stays decoupled from the runtime pattern-generation library.
 *
 * - `buildUp` — density/velocity ramp up toward the boundary, landing on
 *   a strong hit that launches the next section.
 * - `breakDown` — texture thins out approaching the boundary (energy
 *   draining out, not one voice silenced — that's `dropOut`).
 * - `cut` — one sharp hit, then dead silence for the rest of the span.
 * - `dropOut` — the groove continues, but one or more voices (kick by
 *   default) are silenced for the span — an EDM-style drop.
 */
export type DrumTransitionModel = "buildUp" | "breakDown" | "cut" | "dropOut";

// Re-export the adapters module so consumers (youtubeFullImport.ts,
// chordmini-bridge.ts) import from one place.
export { parseChordName, parseSyncedLyrics, chordMiniAppToBlueprintSong } from "./adapters";
export type { ChordMiniAppResult, LrclibData } from "./adapters";
export { assembleBlueprint } from "./assembler";
export type { AssemblyOptions } from "./assembler";

/** Maps ChordMiniApp segment labels → BlueprintSection roles. */
export const SECTION_ROLE_MAP: Record<string, SectionRole> = {
  intro: "intro",
  verse: "verse",
  chorus: "chorus",
  pre_chorus: "verse",
  prechorus: "verse",
  bridge: "bridge",
  outro: "outro",
  solo: "solo",
  breakdown: "breakdown",
};

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
  style: "strum" | "pulse" | "arp";
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
  /** Bi-tonal "color" layer flavor for this section's chord progression
   *  (the Color Chord track). One of the @platform/progression-engine
   *  flavor ids — "cinematic_shimmer", "sci_fi_wonder",
   *  "bittersweet_drama", "neo_soul_glow", "ambient_ocean",
   *  "altered_tension". Absent → defaults to "neo_soul_glow" at export
   *  time. Drives the Color track in MIDI export / Send to Ableton /
   *  real-time MIDI out. */
  colorFlavor?: string;
  /** Per-section drum pattern override. When absent the Ableton extension
   *  still picks a pattern heuristically (role + velocity + meter + tempo);
   *  set this to choose a specific engine pattern instead. Paired with
   *  `drumVariantIndex` for full manual control per section. */
  drumPattern?: DrumPattern;
  /** When `drumPattern` is set, which variant of that pattern's preset to
   *  use (0-based, clamped to the preset's actual variant count at export
   *  time). Absent → the extension picks a variant deterministically from
   *  the section's id, same as before manual control existed. */
  drumVariantIndex?: number;
  /** Meter built from 2s/3s (Drum Studio's odd-meter outline authoring),
   *  for a section whose time signature has no corpus/preset analogue at
   *  all (9/8, 11/16, 25/16, ...). When set, this overrides pattern
   *  selection entirely for the section — a parallel path to
   *  `drumPattern`, not a replacement for it; sections using the existing
   *  4/4/6/8/5/4/7/8 presets are untouched by this field. */
  drumMeterOutline?: MeterOutline;
  /** A named transition for this section's final bars — a deliberate
   *  authorial choice, distinct from the automatic handoff fill every
   *  long-enough section already gets at export time regardless of this
   *  field. Absent → no named transition; the section still gets its
   *  automatic fill if it qualifies for one. */
  drumTransitionModel?: DrumTransitionModel;
  /** Bars at the section's end devoted to `drumTransitionModel`. Ignored
   *  when `drumTransitionModel` is absent. Defaults to 1 at export time
   *  when the field is set but this isn't. */
  drumTransitionBars?: number;
  /** A deliberate Euclidean detour for this section's final bars — a
   *  different k/n for a bar or two that then returns to the section's
   *  base pattern, the way a drummer plays a fill that lands back in the
   *  groove. Distinct from `drumTransitionModel`: a variation changes
   *  the *shape* (the rhythm itself) for its span, while a transition
   *  is an energy gesture (build/break/cut/drop) over an unchanged
   *  pattern. Absent → no variation; the section plays its base pattern
   *  straight through. */
  drumVariationOutline?: MeterOutline;
  /** Bars at the section's end devoted to `drumVariationOutline`.
   *  Ignored when `drumVariationOutline` is absent. Defaults to 1 when
   *  the field is set but this isn't. */
  drumVariationBars?: number;
  /** Per-voice Euclidean pattern overrides — each voice's own free-form
   *  k/n rhythm, drawn as that voice's necklace on the timeline. A voice
   *  with an entry here plays its own Euclidean pattern (`k` onsets spread
   *  evenly across `n` steps, rotated by `rotation`) instead of whatever
   *  the section's base pattern gives it; voices absent from this map keep
   *  the base pattern (preset / outline / heuristic). This is the "edit
   *  the drums voice by voice" path. */
  drumVoicePatterns?: Partial<Record<DrumVoiceName, EuclidPattern>>;
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

/**
 * Expands `song.arrangement` into the full, ordered list of
 * (sectionId, repeats, overrides) passes — filling in any section from
 * `song.sections` that no entry references as an implicit
 * `{sectionId, repeats: 1}`, appended in `sections` list order.
 *
 * This is what makes `arrangement` optional-to-author: an empty array
 * (every song before this existed, and every brand-new song) resolves to
 * exactly "every section once, in list order" — the original behavior,
 * unchanged. A section is never silently dropped from export just
 * because it's missing from `arrangement`.
 *
 * Shared by `sectionSpans` (`extensions/trackdraft-bridge`, at export
 * time) and `syncArrangementToSections` below (the TrackDraft app, at
 * edit time) — one implementation of "what does an incomplete or absent
 * arrangement mean," not two that could drift apart.
 */
export function resolveArrangement(song: BlueprintSong): ArrangementRepeat[] {
  const covered = new Set(song.arrangement.map((entry) => entry.sectionId));
  const implicit: ArrangementRepeat[] = song.sections
    .filter((section) => !covered.has(section.id))
    .map((section) => ({ sectionId: section.id, repeats: 1 }));
  return [...song.arrangement, ...implicit];
}

/**
 * Rebuilds `arrangement` to match `sections` 1:1 — same length, same
 * order, one entry per section — preserving each section's existing
 * `repeats`/`variation`/`overrides` where it already has an entry
 * (anywhere in the current `arrangement`, not just at the same index),
 * and defaulting anything new to `{sectionId, repeats: 1}`.
 *
 * TrackDraft's Structure tab calls this after every structural edit
 * (add/remove/reorder a section, apply a template) so `arrangement`
 * never silently drifts out of sync with `sections` — the drag-reorder
 * list and the actual playback order stay the same thing, always. This
 * keeps the section-repeats feature deliberately simple: one arrangement
 * entry per section, not the more general "the same section appears at
 * two different, non-adjacent points in the timeline" case, which
 * `ArrangementRepeat`'s shape supports but nothing needs yet.
 */
export function syncArrangementToSections(song: BlueprintSong): BlueprintSong {
  const existingBySectionId = new Map(resolveArrangement(song).map((entry) => [entry.sectionId, entry]));
  const arrangement = song.sections.map(
    (section) => existingBySectionId.get(section.id) ?? { sectionId: section.id, repeats: 1 },
  );
  return { ...song, arrangement };
}

/** Beats per bar for a section's time signature — e.g. 4/4 → 4, 6/8 → 3,
 *  7/8 → 3.5. Mirrors the formula in extensions/trackdraft-bridge's
 *  sectionSpans() exactly (that file's own comment documents the bug an
 *  earlier numerator-only version caused on x/8 sections) — kept here so
 *  the Harmony tab can compute the identical number without re-deriving
 *  or drifting from the export path's math. */
export function beatsPerBar(section: Pick<BlueprintSection, "timeSignatureNumerator" | "timeSignatureDenPower">): number {
  return section.timeSignatureNumerator * (4 / 2 ** section.timeSignatureDenPower);
}

export function sectionDurationBeats(section: BlueprintSection): number {
  return section.bars * beatsPerBar(section);
}

/** How a section's chords[] (one pass through its progression) relates to
 *  the section's declared bar length — the same relationship
 *  loopChordsToFill() (extensions/trackdraft-bridge/src/chordCycle.ts)
 *  actually applies at export time, computed here as plain numbers instead
 *  of a full occurrence list, so the Harmony tab can show it honestly
 *  before export ever runs. Returns null for an empty progression (caller
 *  shows nothing in that case — the "no chords yet" message already
 *  covers it). */
export interface ProgressionFit {
  cycleBeats: number;
  durationBeats: number;
  wholeCycles: number;
  remainderBeats: number;
  overflowBeats: number;
}
export function describeProgressionFit(section: BlueprintSection): ProgressionFit | null {
  const cycleBeats = section.chords.reduce((sum, c) => sum + c.beats, 0);
  if (cycleBeats <= 0) return null;
  const durationBeats = sectionDurationBeats(section);
  const wholeCycles = Math.floor(durationBeats / cycleBeats);
  const remainderBeats = durationBeats - wholeCycles * cycleBeats;
  const overflowBeats = wholeCycles === 0 ? cycleBeats - durationBeats : 0;
  return { cycleBeats, durationBeats, wholeCycles, remainderBeats, overflowBeats };
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

  /** When the clock source is Ableton, the Ableton transport beat that
   *  corresponds to "song beat 0" — subtract to get a song-relative
   *  position. Set by Studio's Calibrate button; editable as a small
   *  numeric input. Default 0 means no offset applied. */
  beatOffset?: number;

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
    beatOffset: 0,
    createdAt: now,
    updatedAt: now,
  };
}
