import type { NoteName, ScaleType, ChordQuality, ChordVoicing } from "@music-theory/core";
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

/** The six lane families the Drum Blocks timeline stages (KICK / SNR / RIM /
 *  HAT / CYM / TOM) — mirrors `@drum/library`'s lane mapping, declared here
 *  independently for the same schema-decoupling reason as `DrumVoiceName`. */
export type DrumLaneId = "kick" | "snare" | "rim" | "hat" | "cym" | "tom";

/** One authored step inside a `steps`-mode `DrumBlock`. `beat` is
 *  block-relative. `offsetBeats`/`durBeats` are the micro-timing and gate
 *  the piano-roll layer writes; `prob`/`ratchet`/`flam` are the per-step
 *  effects — all baked deterministically at plan time (seeded per
 *  occurrence) so preview, .mid, live-out and Send-to-Ableton stay
 *  identical. */
export interface DrumBlockNote {
  beat: number;
  voice: DrumVoiceName;
  velocity: number;
  /** Micro-timing nudge in beats (negative = early). */
  offsetBeats?: number;
  /** Gate / step length in beats. Absent → the block's grid. */
  durBeats?: number;
  /** Keep probability 0..1 (seeded per occurrence). Absent → always plays. */
  prob?: number;
  /** Sub-hits packed into the step's gate (1..4). Absent → 1. */
  ratchet?: number;
  /** Grace note a hair before the step. Absent → off. */
  flam?: boolean;
}

/** Range-level effects for a `DrumBlock` — applied to the block's own notes
 *  after generation, deterministically (seeded from the occurrence). */
export interface DrumBlockFx {
  /** Delays off-8th hits toward the triplet feel (0..1). */
  swing?: number;
  /** Seeded timing/velocity jitter (0..1). */
  humanize?: number;
  /** Pull notes toward the 16th grid (0..1). */
  quantize?: number;
  /** Velocity remap, soft (-1) → hard (+1). */
  velCurve?: number;
}

/** A range-scoped, per-lane drum authoring block — the Drum Blocks
 *  timeline's unit of edit. `startBeat`/`endBeat` are section-relative and
 *  clamped to the section (blocks never bleed across section lines).
 *
 *  - `inherit` — leave the base groove; `fx` (if any) still applies to the
 *    lane's existing notes in range.
 *  - `euclid` — replace the lane's notes in range with `k` onsets over `n`
 *    steps, rotated by `rotation` (the XY pad's X/Y axes).
 *  - `outline` — replace with a 2s/3s outline pattern (`outlineToGroovePattern`
 *    when `cellVoices` is set, a plain click otherwise), tiled across the range.
 *  - `steps` — replace with the authored `notes` (the dotted lane / piano roll).
 *  - `motion` — a transition gesture: `motion.x`/`motion.y` (each -1..1,
 *    y up) resolve to a transition model (+ intensity via magnitude) and the
 *    range's content is replaced with the synthesized gesture.
 *
 *  Blocks sharing a `groupId` with `interleave: true` are treated as ONE
 *  cluster: a single Euclidean rhythm spread across their lanes by priority
 *  (kick > snare > toms > percussion) — rolls and fills, not stacked hits. */
export interface DrumBlock {
  id: string;
  lane: DrumLaneId;
  groupId?: string;
  startBeat: number;
  endBeat: number;
  mode: "inherit" | "euclid" | "outline" | "steps" | "motion";
  euclid?: EuclidPattern;
  outline?: MeterOutline;
  notes?: DrumBlockNote[];
  /** Motion gesture vector, each axis -1..1; +y = build, +x = dense. */
  motion?: { x: number; y: number };
  interleave?: boolean;
  fx?: DrumBlockFx;
}

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

/** A chord read against a tonic other than the section's key. */
export interface ChordFunction {
  /** How the chord reads inside its local key, e.g. "V65", "viio6", "N". */
  numeral: string;
  /** The local tonic, as a scale degree of the section's key (0-6). */
  targetDegree: number;
  /** Accidental on that target degree: -1 flat, 0 natural, +1 sharp. */
  targetAccidental: number;
  /** Absolute pitch class of the local tonic, for analysis. */
  targetRootPc: number;
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
  /** The label this chord was imported with, verbatim — e.g. a DCML
   *  "FV65/V" from the Mozart corpus, or a corpus chord symbol the
   *  parser had to reduce. Display only: nothing derives harmony from
   *  it, and it is deliberately NOT `extendedSuffix`, which means "a
   *  quality suffix" and feeds hex placement and voicing. */
  annotation?: string;
  /** Secondary function: this chord is a degree of a *local* tonic rather
   *  than of the section's key — "V65 of V", "viio6 of ii". The chord's
   *  `root`/`quality` stay absolute, so every planner keeps working; this
   *  only records what the source actually said, which is the part a
   *  Roman numeral alone cannot express. */
  secondaryFunction?: ChordFunction;
  /** Optional per-step articulation effect (strum/pulse/legato). When
   *  absent the chord plays as a plain block chord — no change from
   *  current behaviour. */
  performance?: ChordPerformanceEffect;
  /** Optional voicing — which chord tone sits in the bass (`inversion`) and
   *  whether the upper voices are stacked close or spread open. Absent means
   *  root position, close: exactly the historical block chord, so existing
   *  songs sound and export unchanged. Every planner (the .mid export, live
   *  MIDI out, the in-app audition and the Ableton bridge) resolves it
   *  through `@music-theory/core`'s `voiceChord`, so they can't disagree. */
  voicing?: ChordVoicing;
}

/** The generated bass voice's shape for a section. Pure number knobs so
 *  the shared generator (`@drum/library`'s `planSectionBass`) stays
 *  dependency-free — it receives pre-computed pitch classes, never the
 *  blueprint types themselves. Absent (per section) → the historical
 *  behavior: one sustained root per chord, octave 3, velocity 100. */
export interface BassProfile {
  /** Register as a MIDI octave number (octave*12 + pitch class): 3 = the
   *  standard bass octave (MIDI 36 = C2), 2 = an octave down, 4 = an
   *  octave up. Default 3; the Bend Bass register axis maps onto 2..4. */
  octave?: 2 | 3 | 4;
  /** How the bass moves between/within chord changes. `"root"` = the
   *  chord root (the only option before this existed); `"root_fifth"` =
   *  roots alternating with the fifth across the subdivision;
   *  `"walking"` = roots that walk up into the next chord, ending each
   *  chord on a leading tone one semitone below the next root. Default
   *  `"root"`. */
  motion?: "root" | "root_fifth" | "walking";
  /** Subdivision of each chord's span. `"locked"` = one note per chord
   *  change (legato); `"half"` = two notes; `"eighth"` = four. Default
   *  `"locked"`. */
  rhythm?: "locked" | "half" | "eighth";
  /** Note velocity 1-127. Default 100 (matches the bridge's historical
   *  bass velocity). */
  velocity?: number;
}

/** The macro "Bend" axes a user can tint the whole song or one section
 *  with — the six the groove engine reads (drums + harmony voicing) plus
 *  the per-layer axes for the Mix/Bend station (Bass, Tension,
 *  Articulation, and the six Melody axes: contour, density, register,
 *  rhythm, motif, space). Structurally identical to
 *  `@drum/library`'s `StyleProfile`; declared here independently for the
 *  same schema-decoupling reason `BassProfile`/`MeterOutline` are. All
 *  values 0..1 except `tempo` (absolute bpm); 0.5 is the neutral point on
 *  every 0..1 axis (a neutral profile is a no-op — the engine's current
 *  behavior). Per-layer axes are optional: absent = not set (an untouched
 *  slider never shadows an authored per-section value). */
export interface StyleProfile {
  /** 0 = delicate … 1 = driving (the generated drums' peak velocity). */
  energy: number;
  /** 0 = sparse … 1 = busy/dense (pattern family + fill rate). */
  density: number;
  /** 0 = soft, no strong backbeat … 1 = locked 2&4 backbeat. */
  backbeat: number;
  /** 0 = straight/tight grid … 1 = swung/human feel. */
  feel: number;
  /** 0 = acoustic kit … 1 = electronic machine. */
  kit: number;
  /** 0 = triads/simple … 1 = extended/lush (7/9/11 + color intensity). */
  harmony: number;
  /** 0 = consonant (aug/dim/m7b5 restored) … 1 = dissonant lean. The
   *  0.25..0.75 band is a no-op. */
  tension?: number;
  /** 0..0.5 = block/legato (neutral at 0.5) · >0.5 strumming · >0.75
   *  staccato arpeggiation. */
  articulation?: number;
  /** 0 = conjunct (leaps smoothed) … 1 = disjunct (leaps stretched,
   *  capped). 0.5 = the captured line, untouched. */
  melodyContour?: number;
  /** 0 = sparse … 1 = busy subdivision (notes per chord). */
  melodyDensity?: number;
  /** 0 = low register … 0.5 = as generated … 1 = an octave up. */
  melodyRegister?: number;
  /** 0 = on the grid … 1 = syncopated onsets and pushed phrases. */
  melodyRhythm?: number;
  /** 0 = through-composed … 1 = repeat the opening motif across phrases. */
  melodyRepetition?: number;
  /** 0 = continuous … 1 = airy (rests at phrase ends). */
  melodyRest?: number;
  /** 0 = low (octave 2) · 0.5 = standard (3) · 1 = up (4). */
  bassRegister?: number;
  /** 0 = root · 0.5 = root/fifth · 1 = walking. */
  bassMotion?: number;
  /** 0 = locked · 0.5 = half · 1 = eighth. */
  bassRhythm?: number;
  /** 0 = soft (≈70) · 0.5 = standard (≈100) · 1 = hard (127). */
  bassVelocity?: number;
  /** Tempo in bpm (absolute — not normalized). */
  tempo: number;
}

/**
 * Relative narrative parameters — the abstract "lyrical arc" a section or a
 * template slot carries, INDEPENDENT of any subgenre's concrete musical
 * vocabulary. This is a second abstract layer that sits ABOVE the Bend axes
 * (`StyleProfile`) and tints them at render time; it never names chords,
 * notes, drum patterns, or kits.
 *
 * Follows the same decoupling rule as `StyleProfile`/`MeterOutline`/
 * `TransitionModel`: this type is declared here in the schema package and
 * `drum-library` keeps its own structurally-identical copy, so neither side
 * imports the other. All values 0..1 where 0.5 = neutral, EXCEPT
 * `transition_delta` which is signed (-1..+1, 0 = neutral) because it is a
 * directional boundary signal. `structural_warp` is also neutral at 0 (it is
 * an additive deformation, not a 0.5-centered tint). A section/song with no
 * `narrative` resolves to all-neutral = the engine's current behavior,
 * byte-for-byte (parity).
 *
 * - `tension_profile` → `StyleProfile.tension`/`harmony` (dissonance + color).
 * - `rhythmic_energy` → `StyleProfile.energy`/`density`/`articulation` (drum
 *   + chord velocity and density).
 * - `transition_delta` → the section-boundary transition model (build vs drain).
 * - `structural_warp` → an asymmetric (Euclidean 2s/3s) harmony grid / meter
 *   deformation, instead of flat beatsPerChord.
 */
export interface NarrativeProfile {
  /** 0 = resolved/calm … 1 = dissonant/suspenseful. */
  tension_profile: number;
  /** 0 = sparse/still … 1 = driving/busy. */
  rhythmic_energy: number;
  /** -1 = energy drains out of the boundary … +1 = builds into the next section. */
  transition_delta: number;
  /** 0 = no deformation … 1 = warped (asymmetric meter / Euclidean harmony). */
  structural_warp: number;
}

/** A single captured melody note — one sung/hummed pitch, segmented from
 *  the microphone by the Melody tab's audio-to-MIDI pipeline. Timing is
 *  in song beats relative to the section start (the same timebase as
 *  every other beat count in this schema); the quantize + fit-to-scale
 *  post-processing knobs rewrite these fields before the note lands in
 *  `MelodyTrack`. */
export interface MelodyNote {
  /** MIDI note number (60 = middle C, same numbering as export). */
  pitch: number;
  /** Onset in beats from section start. */
  startTime: number;
  /** Length in beats. */
  duration: number;
  /** Note velocity 1-127. Default 96 at capture time (matches the chord
   *  export velocity); a sung phrase can carry real dynamics. */
  velocity?: number;
}

/** A section's captured monophonic melody line — the Melody track's
 *  authoring-time representation, parallel to `chords`/`bassProfile`.
 *  Absent (per section) → the section has no melody, and every exporter
 *  (MIDI export, live MIDI out, Send to Ableton) simply skips it. */
/** The macro controls the melody generator was built from — stored so the
 *  UI can tell "the Bend changed since this line was generated" without
 *  guessing, and so a rebuild is reproducible. */
export interface MelodyGenerationParams {
  contour: number;
  density: number;
  register: number;
  rhythm: number;
  repetition: number;
  rest: number;
}

export interface MelodyTrack {
  notes: MelodyNote[];
  /** Where the line came from. `generated` lines may be rebuilt from Bend;
   *  `recorded` (or absent) lines are the player's and only get the
   *  render-time contour transform; `edited` means drawn/moved by hand in the
   *  note editor, which wins over both (no rebuild nudge, and the stem uses
   *  the notes exactly as written). */
  source?: "recorded" | "generated" | "edited";
  /** Deterministic generator seed (reroll changes it). */
  seed?: number;
  /** The Bend values used at generation time. */
  params?: MelodyGenerationParams;
  /** True when `styleMelodyLine` was already applied to `notes` — the stem
   *  must not shape the line a second time. */
  contourApplied?: boolean;
  generatedAt?: string;
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
  /** The Color layer's register — how many octaves above the chord anchor
   *  the bi-tonal color voice sits (the progression engine's `colorOctave`;
   *  the anchor is fixed at octave 4). Absent → 6 at export time. */
  colorOctave?: number;
  /** Bass line profile for this section — register, motion, rhythm and
   *  velocity for the generated bass voice (the Bass track in MIDI
   *  export / Send to Ableton / real-time MIDI out). Absent → a single
   *  sustained root per chord at octave 3 (the historical behavior). */
  bassProfile?: BassProfile;
  /** Per-section "Bend" override — a `Partial<StyleProfile>` (any subset
   *  of the seven macro axes) that tints THIS section on top of the song
   *  master. Absent → the section follows the song master, which itself
   *  defaults to the engine's neutral behavior. */
  bend?: Partial<StyleProfile>;
  /** Per-section relative narrative parameters — the abstract "lyrical arc"
   *  this section carries (see `NarrativeProfile`). Read as an override on
   *  top of the song master's `narrative` at render time, exactly like
   *  `bend`. Absent → the section follows the song master, which itself
   *  defaults to all-neutral (the engine's current behavior). */
  narrative?: NarrativeProfile;
  /** Captured monophonic melody for this section — a sung/hummed line
   *  recorded from the microphone and segmented into notes by the Melody
   *  tab (audio-to-MIDI). Notes are beats-relative-to-section-start, so
   *  the same `planMelodyStem` maps them onto the timeline like every
   *  other stem. Absent → no melody for the section; exporters skip it.
   *  The template's `melody` track (ch.5 in live MIDI out) is where this
   *  line lands. */
  melody?: MelodyTrack;
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
  /** Bars devoted to `drumVariationOutline`. Ignored when
   *  `drumVariationOutline` is absent. Defaults to 1 when the field is
   *  set but this isn't. */
  drumVariationBars?: number;
  /** Section-relative beat where the detour (`drumVariationOutline`)
   *  begins — lets a detour live ANYWHERE on the timeline (the beat-dot
   *  insert surface), not just at the section's end. Absent → the detour
   *  sits in the section's final `drumVariationBars` bars (the classic
   *  ending fill), clamped to the section length. */
  drumVariationStartBeat?: number;
  /** Per-voice Euclidean pattern overrides — each voice's own free-form
   *  k/n rhythm, drawn as that voice's necklace on the timeline. A voice
   *  with an entry here plays its own Euclidean pattern (`k` onsets spread
   *  evenly across `n` steps, rotated by `rotation`) instead of whatever
   *  the section's base pattern gives it; voices absent from this map keep
   *  the base pattern (preset / outline / heuristic). This is the "edit
   *  the drums voice by voice" path. */
  drumVoicePatterns?: Partial<Record<DrumVoiceName, EuclidPattern>>;
  /** Range-scoped Drum Blocks — the Drum Blocks timeline's authoring layer
   *  (dotted step lanes, XY Euclidean pads, motion gestures, step FX).
   *  Absent → byte-identical to the pre-blocks pipeline. Applied at export
   *  as the LAST content layer (`@drum/library`'s `applyDrumBlocks`), so
   *  authored material always wins over automatic fills/transitions/
   *  detours; the automatic ending machinery still runs underneath. */
  drumBlocks?: DrumBlock[];
  /** Euclidean harmony — a `MeterOutline` whose onsets (each 2s/3s cell's
   *  start) drive when the chord progression advances, instead of each
   *  chord's `beats`. Reuses the exact drum-outline machinery, so harmony
   *  and drums can lock to the same syncopated grid (or run polymeter
   *  against each other). Absent → chords advance on per-chord `beats`
   *  exactly as before. */
  harmonyMeterOutline?: MeterOutline;
  /** When true and the section has a `drumMeterOutline`, the harmony's
   *  chord changes follow the drums' meter — the drums literally drive the
   *  harmony rhythm. Only consulted when `harmonyMeterOutline` is absent;
   *  set either this or `harmonyMeterOutline`, not both. */
  harmonyFollowsDrums?: boolean;
  /** Global anticipation offset in beats — every chord change is pushed
   *  EARLY by this amount (e.g. 0.5 = an 8th-note jazz push, 0.25 = a
   *  16th), so chords anticipate the downbeat across the bar. The UI stays
   *  on a clean grid; only the exported onsets shift. Orthogonal to how
   *  chords advance (`beats` vs an outline). The section's first chord is
   *  clamped to the section start so no note lands before a clip. */
  syncopationOffset?: number;
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
  /** Modulation *within* this section: runs of chords that share a home
   *  note, section-relative. Authored entries win over inference, so a
   *  correction sticks. Empty/absent → one home for the whole section. */
  tonicRegions?: TonicRegion[];
  /** Meter changes *inside* this section, by 0-based bar. Absent (or empty)
   *  → one meter for the whole section, its `timeSignatureNumerator` /
   *  `timeSignatureDenPower`, which is what every song written before this
   *  field existed still means. Present → those two fields describe the
   *  section's *opening* meter (what the editor shows and what a new chord
   *  defaults to); the map decides how long each bar actually is. */
  meterMap?: MeterChange[];
}

/** A meter change at a 0-based bar inside a section. `denominator` is the
 *  written lower number (8 for 7/8), not its power — a bar is
 *  `numerator * (4 / denominator)` quarter-note beats. */
export interface MeterChange {
  bar: number;
  numerator: number;
  denominator: number;
}

/** Where a tonal-centre region came from: proposed by the key finder, or
 *  authored (and therefore never silently re-inferred). */
export type TonicSource = "inferred" | "authored";

/** A run of a section that shares one home note — a modulation *inside* a
 *  section. `startBeat` is section-relative; the first region always starts
 *  at 0. Absent (or empty) → the whole section has one home, its
 *  `key`/`scale` override or the song's. */
export interface TonicRegion {
  startBeat: number;
  key: NoteName;
  scale: ScaleType;
  source: TonicSource;
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
  overrides?: Partial<Pick<BlueprintSection, "bars" | "velocity" | "chords" | "lyrics" | "lyricsTimeline" | "bend" | "narrative" | "drumTransitionModel" | "drumMeterOutline">>;
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

/** Beats in each of a section's bars, in order — one entry per bar. With no
 *  `meterMap` every entry is the declared meter, so this is just `bars`
 *  copies of `beatsPerBar` and every existing song is unaffected. */
export function barLengths(
  section: Pick<BlueprintSection, "bars" | "timeSignatureNumerator" | "timeSignatureDenPower" | "meterMap">,
): number[] {
  const count = Math.max(0, Math.floor(section.bars));
  const declared = beatsPerBar(section);
  const lengths = new Array<number>(count).fill(declared);
  const map = section.meterMap;
  if (!map || map.length === 0) return lengths;

  const sorted = [...map].sort((a, b) => a.bar - b.bar);
  for (let i = 0; i < sorted.length; i += 1) {
    const change = sorted[i];
    if (!(change.numerator > 0) || !(change.denominator > 0)) continue;
    const from = Math.max(0, Math.min(count, Math.floor(change.bar)));
    const to = Math.min(count, i + 1 < sorted.length ? Math.floor(sorted[i + 1].bar) : count);
    const length = change.numerator * (4 / change.denominator);
    for (let bar = from; bar < to; bar += 1) lengths[bar] = length;
  }
  return lengths;
}

/** The simplest written meter for a bar of this many quarter-note beats:
 *  3.5 → 7/8, 5 → 5/4, 4 → 4/4. Used when something that only knows a beam
 *  length (a groove, a probe section) needs the meter back. */
export function meterForLength(beats: number): { numerator: number; denominator: number } {
  for (const denominator of [4, 8, 16, 2]) {
    const numerator = (beats * denominator) / 4;
    const rounded = Math.round(numerator);
    if (rounded > 0 && Math.abs(numerator - rounded) < 1e-9) return { numerator: rounded, denominator };
  }
  return { numerator: Math.max(1, Math.round(beats)), denominator: 4 };
}

/** The average bar length: identical to `beatsPerBar` unless a meter map
 *  makes the bars different lengths. Use this for display maths ("how many
 *  bars is this cycle?", where to draw bar lines); use `beatsPerBar` for the
 *  section's *declared* meter, which is what the editor shows and what a new
 *  chord defaults to. */
export function meanBeatsPerBar(section: BlueprintSection): number {
  if (section.bars > 0) return sectionDurationBeats(section) / section.bars;
  return beatsPerBar(section);
}

/** Total length in quarter-note beats — the sum of the actual bars when a
 *  meter map is present, `bars × beatsPerBar` otherwise. */
export function sectionDurationBeats(section: BlueprintSection): number {
  if (!section.meterMap || section.meterMap.length === 0) {
    return section.bars * beatsPerBar(section);
  }
  return barLengths(section).reduce((sum, length) => sum + length, 0);
}

/** Which bar a section-relative beat falls in, and how far into it. */
export function barAtBeat(
  section: Pick<BlueprintSection, "bars" | "timeSignatureNumerator" | "timeSignatureDenPower" | "meterMap">,
  beat: number,
): { bar: number; beatInBar: number } {
  const bpb = beatsPerBar(section);
  if (!section.meterMap || section.meterMap.length === 0) {
    const bar = Math.max(0, Math.floor(beat / bpb));
    return { bar, beatInBar: Math.max(0, beat - bar * bpb) };
  }
  const lengths = barLengths(section);
  let remaining = Math.max(0, beat);
  for (let bar = 0; bar < lengths.length; bar += 1) {
    if (remaining < lengths[bar]) return { bar, beatInBar: remaining };
    remaining -= lengths[bar];
  }
  return { bar: Math.max(0, lengths.length - 1), beatInBar: 0 };
}

/** Section-relative beat where a bar starts. */
export function beatAtBar(
  section: Pick<BlueprintSection, "bars" | "timeSignatureNumerator" | "timeSignatureDenPower" | "meterMap">,
  bar: number,
): number {
  const bpb = beatsPerBar(section);
  if (!section.meterMap || section.meterMap.length === 0) return bar * bpb;
  const lengths = barLengths(section);
  let total = 0;
  for (let i = 0; i < Math.min(bar, lengths.length); i += 1) total += lengths[i];
  return total;
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
  source: "manual" | "docx-ingest" | "audio-extract" | "midi-import" | "catalog-lookup" | "musicxml-import";
  extractedAt: string;
  warnings?: string[];
}

/** The five stems TrackDraft renders. Mirrors
 *  `apps/trackdraft/src/lib/stems.ts` (which narrows this to `StemId`) —
 *  it lives here because the blueprint is the shared schema both sides
 *  read, and the instrument map below is part of that schema. */
export type StemName = "drums" | "bass" | "chords" | "color" | "melody";

/** Per-song instrument choice for one stem — what the user wants loaded on
 *  the DAW track that receives it. Rendered output uses it two ways: `name`
 *  becomes an instrument-name meta event and `gmProgram` a program change,
 *  so a General MIDI-compatible DAW assigns the sound on import. Nothing
 *  here can force a non-GM instrument into a DAW; it's the author's intent,
 *  carried with the data. Absent → the receiving track is left alone. */
export interface StemInstrument {
  name?: string;
  /** General MIDI program number, 1-128 (0-127 on the wire). Ignored for
   *  drums: GM channel 10 is percussion by definition. */
  gmProgram?: number;
}

/** Per-song instrument intent, keyed by stem. Sparse — a song normally
 *  authors only the stems whose default sound it wants to change. */
export type SongInstruments = Partial<Record<StemName, StemInstrument>>;

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

  /** Per-song alignment nudge for RENDERED output, in beats (negative =
   *  earlier). Some catalog songs' quantized section timing landed a beat
   *  off the reference recording — e.g. You Won't See Me, where the
   *  record's bar lines sit one beat ahead of the app's grid (verified
   *  against the jcrd change times, the mix's low-band profile, and a
   *  bar-accurate MIDI transcription; the user's ear confirmed both the
   *  unshifted in-app render AND the shifted export). In-app playback and
   *  live MIDI out keep the app's own grid; RENDERED exports
   *  (`songToMidi` / "Send to Ableton") shift every note by this much so
   *  the output locks with the record. Absent/0 → no shift. */
  outputOffsetBeats?: number;

  /** What to load on each stem's DAW track (see `StemInstrument`). Carried
   *  into rendered output as instrument-name + program-change metadata;
   *  never affects the notes themselves. */
  instruments?: SongInstruments;

  concept?: string;
  /** The song's genre label (e.g. "rock", "bossa", "trap") — the key into
   *  the drum engine's `GENRE_GROOVES` family-lean table (Groove DNA), and
   *  the label a Bend style recipe writes. Absent → drums are picked from
   *  role/velocity/meter alone, exactly as before. */
  genre?: string;
  /** Whole-song "Bend" master — any subset of the seven macro style axes
   *  (Energy/Density/Backbeat/Feel/Kit/Harmony/Tempo) tinting every
   *  section that doesn't carry its own `bend` override. Partial so you
   *  only author the axes you're bending; unset axes stay neutral (the
   *  resolver merges with the defaults). Absent → the engine's current
   *  behavior. */
  bend?: Partial<StyleProfile>;
  /** Whole-song relative narrative master — the abstract "lyrical arc" the
   *  song as a whole carries, tinting every section that doesn't carry its
   *  own `narrative` override (same precedence as `bend`). This is the
   *  "abstract blueprint" half of the narrative layer; the concrete musical
   *  vocabulary it tints comes from the active subgenre map / Bend recipe.
   *  Absent → all-neutral (no narrative tint). */
  narrative?: NarrativeProfile;
  /** Analysis-derived Bend ratings — what the SONG suggests on the same
   *  axes ("detected" ghosts in the Mix/Bend station). Non-destructive:
   *  nothing applies these automatically; the panel shows markers with an
   *  adopt affordance. Produced offline by `scripts/detect-bend.ts` from
   *  the drum/bass profile JSONs + the chord stream (any subset when only
   *  some analyses exist). Absent → no markers. */
  detected?: Partial<StyleProfile>;
  /** Dismissed/acknowledged one-shot suggestion cards, keyed by a stable id
   *  (e.g. a mode-inference candidate: `"<sectionId>:<candidateId>"`). When a
   *  key is present and true, that suggestion is never shown again for the
   *  song. Records intent ("keep this borrowed") so a teaching moment doesn't
   *  nag. Absent → nothing has been acknowledged. */
  blueprintAcks?: Record<string, boolean>;
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
