import type { SectionRole, VelocityPreset } from "@music-theory/song-structure";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { NarrativeProfile } from "@music-theory/song-blueprint";

/** A single slot in a narrative structure template: which section role
 *  goes here, and what its dramatic purpose is (the "narrative prompter"
 *  idea from TrackDraft's original docs — a guided prompt per section,
 *  not just a bare role label). This is a fresh design (the original's
 *  actual PEC/Journey template definitions are lost along with its
 *  source), informed only by the "How To Write Songs" Seven-Step
 *  Formula's general shape, not a verified port.
 *
 *  The optional musical fields let a genre map shape more than narrative:
 *  bars, dynamics, per-section meter, chord movement, and rhythmic feel.
 *  They matter doubly since drums went heuristic — role + velocity + meter
 *  are exactly the signals the Ableton extension reads, so a map that
 *  sets them is effectively programming the drum arrangement without any
 *  drum-specific field. Slots never carry ids: sections are minted fresh
 *  per apply (ids seed deterministic generation downstream, so reused
 *  ids would make every song stamped from one template generate
 *  identical parts). */
export interface MapSlot {
  role: SectionRole;
  label: string;
  purpose: string;
  bars?: number;
  velocity?: VelocityPreset;
  beatsPerChord?: number;
  timeSignatureNumerator?: number;
  /** Denominator as a power of two, matching BlueprintSection (2 = /4, 3 = /8). */
  timeSignatureDenPower?: number;
  /** Roman-numeral chord cycle for this section, relative to the map's
   *  (or variant's) key/scale — e.g. ["i", "bVI", "bVII", "i"]. Case
   *  signals triad quality (uppercase = major, lowercase = minor) and a
   *  leading "b"/"#" signals the root's distance from the parallel major
   *  scale, matching how the exemplar prompts already describe chords in
   *  free text (e.g. blues-12bar.json's "HARMONIC BLUEPRINT" or
   *  neo-soul-modal.json's "bIII7 to bII7"). Chord quality/extension suffixes can be appended
   *  directly (e.g. "V7", "ii7b5", "IVmaj7"); a chord that's
   *  intentionally borrowed/chromatic relative to the stated scale
   *  (e.g. a jazz backdoor "iv7" in a major key) is written in its
   *  actual sounding quality, not the diatonic one.
   *  The chord generator loops this cycle to fill the section's bars at
   *  the rate set by beatsPerChord — it's a repeating cell, not a
   *  bar-by-bar transcription. Omit for slots with no distinct harmonic
   *  identity; the generator falls back to walking the scale as it does
   *  today. */
  progression?: string[];
  /** Short, keyword-rich prose describing this section's beat/rhythm
   *  character — keyword-scanned by the drum engine the same way
   *  `concept` is, but scoped to this slot so the pattern can change
   *  section to section (e.g. "four-on-the-floor, no swing, gated snare
   *  on 2 and 4" vs. "half-time trap hats with triplet rolls"). This is
   *  where the drum-pattern prose that used to get folded into `purpose`
   *  (see the existing catalog's "TRICK:" lines) belongs instead, so
   *  `purpose` can stay focused on FEEL and non-rhythmic production
   *  moves. */
  groove?: string;
  /** Swing/shuffle amount applied to this section's subdivision, 0-100
   *  (0 = fully straight, ~58-67 = triplet swing, negative-feeling
   *  "drag" pockets are described in `groove` instead since this field
   *  is magnitude-only). Omit for straight time. */
  swing?: number;
  /** Marks this section as safe to drop for a shorter arrangement (e.g.
   *  a radio edit) without breaking the song's arc. Consumers that don't
   *  render short-edit mode can ignore this and treat the section as
   *  always included, matching today's behavior. */
  optional?: boolean;
  /** How this section's chord changes are timed. `"beats"` (default) is
   *  the classic per-chord beat grid; `"euclid"` advances chords on a
   *  2s/3s Euclidean outline built from this slot's own time signature
   *  (see `harmonyCellCount`/`harmonyRotation`); `"follow drums"` rides
   *  the section's drum outline. Mirrors the Harmony tab's Rhythm control
   *  so a template can program the harmony arrangement the same way
   *  `groove`/`velocity` already program the drums. */
  harmonyRhythm?: "beats" | "euclid" | "follow drums";
  /** Euclidean density (number of 2s/3s cells) for
   *  `harmonyRhythm: "euclid"` — the tresillo 3 in 7/8, etc. Defaults to
   *  the meter's canonical first grouping, the same default the Harmony
   *  tab uses. */
  harmonyCellCount?: number;
  /** Cyclic rotation (0..cellCount-1) for `harmonyRhythm: "euclid"` —
   *  which 2s/3s cell reads first. */
  harmonyRotation?: number;
  /** Anticipation offset in beats — pushes every chord change EARLY by
   *  this much (0.25 = a sixteenth). Mirrors the Harmony tab's Push
   *  control. */
  syncopationOffset?: number;
  /** Relative narrative parameters — the abstract "lyrical arc" this slot
   *  carries (see `NarrativeProfile`). Applied as the section's `narrative`
   *  on template apply so the translation middleware can tint this subgenre
   *  map's concrete vocabulary per-slot. */
  narrative?: NarrativeProfile;
}

/** Song-level defaults a map may establish. `concept` is the primary drum
 *  engine signal — its keyword scan routes a song acoustic vs. electronic —
 *  so genre maps describe their sound here in plain language. `genre` is
 *  the newer, stronger channel for genres that ARE one of the drum engine's
 *  eight families: it keys `GENRE_GROOVES`/`STYLE_RECIPES` directly,
 *  `applySongMap` writes it to `song.genre` on apply, and the Structure
 *  picker can optionally seed the Bend sliders from the matching style
 *  recipe (never automatically — opt-in per apply). */
export interface SongMapDefaults {
  bpm?: number;
  key?: NoteName;
  scale?: ScaleType;
  concept?: string;
  /** Engine genre slug — one of `rock | pop | bossa | ballad | trap |
   *  house | neo-soul | math-rock` (the `GENRE_GROOVES` family-lean and
   *  `STYLE_RECIPES` key set; validated against `STYLE_RECIPES` in
   *  genre-prompt.ts). Set it only when the genre unambiguously matches
   *  an engine family — most catalog genres have no family and keep
   *  their drum identity in `concept`/`groove` prose instead. */
  genre?: string;
  /** Whole-song relative narrative master — the abstract "lyrical arc" the
   *  template sets at the song level, tinting every section that doesn't
   *  carry its own `narrative` override. */
  narrative?: NarrativeProfile;
}

/** A fully alternate section structure for a map — same song identity
 *  (tempo/key/concept still come from the map's `defaults`), different
 *  form. Added for genres that genuinely have more than one canonical
 *  shape (e.g. EBM's instrumental "club loop" vs. a vocal-hook,
 *  song-oriented cut) rather than forcing one map to average across
 *  both, or splitting them into two same-genre catalog entries. */
export interface SongMapVariant {
  name: string;
  description?: string;
  slots: MapSlot[];
}

export interface SongMap {
  id: string;
  name: string;
  description: string;
  slots: MapSlot[];
  defaults?: SongMapDefaults;
  /** Additional alternate structures beyond the primary `slots` above.
   *  `slots` remains the primary/default structure and is what any
   *  consumer that doesn't yet know about `variants` keeps using
   *  unchanged — this field is purely additive. */
  variants?: SongMapVariant[];
}

export const SONG_MAPS: SongMap[] = [
  {
    id: "classic-pop",
    name: "Classic Pop",
    description: "Straightforward verse/chorus/bridge form.",
    slots: [
      { role: "intro", label: "Intro", purpose: "Establish the sonic world before any words land." },
      { role: "verse", label: "Verse 1", purpose: "Set the scene — who, where, what's at stake." },
      { role: "chorus", label: "Chorus", purpose: "State the song's central idea, memorably." },
      { role: "verse", label: "Verse 2", purpose: "Deepen or complicate the scene from Verse 1." },
      { role: "chorus", label: "Chorus", purpose: "Restate the central idea, now with more context." },
      { role: "bridge", label: "Bridge", purpose: "Shift perspective or raise the stakes once." },
      { role: "chorus", label: "Chorus", purpose: "Final, most-earned statement of the idea." },
      { role: "outro", label: "Outro", purpose: "Let the idea settle; close the sonic world." },
    ],
  },
  {
    id: "pec",
    name: "PEC (Problem / Explore / Change)",
    description: "A three-act emotional arc mapped onto song form.",
    slots: [
      { role: "verse", label: "Verse 1 — Problem", purpose: "Name the problem or tension driving the song." },
      { role: "chorus", label: "Chorus", purpose: "The problem, stated as a hook." },
      { role: "verse", label: "Verse 2 — Explore", purpose: "Sit inside the problem; explore its texture." },
      { role: "chorus", label: "Chorus", purpose: "Same hook, now with more weight behind it." },
      { role: "bridge", label: "Bridge — Change", purpose: "The turn: a new realization or decision." },
      { role: "chorus", label: "Chorus", purpose: "The hook, recontextualized by the change." },
      { role: "outro", label: "Outro — Resolution", purpose: "Where things land after the change." },
    ],
  },
  {
    id: "journey",
    name: "Journey",
    description: "A departure-and-return narrative arc.",
    slots: [
      { role: "intro", label: "Intro — Departure", purpose: "The world before the journey begins." },
      { role: "verse", label: "Verse 1 — The Call", purpose: "What sets the journey in motion." },
      { role: "chorus", label: "Chorus — Commitment", purpose: "The decision to go." },
      { role: "verse", label: "Verse 2 — Trials", purpose: "Obstacles encountered along the way." },
      { role: "bridge", label: "Bridge — Crisis", purpose: "The lowest or most revealing point." },
      { role: "chorus", label: "Chorus — Return", purpose: "Coming back, changed." },
      { role: "outro", label: "Outro — Transformation", purpose: "Who they are now, having gone." },
    ],
  },
  // NOTE: the genre-flavored maps that used to live here (math-rock-78,
  // stoner-sludge) were retired 2026-09 — the genre catalog superseded
  // them with researched, richer versions (progressions/groove/
  // harmonyRhythm), and keeping both made the Templates tab show
  // near-identical duplicates. Genre maps live in data/genre-catalog;
  // SONG_MAPS is narrative/mood only.
  /* The three narrative archetypes. Unlike the forms above, the point of
     these is the ARC: every slot carries a `narrative` profile, so applying
     one (with `seedNarrative`) tints the subgenre's concrete vocabulary from
     section to section instead of only arranging it. The profiles are
     authored, not inferred — the layer deliberately has no fallback that
     guesses an arc from a section's role. */
  {
    id: "inverted-matrix",
    name: "Inverted Matrix",
    description:
      "The peak arrives first and the song spends itself getting quiet — a hook that opens cold, then decays through the rest of the form.",
    slots: [
      {
        role: "chorus",
        label: "Peak — Chorus",
        purpose: "Hit at full height with nothing earned yet. This is the loudest the song gets.",
        bars: 8,
        velocity: "ff",
        narrative: { tension_profile: 0.95, rhythmic_energy: 0.95, transition_delta: -0.25, structural_warp: 0.6 },
      },
      {
        role: "verse",
        label: "Aftermath — Verse 1",
        purpose: "The drop after the peak. Same harmony, most of the weight removed.",
        bars: 8,
        velocity: "mp",
        narrative: { tension_profile: 0.6, rhythmic_energy: 0.5, transition_delta: -0.1, structural_warp: 0.3 },
      },
      {
        role: "chorus",
        label: "Echo — Chorus",
        purpose: "The hook again, remembered rather than shouted.",
        bars: 8,
        velocity: "mf",
        narrative: { tension_profile: 0.5, rhythmic_energy: 0.55, transition_delta: 0, structural_warp: 0.2 },
      },
      {
        role: "verse",
        label: "Drift — Verse 2",
        purpose: "Texture without arrival; the song is now about the room, not the hook.",
        bars: 8,
        velocity: "p",
        narrative: { tension_profile: 0.3, rhythmic_energy: 0.3, transition_delta: -0.2, structural_warp: 0 },
      },
      {
        role: "outro",
        label: "Settle — Outro",
        purpose: "Land the idea and leave the machinery audible.",
        bars: 8,
        velocity: "pp",
        narrative: { tension_profile: 0.15, rhythmic_energy: 0.15, transition_delta: 0, structural_warp: 0 },
      },
    ],
  },
  {
    id: "vignette",
    name: "Vignette",
    description:
      "Self-contained scenes at one intensity — no build, no release. Each section changes colour without changing height.",
    slots: [
      {
        role: "verse",
        label: "Scene I",
        purpose: "One image, held. Do not build toward anything.",
        bars: 8,
        velocity: "mp",
        narrative: { tension_profile: 0.45, rhythmic_energy: 0.5, transition_delta: 0, structural_warp: 0 },
      },
      {
        role: "verse",
        label: "Scene II",
        purpose: "A neighbouring image at the same height; the change is colour, not dynamic.",
        bars: 8,
        velocity: "mp",
        narrative: { tension_profile: 0.55, rhythmic_energy: 0.5, transition_delta: 0, structural_warp: 0 },
      },
      {
        role: "chorus",
        label: "Scene III — Together",
        purpose: "The one moment the arrangement widens, then settles back rather than peaking.",
        bars: 8,
        velocity: "mf",
        narrative: { tension_profile: 0.55, rhythmic_energy: 0.55, transition_delta: 0.1, structural_warp: 0 },
      },
      {
        role: "verse",
        label: "Scene IV",
        purpose: "Back to the room you started in, one detail changed.",
        bars: 8,
        velocity: "mp",
        narrative: { tension_profile: 0.45, rhythmic_energy: 0.5, transition_delta: -0.1, structural_warp: 0 },
      },
      {
        role: "outro",
        label: "Scene V — Lens Out",
        purpose: "Widen to landscape and stop; no resolution, just a cut.",
        bars: 8,
        velocity: "p",
        narrative: { tension_profile: 0.4, rhythmic_energy: 0.4, transition_delta: 0, structural_warp: 0 },
      },
    ],
  },
  {
    id: "cyclical-loop",
    name: "Cyclical Loop",
    description:
      "One figure returning three times, each return more warped than the last — the harmony grid buckles as the loop tightens.",
    slots: [
      {
        role: "intro",
        label: "Loop A",
        purpose: "State the figure plainly. This is the version that has to be recognisable on the way back.",
        bars: 8,
        velocity: "mp",
        narrative: { tension_profile: 0.4, rhythmic_energy: 0.5, transition_delta: 0.1, structural_warp: 0 },
      },
      {
        role: "verse",
        label: "Loop B",
        purpose: "A second figure that answers A without resolving it.",
        bars: 8,
        velocity: "mp",
        narrative: { tension_profile: 0.45, rhythmic_energy: 0.55, transition_delta: 0.05, structural_warp: 0 },
      },
      {
        role: "chorus",
        label: "Loop A′",
        purpose: "A returns, now bent — the same figure at a different angle.",
        bars: 8,
        velocity: "mf",
        narrative: { tension_profile: 0.55, rhythmic_energy: 0.6, transition_delta: 0.15, structural_warp: 0.55 },
      },
      {
        role: "verse",
        label: "Loop B′",
        purpose: "B returns warped too; the two figures start to sound like one.",
        bars: 8,
        velocity: "f",
        narrative: { tension_profile: 0.6, rhythmic_energy: 0.65, transition_delta: 0.1, structural_warp: 0.7 },
      },
      {
        role: "outro",
        label: "Loop A″",
        purpose: "The figure fully distorted, held until it stops.",
        bars: 8,
        velocity: "mf",
        narrative: { tension_profile: 0.7, rhythmic_energy: 0.6, transition_delta: 0, structural_warp: 0.85 },
      },
    ],
  },
  {
    id: "minimal-loop",
    name: "Minimal / Ambient",
    description: "Long, evolving sections with little formal contrast — for mood pieces.",
    slots: [
      { role: "intro", label: "Section A", purpose: "Establish a texture and let it breathe." },
      { role: "verse", label: "Section B", purpose: "A related but distinct texture." },
      { role: "outro", label: "Section A'", purpose: "Return to A, altered by what came between." },
    ],
  },
];

export function getSongMap(id: string): SongMap | undefined {
  return SONG_MAPS.find((m) => m.id === id);
}
