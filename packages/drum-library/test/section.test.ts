import { describe, it, expect } from "vitest";
import {
  euclidOnsetSteps,
  euclidPatternNotes,
  applyVoiceOverrides,
  applyVariation,
  applySectionTransition,
  planSectionDrumNotes,
  type OutlineWithVoices,
  type SectionDrumInput,
  type TiledNote,
} from "../src/section.js";
import type { PackedVariant } from "../src/presetData.js";
import type { FillLibrary } from "../src/handoffs.js";
import type { DrumBlock } from "../src/blocks.js";

const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;

/** A minimal one-bar 4/4 groove: kick on 0/2, snare on 1/3. */
const BASE: PackedVariant = {
  lengthBeats: 4,
  beatsPerBar: 4,
  notes: [
    [0, KICK, 100],
    [1, SNARE, 90],
    [2, KICK, 100],
    [3, SNARE, 90],
  ],
  source: { origin: "egmd" },
};

const EMPTY_FILLS: FillLibrary = { acoustic: {}, synth: {} };

const SEVEN_EIGHT: OutlineWithVoices = { cellBeats: 0.5, cells: [2, 2, 3], label: "1 2 1 2 1 2 3" };

describe("euclidOnsetSteps", () => {
  it("spreads k onsets as evenly as possible across n steps", () => {
    expect(euclidOnsetSteps({ k: 3, n: 7, rotation: 0 })).toEqual([0, 2, 5]);
  });

  it("cyclically shifts by rotation", () => {
    expect(euclidOnsetSteps({ k: 2, n: 4, rotation: 1 })).toEqual([1, 3]);
  });
});

describe("euclidPatternNotes", () => {
  it("places hits at stepBeats = loopBeats / n across the loop", () => {
    const notes = euclidPatternNotes({ k: 2, n: 4, rotation: 0 }, "kick", { loopBeats: 4 });
    // steps [0, 2] × stepBeats 1 → beats 0 and 2
    expect(notes.map(([beat]) => beat)).toEqual([0, 2]);
    expect(notes.every(([, pitch]) => pitch === KICK)).toBe(true);
    expect(notes.every(([, , v]) => v === 100)).toBe(true);
  });
});

describe("applyVoiceOverrides", () => {
  it("replaces the overridden voice's notes with its Euclidean pattern, keeping other voices", () => {
    const out = applyVoiceOverrides(BASE, { kick: { k: 1, n: 4, rotation: 0 } }, { loopBeats: 4 });
    // base had kicks on 0 and 2 — the override collapses them to a single hit on 0
    expect(out.notes.filter(([, p]) => p === KICK)).toEqual([[0, KICK, 100]]);
    // snare untouched
    expect(out.notes.filter(([, p]) => p === SNARE)).toEqual([
      [1, SNARE, 90],
      [3, SNARE, 90],
    ]);
  });

  it("returns the base untouched when there are no overrides", () => {
    expect(applyVoiceOverrides(BASE, {})).toBe(BASE);
  });
});

describe("applyVariation", () => {
  it("splices the detour into the section's final bar, leaving the first bar intact", () => {
    const tiled: TiledNote[] = [
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 1, pitch: SNARE, velocity: 90 },
      { beat: 2, pitch: KICK, velocity: 100 },
      { beat: 3, pitch: SNARE, velocity: 90 },
      // second tile of the base groove (would be beats 4..7)
      { beat: 4, pitch: KICK, velocity: 100 },
      { beat: 5, pitch: SNARE, velocity: 90 },
      { beat: 6, pitch: KICK, velocity: 100 },
      { beat: 7, pitch: SNARE, velocity: 90 },
    ];
    const out = applyVariation(tiled, SEVEN_EIGHT, 1, { durationBeats: 8, barBeats: 4, velocityTarget: 100 });

    const kept = out.filter((n) => n.beat < 4);
    expect(kept).toEqual(tiled.slice(0, 4)); // first bar is untouched

    const tail = out.filter((n) => n.beat >= 4);
    // the 7/8 click detour replaced the last bar entirely
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((n) => n.beat >= 4 && n.beat < 8)).toBe(true);
    expect(tail.every((n) => n.pitch === CLOSED_HAT)).toBe(true);
  });

  it("splices the detour at a custom start beat, keeping the base groove on BOTH sides", () => {
    const tiled: TiledNote[] = [
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 1, pitch: SNARE, velocity: 90 },
      { beat: 2, pitch: KICK, velocity: 100 },
      { beat: 3, pitch: SNARE, velocity: 90 },
      { beat: 4, pitch: KICK, velocity: 100 },
      { beat: 5, pitch: SNARE, velocity: 90 },
      { beat: 6, pitch: KICK, velocity: 100 },
      { beat: 7, pitch: SNARE, velocity: 90 },
    ];
    const out = applyVariation(tiled, SEVEN_EIGHT, 1, {
      durationBeats: 8,
      barBeats: 4,
      velocityTarget: 100,
      variationStartBeat: 2,
    });

    // base groove kept before the detour (0..1) and after it (6..7)
    expect(out.filter((n) => n.beat < 2)).toEqual(tiled.slice(0, 2));
    expect(out.filter((n) => n.beat >= 6)).toEqual(tiled.slice(6, 8));
    // the detour fills 2..5 with closed hats
    const detour = out.filter((n) => n.beat >= 2 && n.beat < 6);
    expect(detour.length).toBeGreaterThan(0);
    expect(detour.every((n) => n.pitch === CLOSED_HAT)).toBe(true);
  });

  it("clamps an out-of-range start beat to the section edge", () => {
    const tiled: TiledNote[] = [
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 1, pitch: SNARE, velocity: 90 },
      { beat: 4, pitch: KICK, velocity: 100 },
      { beat: 5, pitch: SNARE, velocity: 90 },
    ];
    // startBeat 7 would overrun the 8-beat section → clamped back to the end
    const out = applyVariation(tiled, SEVEN_EIGHT, 1, {
      durationBeats: 8,
      barBeats: 4,
      velocityTarget: 100,
      variationStartBeat: 7,
    });
    expect(out.filter((n) => n.beat < 4)).toEqual(tiled.slice(0, 2));
  });

  it("is a no-op without a detour", () => {
    const tiled: TiledNote[] = [{ beat: 0, pitch: KICK, velocity: 100 }];
    expect(applyVariation(tiled, null, 1, { durationBeats: 8, barBeats: 4, velocityTarget: 100 })).toBe(tiled);
  });
});

describe("applySectionTransition", () => {
  it("cut replaces the tail bar with a single kick+snare hit, then silence", () => {
    const tiled: TiledNote[] = [
      { beat: 0, pitch: KICK, velocity: 100 },
      { beat: 1, pitch: SNARE, velocity: 90 },
      { beat: 4, pitch: KICK, velocity: 100 },
      { beat: 5, pitch: SNARE, velocity: 90 },
    ];
    const out = applySectionTransition(tiled, {
      model: "cut",
      transitionBars: 1,
      durationBeats: 8,
      variant: BASE,
      velocityTarget: 100,
    });
    const tail = out.filter((n) => n.beat >= 4);
    expect(tail).toEqual([
      { beat: 4, pitch: KICK, velocity: 100 },
      { beat: 4, pitch: SNARE, velocity: 100 },
    ]);
  });
});

describe("planSectionDrumNotes", () => {
  it("applies per-voice overrides to the exported notes", () => {
    const inputs: SectionDrumInput[] = [
      {
        sectionId: "s1",
        occurrenceIndex: 0,
        variant: BASE,
        voiceOverrides: { kick: { k: 1, n: 4, rotation: 0 } },
        durationBeats: 4,
        velocityTarget: 100,
      },
    ];
    const [plan] = planSectionDrumNotes(inputs, EMPTY_FILLS);
    expect(plan.notes.filter((n) => n.pitch === KICK)).toEqual([{ beat: 0, pitch: KICK, velocity: 100 }]);
    expect(plan.notes.filter((n) => n.pitch === SNARE)).toHaveLength(2);
  });

  it("splices a variation detour into the tail of the exported notes", () => {
    const inputs: SectionDrumInput[] = [
      {
        sectionId: "s1",
        occurrenceIndex: 0,
        variant: BASE, // tiled to 2 bars (8 beats)
        variation: SEVEN_EIGHT,
        variationBars: 1,
        durationBeats: 8,
        velocityTarget: 100,
      },
    ];
    const [plan] = planSectionDrumNotes(inputs, EMPTY_FILLS);
    const tail = plan.notes.filter((n) => n.beat >= 4);
    // the detour's closed-hat clicks replaced the second bar
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((n) => n.pitch === CLOSED_HAT)).toBe(true);
    // first bar still has the base groove
    expect(plan.notes.some((n) => n.beat < 4 && n.pitch === KICK)).toBe(true);
  });

  it("splices a variation detour at a custom start beat through the pipeline", () => {
    const inputs: SectionDrumInput[] = [
      {
        sectionId: "s1",
        occurrenceIndex: 0,
        variant: BASE,
        variation: SEVEN_EIGHT,
        variationBars: 1,
        variationStartBeat: 2,
        durationBeats: 8,
        velocityTarget: 100,
      },
    ];
    const [plan] = planSectionDrumNotes(inputs, EMPTY_FILLS);
    const detour = plan.notes.filter((n) => n.beat >= 2 && n.beat < 6);
    expect(detour.length).toBeGreaterThan(0);
    expect(detour.every((n) => n.pitch === CLOSED_HAT)).toBe(true);
    // base groove present on BOTH sides of the mid-section detour
    expect(plan.notes.some((n) => n.beat < 2 && n.pitch === KICK)).toBe(true);
    expect(plan.notes.some((n) => n.beat >= 6 && n.pitch === KICK)).toBe(true);
  });

  it("an explicit transition wins over the automatic handoff fill for the same span", () => {
    const inputs: SectionDrumInput[] = [
      {
        sectionId: "a",
        occurrenceIndex: 0,
        variant: BASE,
        transitionModel: "cut",
        transitionBars: 1,
        durationBeats: 8,
        velocityTarget: 100,
      },
      {
        sectionId: "b",
        occurrenceIndex: 0,
        variant: BASE,
        durationBeats: 4,
        velocityTarget: 100,
      },
    ];
    const fills: FillLibrary = {
      acoustic: {
        "4": [
          {
            lengthBeats: 4,
            beatsPerBar: 4,
            notes: [[6, 47, 100]], // a tom that would normally land in the fill span
            source: { origin: "egmd" },
          },
        ],
      },
      synth: {},
    };
    const [first] = planSectionDrumNotes(inputs, fills);
    // The automatic fill would have put a tom at beat 6; the cut removed it.
    expect(first.notes.some((n) => n.pitch === 47)).toBe(false);
    expect(first.notes.filter((n) => n.beat >= 4)).toEqual([
      { beat: 4, pitch: KICK, velocity: 100 },
      { beat: 4, pitch: SNARE, velocity: 100 },
    ]);
  });
});

describe("planSectionDrumNotes — blocks-only (null-variant) sections", () => {
  const snareEuclid: DrumBlock = {
    id: "b1",
    lane: "snare",
    startBeat: 0,
    endBeat: 4,
    mode: "euclid",
    euclid: { k: 2, n: 8, rotation: 0 },
  };

  it("compiles authored blocks over a muted base instead of exporting silence", () => {
    const inputs: SectionDrumInput[] = [
      {
        sectionId: "s1",
        occurrenceIndex: 0,
        variant: null, // drumPattern: "none" — the importer's empty base
        blocks: [snareEuclid],
        durationBeats: 4,
        velocityTarget: 100,
        gridBeats: 0.25,
      },
    ];
    const [plan] = planSectionDrumNotes(inputs, EMPTY_FILLS);
    // k=2, n=8 over 4 beats → steps 0/4 × stepBeats 0.5 = beats 0 and 2;
    // lane primary pitch (snare); velocityTarget — nothing to inherit over silence.
    expect(plan.notes).toEqual([
      { beat: 0, pitch: SNARE, velocity: 100 },
      { beat: 2, pitch: SNARE, velocity: 100 },
    ]);
  });

  it("stays silent — no crash, no fill — when a null-variant section has no blocks", () => {
    const inputs: SectionDrumInput[] = [
      { sectionId: "a", occurrenceIndex: 0, variant: BASE, role: "verse", durationBeats: 4, velocityTarget: 100 },
      { sectionId: "s1", occurrenceIndex: 0, variant: null, durationBeats: 4, velocityTarget: 100 },
    ];
    const plans = planSectionDrumNotes(inputs, EMPTY_FILLS);
    expect(plans[1].notes).toEqual([]);
  });

  it("anchors a motion block with beatsPerBar (explicit 4 === the default)", () => {
    const motion: DrumBlock = {
      id: "m1",
      lane: "kick",
      startBeat: 0,
      endBeat: 8,
      mode: "motion",
      motion: { x: 0.5, y: 0.5 },
    };
    const base: SectionDrumInput = {
      sectionId: "s1",
      occurrenceIndex: 0,
      variant: null,
      blocks: [motion],
      durationBeats: 8,
      velocityTarget: 100,
      gridBeats: 0.25,
    };
    const [explicit] = planSectionDrumNotes([{ ...base, beatsPerBar: 4 }], EMPTY_FILLS);
    const [fallback] = planSectionDrumNotes([base], EMPTY_FILLS);
    expect(explicit.notes.length).toBeGreaterThan(0);
    expect(explicit.notes.every((n) => n.beat >= 0 && n.beat < 8)).toBe(true);
    expect(explicit.notes).toEqual(fallback.notes);
  });

  it("an inherit-only section stays silent — there are no base notes to carry FX", () => {
    const inherit: DrumBlock = {
      id: "i1",
      lane: "hat",
      startBeat: 0,
      endBeat: 4,
      mode: "inherit",
      fx: { swing: 0.5 },
    };
    const [plan] = planSectionDrumNotes(
      [{ sectionId: "s1", occurrenceIndex: 0, variant: null, blocks: [inherit], durationBeats: 4, velocityTarget: 100 }],
      EMPTY_FILLS,
    );
    expect(plan.notes).toEqual([]);
  });
});
