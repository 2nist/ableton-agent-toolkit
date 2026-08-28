import { describe, expect, it } from "vitest";
import { synthesizeTransition, planSectionTransitions, transitionFlavor, type TransitionInput, type TransitionPlanInput } from "../src/transitions.js";

const KICK = 36;
const SNARE = 38;
const HAT = 42;

function baseGroove(): [number, number, number][] {
  // A plain 4/4-ish bar of hat pulses, one every 0.25 beats, for 2 beats.
  const notes: [number, number, number][] = [];
  for (let beat = 0; beat < 2; beat += 0.25) notes.push([beat, HAT, 80]);
  return notes;
}

function input(overrides: Partial<TransitionInput> = {}): TransitionInput {
  return { spanBeats: 2, gridBeats: 0.25, velocityTarget: 100, baseNotes: baseGroove(), ...overrides };
}

describe("synthesizeTransition — buildUp", () => {
  it("ends on a strong kick+snare hit at the very last grid step", () => {
    const notes = synthesizeTransition("buildUp", input());
    const lastBeat = Math.max(...notes.map((n) => n[0]));
    const pitchesAtLastBeat = notes.filter((n) => n[0] === lastBeat).map((n) => n[1]);
    // The roll's hat pulse can also land on the last step (its own density
    // reaches "every step" by the end) — kick+snare just need to be present.
    expect(pitchesAtLastBeat).toEqual(expect.arrayContaining([KICK, SNARE]));
    expect(notes.find((n) => n[0] === lastBeat && n[1] === KICK)![2]).toBe(100); // full velocityTarget
  });

  it("gets denser toward the end (more hits in the second half than the first)", () => {
    const notes = synthesizeTransition("buildUp", input());
    const firstHalf = notes.filter((n) => n[0] < 1 && n[1] === HAT).length;
    const secondHalf = notes.filter((n) => n[0] >= 1 && n[1] === HAT).length;
    expect(secondHalf).toBeGreaterThanOrEqual(firstHalf);
  });

  it("ignores baseNotes entirely — it's fresh material", () => {
    const withBase = synthesizeTransition("buildUp", input({ baseNotes: baseGroove() }));
    const withoutBase = synthesizeTransition("buildUp", input({ baseNotes: [] }));
    expect(withBase).toEqual(withoutBase);
  });
});

describe("synthesizeTransition — breakDown", () => {
  it("thins the base groove — fewer notes than the original", () => {
    const base = baseGroove();
    const notes = synthesizeTransition("breakDown", input({ baseNotes: base }));
    expect(notes.length).toBeLessThan(base.length);
  });

  it("fades velocity toward the end of the span", () => {
    const notes = synthesizeTransition("breakDown", input());
    const early = notes.filter((n) => n[0] < 0.5);
    const late = notes.filter((n) => n[0] >= 1.5);
    expect(late.length).toBeGreaterThan(0);
    expect(Math.max(...late.map((n) => n[2]))).toBeLessThan(Math.max(...early.map((n) => n[2])));
  });

  it("returns nothing for an empty base groove rather than inventing material", () => {
    expect(synthesizeTransition("breakDown", input({ baseNotes: [] }))).toEqual([]);
  });
});

describe("synthesizeTransition — cut", () => {
  it("is a single sharp hit at beat 0, then silence for the rest of the span", () => {
    const notes = synthesizeTransition("cut", input());
    expect(notes.every((n) => n[0] === 0)).toBe(true);
    expect(notes.map((n) => n[1]).sort()).toEqual([KICK, SNARE]);
  });

  it("hits at the target velocity, not scaled down", () => {
    const notes = synthesizeTransition("cut", input({ velocityTarget: 115 }));
    expect(notes.every((n) => n[2] === 115)).toBe(true);
  });
});

describe("synthesizeTransition — dropOut", () => {
  it("silences the kick by default, keeping everything else", () => {
    const base: [number, number, number][] = [[0, KICK, 100], [0.5, SNARE, 90], [1, HAT, 70]];
    const notes = synthesizeTransition("dropOut", input({ baseNotes: base }));
    expect(notes.some((n) => n[1] === KICK)).toBe(false);
    expect(notes.some((n) => n[1] === SNARE)).toBe(true);
    expect(notes.some((n) => n[1] === HAT)).toBe(true);
  });

  it("respects an explicit dropVoices list", () => {
    const base: [number, number, number][] = [[0, KICK, 100], [0.5, SNARE, 90], [1, HAT, 70]];
    const notes = synthesizeTransition("dropOut", input({ baseNotes: base, dropVoices: ["snare", "hat"] }));
    expect(notes).toEqual([[0, KICK, 100]]);
  });

  it("returns nothing for an empty base groove", () => {
    expect(synthesizeTransition("dropOut", input({ baseNotes: [] }))).toEqual([]);
  });
});

describe("synthesizeTransition — meter-change pickup (nextGridBeats)", () => {
  it("replaces the final beat with hits spaced at the next meter's grid", () => {
    // Span 2 beats at grid 0.25 (4/4-ish); next section is triple-feel at 1/3 beat.
    const notes = synthesizeTransition("cut", input({ nextGridBeats: 1 / 3 }));
    const pickupWindow = notes.filter((n) => n[0] >= 1 && n[1] === HAT);
    expect(pickupWindow.length).toBeGreaterThan(1);
    // Roughly evenly spaced at the new grid, not the old one.
    const gaps = pickupWindow.slice(1).map((n, i) => n[0] - pickupWindow[i]![0]);
    for (const gap of gaps) expect(gap).toBeCloseTo(1 / 3, 5);
  });

  it("is composable with any of the four models, not just cut", () => {
    const notes = synthesizeTransition("buildUp", input({ nextGridBeats: 0.5 }));
    expect(notes.length).toBeGreaterThan(0);
  });

  it("does nothing extra when nextGridBeats is absent", () => {
    const withPickup = synthesizeTransition("cut", input({ nextGridBeats: undefined }));
    expect(withPickup.every((n) => n[0] === 0)).toBe(true);
  });
});

describe("synthesizeTransition — custom voices", () => {
  it("uses the provided voice pitches instead of the defaults", () => {
    const notes = synthesizeTransition("cut", input({ voices: { kick: 60, snare: 61, hat: 62 } }));
    expect(notes.map((n) => n[1]).sort()).toEqual([60, 61]);
  });
});

describe("transition catalog", () => {
  it("ships multiple distinct flavors per model (the large catalog)", () => {
    expect(transitionFlavor("buildUp", 0)).toBeDefined();
    // buildUp alone exposes several flavors, so role-identical sections vary.
    const flavors = new Set(
      Array.from({ length: 8 }, (_, i) => transitionFlavor("buildUp", i).label),
    );
    expect(flavors.size).toBeGreaterThan(2);
    // Every model has at least one flavor; indexes wrap safely.
    for (const model of ["buildUp", "breakDown", "cut", "dropOut"] as const) {
      expect(transitionFlavor(model, 0).label.length).toBeGreaterThan(0);
      expect(transitionFlavor(model, 99)).toBeDefined();
    }
  });

  it("a buildUp flavor's grid changes the generated density", () => {
    const fast = synthesizeTransition("buildUp", input({ flavor: { label: "32nd sprint", gridBeats: 0.125, roll: 1, curve: 1.5 } }));
    const slow = synthesizeTransition("buildUp", input({ flavor: { label: "slow burn", gridBeats: 0.5, roll: 1, curve: 0.7 } }));
    expect(fast.length).toBeGreaterThan(slow.length);
  });

  it("a dropOut flavor silences different voices than the default", () => {
    const base: [number, number, number][] = [[0, KICK, 100], [0.5, SNARE, 90], [1, HAT, 70]];
    const dropped = synthesizeTransition("dropOut", input({ baseNotes: base, flavor: { label: "drop rhythm", dropVoices: ["kick", "snare"] } }));
    expect(dropped.some((n) => n[1] === KICK)).toBe(false);
    expect(dropped.some((n) => n[1] === SNARE)).toBe(false);
    expect(dropped.some((n) => n[1] === HAT)).toBe(true);
  });
});

describe("planSectionTransitions — role-aware auto assignment", () => {
  function sec(partial: Partial<TransitionPlanInput> & { sectionId: string }): TransitionPlanInput {
    return { occurrenceIndex: 0, role: null, durationBeats: 8, beatsPerBar: 4, velocityTarget: 100, ...partial };
  }

  it("builds up INTO a chorus", () => {
    const plans = planSectionTransitions([sec({ sectionId: "v", role: "verse" }), sec({ sectionId: "c", role: "chorus" })]);
    expect(plans[0].model).toBe("buildUp");
    // the last section never carries its own gesture
    expect(plans[1].model).toBeNull();
  });

  it("builds up INTO a refrain too — a refrain is a chorus (Beatles labels)", () => {
    const plans = planSectionTransitions([sec({ sectionId: "v", role: "verse" }), sec({ sectionId: "r", role: "refrain" })]);
    expect(plans[0].model).toBe("buildUp");
  });

  it("a SHORT intro hands off cleanly — no build-up roll over a 1-3 bar intro (the train-wreck fix)", () => {
    const short = sec({ sectionId: "intro", role: "intro", durationBeats: 12 }); // 3 bars
    const plans = planSectionTransitions([short, sec({ sectionId: "v", role: "verse" })]);
    expect(plans[0].model).toBeNull();
  });

  it("a LONG intro builds up into the first section with a single-bar gesture", () => {
    const long = sec({ sectionId: "intro", role: "intro", durationBeats: 32 }); // 8 bars
    const plans = planSectionTransitions([long, sec({ sectionId: "v", role: "verse" })]);
    expect(plans[0].model).toBe("buildUp");
    expect(plans[0].bars).toBe(1); // never a 2-bar roll on an intro
  });

  it("breaks down out of a verse", () => {
    const plans = planSectionTransitions([sec({ sectionId: "v1", role: "verse" }), sec({ sectionId: "v2", role: "verse" })]);
    expect(plans[0].model).toBe("breakDown");
  });

  it("drops out of a bridge — even into a chorus (the explicit ask)", () => {
    const plans = planSectionTransitions([sec({ sectionId: "b", role: "bridge" }), sec({ sectionId: "c", role: "chorus" })]);
    expect(plans[0].model).toBe("dropOut");
  });

  it("drops out of a bridge into an outro too", () => {
    const plans = planSectionTransitions([sec({ sectionId: "b", role: "bridge" }), sec({ sectionId: "o", role: "outro" })]);
    expect(plans[0].model).toBe("dropOut");
  });

  it("cuts into an outro (unless a louder signal already won)", () => {
    const plans = planSectionTransitions([sec({ sectionId: "c", role: "chorus" }), sec({ sectionId: "o", role: "outro" })]);
    expect(plans[0].model).toBe("cut");
  });

  it("a chorus boundary wins over the verse break-down when both apply", () => {
    const plans = planSectionTransitions([sec({ sectionId: "v", role: "verse" }), sec({ sectionId: "c", role: "chorus" })]);
    expect(plans[0].model).toBe("buildUp"); // not breakDown
  });

  it("leaves sections the user authored alone", () => {
    const plans = planSectionTransitions([
      sec({ sectionId: "a", role: "verse", manualModel: true }),
      sec({ sectionId: "b", role: "chorus" }),
    ]);
    expect(plans[0].model).toBeNull();
    expect(plans[1].model).toBeNull();
  });

  it("skips a section with an authored variation", () => {
    const plans = planSectionTransitions([sec({ sectionId: "a", role: "verse", hasVariation: true }), sec({ sectionId: "b", role: "chorus" })]);
    expect(plans[0].model).toBeNull();
  });

  it("assigns a seeded flavor and 1-2 bars for variation", () => {
    // Same role + same section id → same plan (deterministic).
    const a = planSectionTransitions([sec({ sectionId: "v", role: "verse" }), sec({ sectionId: "c", role: "chorus" })]);
    const b = planSectionTransitions([sec({ sectionId: "v", role: "verse" }), sec({ sectionId: "c", role: "chorus" })]);
    expect(a[0]).toEqual(b[0]);
    // Different section ids → likely different flavor/bars (variation).
    const c = planSectionTransitions([sec({ sectionId: "v2", role: "verse" }), sec({ sectionId: "c", role: "chorus" })]);
    expect(c[0].model).toBe("buildUp");
    expect(c[0].flavor).toBeGreaterThanOrEqual(0);
    expect(c[0].bars).toBeGreaterThanOrEqual(1);
    expect(c[0].bars).toBeLessThanOrEqual(2);
  });

  it("a repeated section's later occurrences vary (seeded, not byte-identical)", () => {
    const plans = Array.from({ length: 20 }, (_, occ) =>
      planSectionTransitions([sec({ sectionId: "c", role: "chorus", occurrenceIndex: occ }), sec({ sectionId: "v", role: "verse" })])[0],
    );
    // A chorus handing to a verse is a plain boundary; across 20 occurrences
    // the seeded spice cannot land on a single identical outcome every time.
    const distinct = new Set(plans.map((p) => `${p.model}:${p.flavor}:${p.bars}`));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("not every plain boundary gets a gesture (fills/transitions are sparse)", () => {
    // Build a row of plain (no-role) handoffs and confirm some resolve to a
    // clean handoff — the old behavior filled every qualifying one.
    const plain = Array.from({ length: 30 }, (_, i) => sec({ sectionId: `p${i}`, role: null, durationBeats: 8 }));
    const plans = planSectionTransitions(plain);
    const withGesture = plans.filter((p) => p.model !== null).length;
    expect(withGesture).toBeGreaterThan(0);
    expect(withGesture).toBeLessThan(plain.length);
  });
});
