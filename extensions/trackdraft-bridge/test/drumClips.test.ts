import { describe, expect, it } from "vitest";
import type { DrumPattern, PackedPreset, PackedVariant } from "@drum/library";
import { planDrumClips, type FillLibrary } from "../src/drumClips.js";
import { makeSection, makeSong } from "./helpers.js";

const KICK = 36;
const SNARE = 38;
const TOM_HIGH = 47;
const CRASH = 49;

/**
 * Tiny fixture presets standing in for the real merged `PRESET_DATA` — see
 * the note on `planDrumClips`'s `presetData` parameter for why tests don't
 * assert against actual baked/synthesized content. Patterns are keyed to
 * what `inferDrumPattern` resolves for the sections each test builds:
 * a `custom`/`mf` section lands on `standard`, `chorus`/`ff` on `intense`,
 * and so on.
 */
function fixturePresets(overrides: Partial<Record<DrumPattern, PackedPreset>> = {}) {
  const variant = (notes: [number, number, number][], lengthBeats = 4, beatsPerBar = 4): PackedVariant => ({
    lengthBeats,
    beatsPerBar,
    notes,
    source: { origin: "egmd" },
  });

  const standard: PackedPreset = {
    variants: [
      variant([
        [0, KICK, 100],
        [1, SNARE, 90],
        [2, KICK, 100],
        [3, SNARE, 90],
      ]),
      variant([
        [0, KICK, 110],
        [1.5, SNARE, 60],
        [2, KICK, 110],
        [3.5, SNARE, 60],
      ]),
    ],
  };
  return { standard, ...overrides };
}

const emptyFills: FillLibrary = { acoustic: {}, synth: {} };

function fixtureFills(): FillLibrary {
  return {
    acoustic: {
      "4": [
        {
          lengthBeats: 4,
          beatsPerBar: 4,
          notes: [
            [2, TOM_HIGH, 80],
            [3, TOM_HIGH, 100],
            [3.5, SNARE, 110],
          ],
          source: { origin: "egmd" },
        },
      ],
    },
    synth: {},
  };
}

describe("planDrumClips — heuristic selection", () => {
  it("tiles the inferred pattern's variant to fill the section", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Verse 1", bars: 2, timeSignatureNumerator: 4 })],
    });
    const [clip] = planDrumClips(song, fixturePresets(), emptyFills);
    expect(clip.durationBeats).toBe(8);
    const kicks = clip.notes.filter((n) => n.pitch === KICK).map((n) => n.startTime);
    expect(kicks).toEqual(expect.arrayContaining([0, 2, 4, 6]));
  });

  it("is deterministic for the same song", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "same-id", name: "Verse 1", bars: 2, timeSignatureNumerator: 4 })],
    });
    const a = planDrumClips(song, fixturePresets(), emptyFills);
    const b = planDrumClips(song, fixturePresets(), emptyFills);
    expect(a[0].notes).toEqual(b[0].notes);
  });

  it("maps a loud chorus to 'intense', not the verse pattern", () => {
    const intense: PackedPreset = {
      variants: [{ lengthBeats: 4, beatsPerBar: 4, notes: [[0, TOM_HIGH, 120]], source: { origin: "egmd" } }],
    };
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Chorus", role: "chorus", velocity: "ff", bars: 1, timeSignatureNumerator: 4 }),
      ],
    });
    const [clip] = planDrumClips(song, fixturePresets({ intense }), emptyFills);
    expect(clip.notes.some((n) => n.pitch === TOM_HIGH)).toBe(true);
    expect(clip.notes.some((n) => n.pitch === KICK)).toBe(false);
  });

  it("ignores the legacy drumPattern field entirely", () => {
    const dnb: PackedPreset = {
      variants: [{ lengthBeats: 4, beatsPerBar: 4, notes: [[0, TOM_HIGH, 120]], source: { origin: "synth" } }],
    };
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        // Legacy blueprints carry drumPattern; the role/velocity say "standard".
        makeSection({ id: "1", name: "Verse", bars: 1, timeSignatureNumerator: 4, drumPattern: "dnb" }),
      ],
    });
    const [clip] = planDrumClips(song, fixturePresets({ dnb }), emptyFills);
    expect(clip.notes.some((n) => n.pitch === KICK)).toBe(true);
    expect(clip.notes.some((n) => n.pitch === TOM_HIGH)).toBe(false);
  });

  it("a 7/8 section now gets a 7/8 groove instead of an empty clip", () => {
    const seventyEight: PackedPreset = {
      variants: [
        {
          lengthBeats: 3.5,
          beatsPerBar: 3.5,
          notes: [
            [0, KICK, 110],
            [1, SNARE, 100],
            [2, KICK, 104],
          ],
          source: { origin: "synth" },
        },
      ],
    };
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Odd", bars: 2, timeSignatureNumerator: 7, timeSignatureDenPower: 3 })],
    });
    const [clip] = planDrumClips(song, fixturePresets({ "78": seventyEight }), emptyFills);
    expect(clip.notes.length).toBeGreaterThan(0);
    // Second bar starts at 3.5 quarter-note beats, not 4.
    expect(clip.notes.map((n) => n.startTime)).toContain(3.5);
  });

  it("an electronic song routes to the machine idioms", () => {
    const fourOnFloor: PackedPreset = {
      variants: [
        {
          lengthBeats: 4,
          beatsPerBar: 4,
          notes: [
            [0, KICK, 120],
            [1, KICK, 116],
            [2, KICK, 116],
            [3, KICK, 116],
          ],
          source: { origin: "synth" },
        },
      ],
    };
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 126,
      concept: "late night techno for empty clubs",
      sections: [makeSection({ id: "1", name: "Verse", role: "verse", bars: 1, timeSignatureNumerator: 4 })],
    });
    const [clip] = planDrumClips(song, fixturePresets({ four_on_floor: fourOnFloor }), emptyFills);
    const kicks = clip.notes.filter((n) => n.pitch === KICK).map((n) => n.startTime);
    expect(kicks).toEqual([0, 1, 2, 3]);
  });

  it("produces an empty clip rather than throwing when no preset data matches", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Verse", bars: 1, timeSignatureNumerator: 4 })],
    });
    const [clip] = planDrumClips(song, {}, emptyFills);
    expect(clip.notes).toHaveLength(0);
    expect(clip.durationBeats).toBe(4);
  });
});

describe("planDrumClips — repeated sections (via arrangement) get varied, not identical, drums", () => {
  it("a section's first occurrence is byte-identical to a non-repeated section with the same id (backward compat)", () => {
    const solo = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "c", name: "Chorus", bars: 8, timeSignatureNumerator: 4 })],
    });
    const repeatedOnce = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "c", name: "Chorus", bars: 8, timeSignatureNumerator: 4 })],
      arrangement: [{ sectionId: "c", repeats: 1 }],
    });
    expect(planDrumClips(repeatedOnce, fixturePresets(), emptyFills)).toEqual(
      planDrumClips(solo, fixturePresets(), emptyFills),
    );
  });

  it("two occurrences of a repeated section render audibly different drums, not a copy-paste repeat", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "c", name: "Chorus", bars: 8, timeSignatureNumerator: 4 })],
      arrangement: [{ sectionId: "c", repeats: 2 }],
    });
    const [first, second] = planDrumClips(song, fixturePresets(), emptyFills);
    expect(first.notes).not.toEqual(second.notes);
  });
});

describe("planDrumClips — dynamics", () => {
  it("scales a groove's peak to the section's velocity preset without flattening dynamics", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "1", name: "Custom", velocity: "ff", bars: 1, timeSignatureNumerator: 4, role: "custom" }),
      ],
    });
    // custom+ff maps to 'driving' — supply it with a spread of velocities.
    const driving: PackedPreset = {
      variants: [
        {
          lengthBeats: 4,
          beatsPerBar: 4,
          notes: [
            [0, KICK, 100],
            [1, SNARE, 90],
          ],
          source: { origin: "egmd" },
        },
      ],
    };
    const [clip] = planDrumClips(song, fixturePresets({ driving }), emptyFills);
    const velocities = clip.notes.map((n) => n.velocity ?? 0);
    expect(Math.max(...velocities)).toBe(120);
    expect(new Set(velocities).size).toBeGreaterThan(1);
  });

  it("scales down for a quiet section", () => {
    // custom+pp maps to 'bridge_sparse' — supply it so the quiet path resolves.
    const bridgeSparse: PackedPreset = {
      variants: [{ lengthBeats: 4, beatsPerBar: 4, notes: [[0, KICK, 127]], source: { origin: "egmd" } }],
    };
    const quiet = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "V", bars: 1, timeSignatureNumerator: 4, velocity: "pp" })],
    });
    const [clip] = planDrumClips(quiet, fixturePresets({ bridge_sparse: bridgeSparse }), emptyFills);
    expect(Math.max(...clip.notes.map((n) => n.velocity ?? 0))).toBeLessThanOrEqual(48);
  });

  it("gives every note a short, un-sustained duration", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "1", name: "Verse", bars: 1, timeSignatureNumerator: 4 })],
    });
    const [clip] = planDrumClips(song, fixturePresets(), emptyFills);
    expect(clip.notes.every((n) => n.duration === 0.25)).toBe(true);
  });
});

describe("planDrumClips — fills and transitions", () => {
  // Both sections stay in `custom` roles that resolve to the `standard`
  // fixture ("f" ranks below the loud threshold, so it still maps there).
  function twoSections(firstBars: number, secondVelocity: "mf" | "f" | "pp" = "mf") {
    return makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [
        makeSection({ id: "a", name: "Verse", bars: firstBars, timeSignatureNumerator: 4 }),
        makeSection({ id: "b", name: "Next", bars: 2, timeSignatureNumerator: 4, velocity: secondVelocity }),
      ],
    });
  }

  it("replaces the last bar of a section with a fill when handing off", () => {
    const [first] = planDrumClips(twoSections(2), fixturePresets(), fixtureFills());
    // Groove notes in the final bar (beats 4..8) are gone; fill notes are there.
    const lastBar = first.notes.filter((n) => n.startTime >= 4);
    expect(lastBar.some((n) => n.pitch === TOM_HIGH)).toBe(true);
    // The fill's tom hits land relative to the fill start (beat 4).
    expect(lastBar.map((n) => n.startTime)).toEqual(expect.arrayContaining([6, 7, 7.5]));
  });

  it("opens the following section with a crash", () => {
    const [, second] = planDrumClips(twoSections(2), fixturePresets(), fixtureFills());
    const opener = second.notes.find((n) => n.pitch === CRASH && n.startTime === 0);
    expect(opener).toBeDefined();
  });

  it("builds the fill toward a louder next section", () => {
    const [first] = planDrumClips(twoSections(2, "f"), fixturePresets(), fixtureFills());
    const fillPeak = Math.max(...first.notes.filter((n) => n.startTime >= 4).map((n) => n.velocity ?? 0));
    expect(fillPeak).toBe(112); // the next section's f target, not this section's mf
  });

  it("skips the fill when the section is too short to give up a bar", () => {
    const clips = planDrumClips(twoSections(1), fixturePresets(), fixtureFills());
    expect(clips[0].notes.some((n) => n.pitch === TOM_HIGH)).toBe(false);
    // And with no fill, the next section gets no crash either.
    expect(clips[1].notes.some((n) => n.pitch === CRASH && n.startTime === 0)).toBe(false);
  });

  it("the last section never gets a fill — there is nothing to hand off to", () => {
    const song = makeSong({
      id: "x",
      title: "x",
      bpm: 120,
      sections: [makeSection({ id: "only", name: "Verse", bars: 2, timeSignatureNumerator: 4 })],
    });
    const [clip] = planDrumClips(song, fixturePresets(), fixtureFills());
    expect(clip.notes.some((n) => n.pitch === TOM_HIGH)).toBe(false);
  });
});
