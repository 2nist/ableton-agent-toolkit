/**
 * Golden parity — the app's in-browser stems and the bridge's Ableton clip
 * plans must produce the SAME notes for the same blueprint, across every
 * stem (chords / bass / drums / color) and the drift-prone inputs (fast
 * bpm → dnb via the heuristic, odd meters, Euclidean drum outlines).
 *
 * The app and the bridge are separate packages that deliberately don't
 * depend on each other, so this test lives in the bridge suite and imports
 * the app's PURE stem planners by relative path. Vitest transpiles them;
 * the stem chain is browser-free (no DOM / Web Audio / React). The bridge's
 * `tsc --noEmit` build gate excludes this one file (`tsconfig.json`
 * `exclude`), because the app's source uses extensionless ESM relative
 * imports that NodeNext resolution rejects — the test still runs under
 * vitest (see commit that added it).
 *
 * Normalization: the bridge returns per-clip notes relative to each clip's
 * startBeat; the app returns flat song-absolute notes. We flatten the
 * bridge clips to absolute and sort both sides by (startTime, pitch,
 * duration, velocity) before comparing. NOTE: the app drops non-GM drum
 * pitches (its `GM_DRUM_PITCHES` filter) and the bridge currently does not
 * — the comparison is deliberately strict, so any fixture that produces a
 * non-GM pitch would flag that divergence instead of hiding it.
 */

import { describe, expect, it } from "vitest";

// App side — pure stem planners imported by relative path (see header).
import { planChordStem, planBassStem, planDrumStem } from "../../../apps/trackdraft/src/lib/midiExport";
import { planColorStem } from "../../../apps/trackdraft/src/lib/colorStem";
import { sectionSpans } from "../../../apps/trackdraft/src/lib/arrangement";

// Bridge side.
import { planChordClips } from "../src/chordClips.js";
import { planBassLine } from "../src/bassLine.js";
import { planDrumClips } from "../src/drumClips.js";
import { planColorClips } from "../src/colorClips.js";
import { makeSong, makeSection, makeChord } from "./helpers.js";
import { STYLE_RECIPES } from "@drum/library";
import type { BlueprintSong } from "../src/blueprint.js";

interface Note {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
}

const sortNotes = (notes: Note[]): Note[] =>
  [...notes].sort(
    (a, b) => a.startTime - b.startTime || a.pitch - b.pitch || a.duration - b.duration || a.velocity - b.velocity,
  );

/** Bridge clip plans → flat song-absolute notes (clip.startBeat + rel). */
const flattenClips = (clips: { startBeat: number; notes: Note[] }[]): Note[] =>
  clips.flatMap((clip) => clip.notes.map((n) => ({ ...n, startTime: clip.startBeat + n.startTime })));

// ---------------------------------------------------------------------------
// Fixtures — each exercises a drift-prone axis.
// ---------------------------------------------------------------------------

const CHORDS = [
  makeChord({ romanNumeral: "I", root: "C", quality: "maj", beats: 4 }),
  makeChord({ romanNumeral: "V", root: "G", quality: "maj", beats: 4 }),
  makeChord({ romanNumeral: "vi", root: "A", quality: "min", beats: 4 }),
  makeChord({ romanNumeral: "IV", root: "F", quality: "maj", beats: 4 }),
];

/** Plain 4/4 acoustic — the baseline. */
const acousticSong: BlueprintSong = makeSong({
  id: "parity-acoustic",
  title: "Parity Acoustic",
  bpm: 100,
  concept: "a reflective acoustic ballad",
  sections: [
    makeSection({ id: "verse", name: "Verse", role: "verse", bars: 4, timeSignatureNumerator: 4, velocity: "mf", chords: [CHORDS[0], CHORDS[1]] }),
    makeSection({ id: "chorus", name: "Chorus", role: "chorus", bars: 4, timeSignatureNumerator: 4, velocity: "f", chords: [CHORDS[2], CHORDS[3]] }),
  ],
  arrangement: [
    { sectionId: "verse", repeats: 1 },
    { sectionId: "chorus", repeats: 1 },
  ],
});

/** Fast electronic — bpm ≥ 160 must resolve dnb on BOTH sides (this is the
 *  infer-parity bug: the app used to pass only `concept` and previewed
 *  four_on_floor while the bridge arrived as dnb). */
const dnbSong: BlueprintSong = makeSong({
  id: "parity-dnb",
  title: "Neon Corridor",
  bpm: 170,
  concept: "club synthwave chase",
  sections: [
    makeSection({ id: "v", name: "Verse", role: "verse", bars: 4, timeSignatureNumerator: 4, velocity: "mf", chords: [CHORDS[0], CHORDS[1]] }),
  ],
  arrangement: [{ sectionId: "v", repeats: 1 }],
});

/** 7/8 odd meter via the heuristic (no outline) — "78" on both sides. */
const oddMeterSong: BlueprintSong = makeSong({
  id: "parity-78",
  title: "Limping Waltz",
  bpm: 140,
  concept: "odd-meter art rock",
  timeSignatureNumerator: 7,
  timeSignatureDenominator: 8,
  sections: [
    makeSection({ id: "m", name: "Math", role: "verse", bars: 4, timeSignatureNumerator: 7, timeSignatureDenPower: 3, velocity: "mf", chords: [CHORDS[0], CHORDS[1]] }),
  ],
  arrangement: [{ sectionId: "m", repeats: 1 }],
});

/** 7/8 with an explicit Euclidean drum outline — exercises the
 *  outline-variant + humanize path identically on both sides. */
const outlineSong: BlueprintSong = makeSong({
  id: "parity-outline",
  title: "Outline Groove",
  bpm: 120,
  concept: "odd-meter instrumental",
  timeSignatureNumerator: 7,
  timeSignatureDenominator: 8,
  sections: [
    makeSection({
      id: "o",
      name: "Outline",
      role: "chorus",
      bars: 4,
      timeSignatureNumerator: 7,
      timeSignatureDenPower: 3,
      velocity: "mf",
      chords: [CHORDS[0], CHORDS[1]],
      drumPattern: "standard", // irrelevant — the outline wins
      drumMeterOutline: { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" },
    }),
  ],
  arrangement: [{ sectionId: "o", repeats: 1 }],
});

/** The acoustic song with a whole-song "rock" Bend applied — proves the
 *  Bend wiring (style seed → variant, velocity scale, feel/backbeat note
 *  transforms, chord extension, spacing) produces IDENTICAL notes on the
 *  app side and the bridge. */
const bentSong: BlueprintSong = makeSong({
  id: "parity-bent",
  title: "Parity Bent",
  bpm: STYLE_RECIPES.rock.tempo,
  concept: "rock",
  genre: "rock", // the recipe sets genre too → Groove DNA drives family choice
  bend: STYLE_RECIPES.rock,
  sections: [
    makeSection({ id: "v", name: "Verse", role: "verse", bars: 4, timeSignatureNumerator: 4, velocity: "mf", chords: [CHORDS[0], CHORDS[1]] }),
    makeSection({ id: "c", name: "Chorus", role: "chorus", bars: 4, timeSignatureNumerator: 4, velocity: "f", chords: [CHORDS[2], CHORDS[3]] }),
  ],
  arrangement: [
    { sectionId: "v", repeats: 1 },
    { sectionId: "c", repeats: 1 },
  ],
});

/** A per-section override on top of a song master — the section's own bend
 *  must win on the axes it sets, and both sides must agree. */
const overrideSong: BlueprintSong = makeSong({
  id: "parity-override",
  title: "Parity Override",
  bpm: 120,
  concept: "pop",
  bend: { energy: 0.6, feel: 0.3 }, // master: mid energy, straighter
  sections: [
    makeSection({
      id: "bridge",
      name: "Bridge",
      role: "bridge",
      bars: 4,
      timeSignatureNumerator: 4,
      velocity: "p",
      chords: [CHORDS[0], CHORDS[1]],
      bend: { backbeat: 0.2, feel: 0.85 }, // section: soft backbeat, swung
    }),
  ],
  arrangement: [{ sectionId: "bridge", repeats: 1 }],
});

const SONGS: Record<string, BlueprintSong> = {
  acoustic: acousticSong,
  dnb: dnbSong,
  oddMeter: oddMeterSong,
  outline: outlineSong,
  bent: bentSong,
  override: overrideSong,
};

// ---------------------------------------------------------------------------
// The parity assertions.
// ---------------------------------------------------------------------------

describe("golden parity — app stems == bridge clips for the same blueprint", () => {
  for (const [name, song] of Object.entries(SONGS)) {
    describe(name, () => {
      const spans = sectionSpans(song);

      it("chords match", () => {
        const app = planChordStem(spans, song);
        const bridge = flattenClips(planChordClips(song));
        expect(sortNotes(app)).toEqual(sortNotes(bridge));
      });

      it("bass matches", () => {
        const app = planBassStem(spans, song);
        const bridge = flattenClips(planBassLine(song));
        expect(sortNotes(app)).toEqual(sortNotes(bridge));
      });

      it("drums match", () => {
        const app = planDrumStem(spans, song);
        const bridge = flattenClips(planDrumClips(song));
        expect(sortNotes(app)).toEqual(sortNotes(bridge));
      });

      it("color matches", () => {
        const app = planColorStem(spans, song);
        const bridge = flattenClips(planColorClips(song));
        expect(sortNotes(app)).toEqual(sortNotes(bridge));
      });
    });
  }
});
