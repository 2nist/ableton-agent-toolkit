import type { SectionRole, VelocityPreset } from "@music-theory/song-structure";
import type { NoteName, ScaleType } from "@music-theory/core";

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
   *  free text (e.g. blues.json's "HARMONIC BLUEPRINT" or neo-soul's
   *  "bIII7 to bII7"). Chord quality/extension suffixes can be appended
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
}

/** Song-level defaults a map may establish. `concept` doubles as the
 *  drum engine's style signal — its keyword scan is what routes a song
 *  acoustic vs. electronic — so genre maps should describe their sound
 *  here in plain language rather than via any genre enum. */
export interface SongMapDefaults {
  bpm?: number;
  key?: NoteName;
  scale?: ScaleType;
  concept?: string;
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
  {
    id: "math-rock-78",
    name: "Math Rock (7/8)",
    description: "Asymmetric-meter loop with a mid-song 4/4 deception. Exercises the odd-meter drum engine.",
    defaults: {
      bpm: 142,
      key: "C",
      scale: "ionian",
      concept:
        "Angular math rock in 7/8 — clean finger-tapped guitars, interlocking parts, tight conversational pocket, one deceptive pivot to straight time.",
    },
    slots: [
      {
        role: "intro",
        label: "Bright Tapping Intro",
        purpose:
          "FEEL: Jittery, expectant, suspended. TRICK: keep the kit out for the first bars — let dry finger-tapping carry the metric ambiguity before the drums confirm the 7.",
        bars: 8,
        velocity: "mp",
        beatsPerChord: 3.5,
        timeSignatureNumerator: 7,
        timeSignatureDenPower: 3,
      },
      {
        role: "verse",
        label: "Interlocking Poly-Verse",
        purpose:
          "FEEL: Intricate, tight, conversational. Ghost notes and rim-shots accentuate the missing final eighth of every bar.",
        bars: 12,
        velocity: "mf",
        beatsPerChord: 4,
        timeSignatureNumerator: 7,
        timeSignatureDenPower: 3,
      },
      {
        role: "bridge",
        label: "The Metric Deception",
        purpose:
          "FEEL: Floating and wide. TRICK: sudden pivot to straight 4/4 while melodic phrases keep their 7-beat length, displacing the downbeat.",
        bars: 4,
        velocity: "p",
        beatsPerChord: 2,
        timeSignatureNumerator: 4,
        timeSignatureDenPower: 2,
      },
      {
        role: "chorus",
        label: "Explosive Math Climax",
        purpose:
          "FEEL: Urgent, mathematically intense. Hats give way to open ride wash; everything lands harder without getting faster.",
        bars: 16,
        velocity: "f",
        beatsPerChord: 3.5,
        timeSignatureNumerator: 7,
        timeSignatureDenPower: 3,
      },
    ],
  },
  {
    id: "stoner-sludge",
    name: "Stoner / Sludge",
    description: "Slow, monolithic riff-rock arc: loom, drag, dissolve, crush.",
    defaults: {
      bpm: 74,
      key: "C",
      scale: "aeolian",
      concept:
        "Fuzz-saturated stoner rock — down-tuned monolithic riffs, drums dragging behind the beat, a psychedelic void in the middle, ending on a hard stop.",
    },
    slots: [
      {
        role: "intro",
        label: "Fuzz-Saturated Intro",
        purpose:
          "FEEL: Looming and ancient. TRICK: one down-tuned riff alone; let the last bar ring with amp hum before the kit lands.",
        bars: 4,
        velocity: "mf",
        beatsPerChord: 8,
      },
      {
        role: "verse",
        label: "The Monolithic Pocket",
        purpose:
          "FEEL: Deliberate, exhausting, behind the grid. The corpus grooves' laid-back push is the point — do not quantize.",
        bars: 8,
        velocity: "f",
        beatsPerChord: 4,
      },
      {
        role: "breakdown",
        label: "The Psychedelic Void",
        purpose:
          "FEEL: Hallucinatory and spatial. Heavy rhythm cuts out; sparse cymbal scrapes and deep floor-tom strikes under bleeding vocal delays.",
        bars: 8,
        velocity: "mp",
        beatsPerChord: 8,
      },
      {
        role: "outro",
        label: "The Wall of Riffs",
        purpose:
          "FEEL: Crushing, infinite momentum. TRICK: no fade — cut everything clean on beat one of an unresolved root chord.",
        bars: 8,
        velocity: "fff",
        beatsPerChord: 4,
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
