import { describe, expect, it } from "vitest";
import { FILL_DATA, MAX_TOM_SHARE, PATTERN_DENSITY as DENSITY, PRESET_DATA } from "../src/presetData.js";
import { CURATED_PATTERNS } from "../src/synthesize.js";
import { planSectionDrumNotes } from "../src/section.js";
import { selectSectionGroove, sectionDrumInput } from "../src/grooveSelect.js";
import { planSectionTransitions } from "../src/transitions.js";
import { ABLETON_SAFE_NOTES } from "../src/ableton.js";
import { voiceOf } from "../src/kit.js";
import type { DrumPattern } from "../src/presets.js";
import type { PackedVariant } from "../src/presetData.js";
import type { GrooveSection } from "../src/grooveSelect.js";

/**
 * MUSICAL INVARIANTS.
 *
 * These exist because the library shipped a pool that was curated in name
 * only: `intense` held tom fills in 81% of its variants, `standard` ran from
 * 6 to 64 hits per bar, and one pattern mixed 1-, 2-, 4- and 8-bar loops.
 * Picking a variant there was picking an arbitrary performance, so a
 * repeated verse changed groove, length and density at once and a groove
 * could fail to repeat inside its own section.
 *
 * Unlike the corpus-content tests these do NOT move when the bake re-runs:
 * they are the contract the pool has to satisfy.
 */

const PATTERNS = [
  "kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense",
  "78", "68", "54", "four_on_floor", "trap", "breakbeat", "dnb",
  // the idiom shelf — same contract, its own names
  "motown", "boom_bap", "train_beat", "bossa", "reggae",
  "disco", "afrobeat", "punk", "ballad", "second_line",
] as const;

/** The energy ladder, quietest first. Each bank must sit entirely below the
 *  next one: a chorus can never come out sparser than the verse it lifts. */
const LADDER = ["kick_only", "bridge_sparse", "half_time", "standard", "driving", "intense"] as const;

/** TrackDraft draws a hit at or below this velocity as a ghost, not a hit. */
const GHOST_MAX = 45;

const perBar = (notes: PackedVariant["notes"], variant: PackedVariant): number =>
  notes.length / Math.max(variant.lengthBeats / variant.beatsPerBar, 1e-9);

/** Every hit, ghosts included — the visual density of the grid. */
const hitsPerBar = (variant: PackedVariant): number => perBar(variant.notes, variant);

/** Audible hits only. Ghost notes are texture, not energy: a groove full of
 *  ghosts is not "louder" than one without, which is the whole reason they
 *  sit under the threshold.
 *
 *  Measured on the AUTHORED bank, not on the shipped variants: the feel layer
 *  multiplies every velocity by the donor take's own contour, so a soft
 *  8th-note hat at 56 legitimately lands at 44 after a quiet take and would
 *  be miscounted as a ghost. The authored numbers are the contract. */
const energyPerBar = (variant: PackedVariant): number =>
  perBar(variant.notes.filter(([, , velocity]) => velocity > GHOST_MAX), variant);
const authored = (pattern: (typeof PATTERNS)[number]): PackedVariant[] => CURATED_PATTERNS[pattern]!;

describe("the pattern pool is musical, not just shaped like one", () => {
  it("every loop is one or two bars — a groove must be able to repeat", () => {
    for (const pattern of PATTERNS) {
      for (const variant of PRESET_DATA[pattern]!.variants) {
        const bars = variant.lengthBeats / variant.beatsPerBar;
        expect(Number.isInteger(Math.round(bars * 1e6) / 1e6), `${pattern} loop of ${bars} bars`).toBe(true);
        expect(bars, pattern).toBeGreaterThanOrEqual(1);
        expect(bars, pattern).toBeLessThanOrEqual(2);
      }
    }
  });

  it("every variant's loop is whole bars of its own meter", () => {
    for (const pattern of PATTERNS) {
      for (const variant of PRESET_DATA[pattern]!.variants) {
        const bars = variant.lengthBeats / variant.beatsPerBar;
        expect(Math.abs(bars - Math.round(bars)), `${pattern} ${variant.lengthBeats}/${variant.beatsPerBar}`).toBeLessThan(1e-6);
      }
    }
  });

  it("each pattern stays inside its density band (no fills posing as grooves)", () => {
    for (const pattern of PATTERNS) {
      const [min, max] = DENSITY[pattern];
      for (const variant of PRESET_DATA[pattern]!.variants) {
        const density = hitsPerBar(variant);
        expect(density, `${pattern} at ${density.toFixed(1)} hits/bar`).toBeGreaterThanOrEqual(min);
        expect(density, `${pattern} at ${density.toFixed(1)} hits/bar`).toBeLessThanOrEqual(max);
      }
    }
  });

  it("the energy ladder is strictly ordered — a lift always lifts", () => {
    const ranges = LADDER.map((pattern) => {
      const densities = authored(pattern).map(energyPerBar);
      return { pattern, min: Math.min(...densities), max: Math.max(...densities) };
    });
    for (let i = 1; i < ranges.length; i++) {
      const lower = ranges[i - 1]!;
      const higher = ranges[i]!;
      expect(higher.min, `${higher.pattern} (min ${higher.min.toFixed(1)}) must be busier than ${lower.pattern} (max ${lower.max.toFixed(1)})`).toBeGreaterThan(lower.max);
    }
  });

  it("no GROOVE is a tom run — fills come from FILL_DATA", () => {
    // The authored banks contain no toms at all. A corpus take may use one as an
    // accent, but past `MAX_TOM_SHARE` of its notes it is a fill wearing a
    // groove's clothes, and the whole "patterns are random" complaint was
    // exactly those takes (81% of `intense` used to be tom runs).
    for (const pattern of PATTERNS) {
      // written material: not a single tom
      // synth-only patterns (trap, dnb, ...) have no authored bank at all
      for (const variant of CURATED_PATTERNS[pattern as (typeof PATTERNS)[number]] ?? []) {
        const toms = variant.notes.filter(([, pitch]) => String(voiceOf(pitch)).startsWith("tom"));
        expect(toms.length, `${pattern} authored variant has ${toms.length} tom hits`).toBe(0);
      }
      // corpus takes: toms may accent, never run
      for (const variant of PRESET_DATA[pattern]!.variants) {
        const toms = variant.notes.filter(([, pitch]) => String(voiceOf(pitch)).startsWith("tom")).length;
        const share = toms / Math.max(variant.notes.length, 1);
        expect(share, `${pattern} is ${(share * 100).toFixed(0)}% toms`).toBeLessThanOrEqual(MAX_TOM_SHARE + 1e-9);
      }
    }
  });

  it("the backbeat banks carry ghost notes, and they stay under the ghost threshold", () => {
    // Ghost notes are the quiet filler between backbeats — the single biggest
    // thing that separates "a drum machine" from "a drummer". They must stay
    // below the app's GHOST_MAX so the step grid draws them as ghosts.
    for (const pattern of ["standard", "driving", "half_time"] as const) {
      const ghosts = authored(pattern).flatMap((variant) =>
        variant.notes.filter(([, , velocity]) => velocity <= GHOST_MAX),
      );
      expect(ghosts.length, `${pattern} has no ghost notes`).toBeGreaterThan(0);
    }
    // ...and a bank that is defined by space has none.
    const sparse = authored("bridge_sparse").flatMap((variant) =>
      variant.notes.filter(([, , velocity]) => velocity <= GHOST_MAX),
    );
    expect(sparse).toHaveLength(0);
  });

  it("no ghost sits on a beat — they fill the space between", () => {
    for (const pattern of ["standard", "driving", "half_time"] as const) {
      for (const variant of authored(pattern)) {
        for (const [beat, , velocity] of variant.notes) {
          if (velocity > GHOST_MAX) continue;
          const inBar = beat % variant.beatsPerBar;
          expect(Math.abs(inBar - Math.round(inBar)), `${pattern} ghost at ${beat}`).toBeGreaterThan(0.2);
        }
      }
    }
  });

  it("every variant of a pattern plays the same meter", () => {
    for (const pattern of PATTERNS) {
      const meters = new Set(PRESET_DATA[pattern]!.variants.map((v) => v.beatsPerBar.toFixed(4)));
      expect(meters.size, `${pattern} mixes meters: ${[...meters].join(", ")}`).toBe(1);
    }
  });

  it("grooves carry a feel: velocities vary between voices and between variants", () => {
    // The corpus feel layer is what stops these reading as a machine grid.
    for (const pattern of ["standard", "driving", "intense"] as const) {
      const velocities = new Set(PRESET_DATA[pattern]!.variants.flatMap((v) => v.notes.map(([, , vel]) => vel)));
      expect(velocities.size, `${pattern} velocities`).toBeGreaterThan(8);
    }
  });
});

describe("continuity — the same section keeps its groove", () => {
  const section = (overrides: Partial<GrooveSection> = {}): GrooveSection => ({
    id: "verse-a",
    role: "verse",
    velocity: "mf",
    name: "Verse",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  });
  const request = (overrides: Partial<Parameters<typeof selectSectionGroove>[0]> = {}) => ({
    section: section(),
    song: { genre: "rock", bpm: 120 },
    durationBeats: 32,
    beatsPerBar: 4,
    ...overrides,
  });

  it("resolving the same section twice returns the same groove", () => {
    expect(selectSectionGroove(request({ occurrenceIndex: 2 }))).toEqual(selectSectionGroove(request({ occurrenceIndex: 2 })));
  });

  it("a repeated section keeps the same loop LENGTH on every pass", () => {
    const lengths = new Set<number>();
    for (let occurrenceIndex = 0; occurrenceIndex < 8; occurrenceIndex++) {
      const variant = selectSectionGroove(request({ occurrenceIndex }));
      lengths.add(variant!.lengthBeats);
    }
    // Different feel/pattern is the point; a different bar count is a bug.
    expect(lengths.size).toBe(1);
  });

  it("a section always resolves to its own meter", () => {
    for (const meter of ["kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense"] as const) {
      const variant = selectSectionGroove(request({ section: section({ drumPattern: meter }) }));
      expect(Math.abs(variant!.beatsPerBar - 4), meter).toBeLessThan(1e-6);
    }
  });

  it("an 8-bar section repeats on the 4-bar CYCLE, and develops inside it", () => {
    const built = request();
    const variant = selectSectionGroove({ ...built, occurrenceIndex: 0 });
    const input = sectionDrumInput({
      section: built.section,
      occurrenceIndex: 0,
      durationBeats: built.durationBeats,
      beatsPerBar: built.beatsPerBar,
      variant,
      velocityTarget: 96,
      transitionModel: null,
    });
    // A lone section is the last one, so no auto gesture and no fill.
    const notes = planSectionDrumNotes([input], FILL_DATA)[0].notes;

    const bar = (index: number): string =>
      notes
        .filter((n) => n.beat >= index * 4 - 1e-9 && n.beat < (index + 1) * 4 - 1e-9)
        .filter((n) => n.pitch === ABLETON_SAFE_NOTES.kick || n.pitch === ABLETON_SAFE_NOTES.snare)
        .map((n) => `${(n.beat - index * 4).toFixed(2)}:${n.pitch}`)
        .sort()
        .join("|");

    const bars = Array.from({ length: 8 }, (_, index) => bar(index));
    expect(bars[0]!.length).toBeGreaterThan(0);

    // Repetition: bar 5 restates bar 1, bar 6 restates bar 2 — the cycle is
    // what makes a groove recognisable, and it is 4 bars long.
    for (let index = 0; index < 4; index++) {
      expect(bars[index + 4], `bar ${index + 5} vs bar ${index + 1}`).toBe(bars[index]);
    }

    // Development: the last bar of each cycle turns the final eighth over
    // into the next cycle, so it is NOT a carbon copy of the first bar.
    // Without this an 8-bar verse is the same bar eight times.
    expect(bars[3], "bar 4 must develop").not.toBe(bars[0]);
  });
});

describe("gestures are gestures, not gaps", () => {
  const section = { id: "chorus", role: "chorus", velocity: "f", name: "C", timeSignatureNumerator: 4, timeSignatureDenPower: 2 };

  it("an automatic cut silences at most the last bar", () => {
    const plans = planSectionTransitions([
      { sectionId: "a", occurrenceIndex: 0, role: "pre_chorus", durationBeats: 32, beatsPerBar: 4, velocityTarget: 96 },
      { sectionId: "b", occurrenceIndex: 0, role: "verse", durationBeats: 32, beatsPerBar: 4, velocityTarget: 96 },
    ]);
    // Whatever model a section gets, its span is never more than a bar for a
    // cut — two bars of nothing reads as the drums stopping early.
    for (const plan of plans) {
      if (plan.model === "cut") expect(plan.bars, "cut span").toBe(1);
    }
    // And a cut that IS assigned must land on the last bar.
    const cutPlan = [1, 2, 3, 4, 5].map((n) => {
      const sectionId = `s${n}`;
      return planSectionTransitions([
        { sectionId, occurrenceIndex: 0, role: "chorus", durationBeats: 32, beatsPerBar: 4, velocityTarget: 96 },
        { sectionId: "next", occurrenceIndex: 0, role: "verse", durationBeats: 32, beatsPerBar: 4, velocityTarget: 96 },
      ])[0];
    }).filter((p) => p.model === "cut");
    for (const plan of cutPlan) expect(plan.bars).toBe(1);
  });
});

describe("meter forcing", () => {
  const run = (numerator: number, denPower: number, pattern?: DrumPattern) => {
    const beatsPerBar = numerator * (4 / 2 ** denPower);
    return selectSectionGroove({
      section: {
        id: "x",
        role: "verse",
        velocity: "mf",
        name: "V",
        timeSignatureNumerator: numerator,
        timeSignatureDenPower: denPower,
        ...(pattern ? { drumPattern: pattern } : {}),
      },
      song: { genre: "rock" },
      durationBeats: beatsPerBar * 8,
      beatsPerBar,
    });
  };

  it("a 7/8 pattern on a 4/4 section is substituted, not tiled into a drift", () => {
    expect(run(4, 2, "78")!.beatsPerBar).toBe(4);
  });

  it("a 4/4 pattern on a 7/8 section is substituted, not left drifting", () => {
    expect(run(7, 3, "standard")!.beatsPerBar).toBe(3.5);
  });

  it("a meter with no authored pattern at all still gets a groove in that meter", () => {
    for (const [numerator, denPower] of [[3, 3], [5, 3], [9, 3], [11, 4]] as const) {
      const beatsPerBar = numerator * (4 / 2 ** denPower);
      const variant = run(numerator, denPower);
      expect(variant, `${numerator}/${2 ** denPower}`).toBeTruthy();
      expect(Math.abs(variant!.beatsPerBar - beatsPerBar), `${numerator}/${2 ** denPower}`).toBeLessThan(1e-6);
    }
  });
});
