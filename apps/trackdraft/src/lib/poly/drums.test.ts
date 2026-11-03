import { describe, expect, it } from "vitest";
import {
  CLOCK_LADDER,
  CLOCK_SCOPE,
  clockScopeHint,
  drumClockLabel,
  GROOVE_LADDER,
  grooveChip,
  groovePatchFor,
  nextClock,
  previousClock,
  nextLoop,
  nextVelocity,
  passVariance,
  VELOCITY_LADDER,
  velocityHint,
  stepGroove,
  stepVariant,
} from "./drums";
import type { TimeDomain } from "../../types/blueprint";
import { variantCount } from "../drums/patternOptions";

describe("grooveChip", () => {
  it("names what the section plays", () => {
    expect(grooveChip({}).kind).toBe("auto");
    expect(grooveChip({ drumPattern: "none" }).kind).toBe("muted");
    expect(grooveChip({ drumPattern: "standard" })).toMatchObject({
      kind: "preset",
      label: "standard",
      variant: 0,
      steppable: true,
    });
  });

  it("reports the variant and how many there are", () => {
    const chip = grooveChip({ drumPattern: "standard", drumVariantIndex: 1 });
    expect(chip.variants).toBe(variantCount("standard"));
    expect(chip.variant).toBe(1);
  });

  it("clamps a stale variant index instead of showing one that cannot play", () => {
    const chip = grooveChip({ drumPattern: "standard", drumVariantIndex: 99 });
    expect(chip.variant).toBe(chip.variants - 1);
  });

  it("refuses to step an authored outline", () => {
    const chip = grooveChip({
      drumMeterOutline: { cellBeats: 0.5, cells: [2, 3], label: "1 2 1 2 3" },
    });
    expect(chip.kind).toBe("outline");
    expect(chip.steppable).toBe(false);
    expect(
      stepGroove(
        {
          drumMeterOutline: {
            cellBeats: 0.5,
            cells: [2, 3],
            label: "1 2 1 2 3",
          },
        },
        1,
      ),
    ).toBeNull();
  });
});

describe("stepGroove", () => {
  it("walks the ladder up and down", () => {
    expect(stepGroove({ drumPattern: "kick_only" }, 1)).toEqual({
      kind: "preset",
      pattern: "standard",
      variant: 0,
    });
    expect(stepGroove({ drumPattern: "standard" }, -1)).toEqual({
      kind: "preset",
      pattern: "kick_only",
      variant: 0,
    });
  });

  it("wraps at both ends rather than sticking", () => {
    const loudest = GROOVE_LADDER[GROOVE_LADDER.length - 1];
    expect(stepGroove({ drumPattern: loudest }, 1)).toMatchObject({
      pattern: GROOVE_LADDER[0],
    });
    expect(stepGroove({ drumPattern: GROOVE_LADDER[0] }, -1)).toMatchObject({
      pattern: loudest,
    });
  });

  it("starts from standard when the drums were automatic", () => {
    expect(stepGroove({}, 1)).toMatchObject({ pattern: "standard" });
    expect(stepGroove({}, -1)).toMatchObject({ pattern: "standard" });
  });

  it("leaves auto and muted behind when you step", () => {
    expect(stepGroove({ drumPattern: "none" }, 1)).toMatchObject({
      kind: "preset",
    });
    expect(stepGroove({}, 1)).toMatchObject({ kind: "preset" });
  });

  it("resets the variant so a step is an intensity change, not a surprise", () => {
    expect(
      stepGroove({ drumPattern: "standard", drumVariantIndex: 2 }, 1),
    ).toMatchObject({
      variant: 0,
    });
  });
});

describe("stepVariant", () => {
  it("cycles within the preset and wraps", () => {
    const count = variantCount("standard");
    if (count < 2) return;
    expect(
      stepVariant({ drumPattern: "standard", drumVariantIndex: 0 }, 1),
    ).toMatchObject({
      pattern: "standard",
      variant: 1 % count,
    });
    expect(
      stepVariant({ drumPattern: "standard", drumVariantIndex: count - 1 }, 1),
    ).toMatchObject({ variant: 0 });
    expect(
      stepVariant({ drumPattern: "standard", drumVariantIndex: 0 }, -1),
    ).toMatchObject({
      variant: count - 1,
    });
  });

  it("does nothing when there is no preset to vary", () => {
    expect(stepVariant({}, 1)).toBeNull();
    expect(stepVariant({ drumPattern: "none" }, 1)).toBeNull();
    expect(
      stepVariant(
        {
          drumMeterOutline: {
            cellBeats: 0.5,
            cells: [2, 3],
            label: "1 2 1 2 3",
          },
        },
        1,
      ),
    ).toBeNull();
  });
});

describe("the section's own clock", () => {
  it("cycles through the ladder and back to song time", () => {
    let domain: TimeDomain | null | undefined = undefined;
    const seen: (TimeDomain | null)[] = [];
    for (let step = 0; step < CLOCK_LADDER.length; step += 1) {
      domain = nextClock(domain);
      seen.push(domain);
    }
    expect(seen.map((entry) => entry?.rate ?? 1)).toEqual([0.5, 2, 1, 1, 1]);
    // The fifth press wraps back to "the song's own time".
    expect(seen[4]).toBeNull();
  });

  it("recognises the rung it is already on", () => {
    expect(nextClock({ rate: 0.5 })?.rate).toBe(2);
    expect(nextClock({ rate: 1, swing: 0.25 })?.swing).toBe(0.5);
    expect(nextClock({ rate: 1, swing: 0.5 })).toBeNull();
  });

  it("labels the lane", () => {
    expect(drumClockLabel({})).toBe("song time");
    expect(drumClockLabel({ timeDomain: { rate: 0.5 } })).toBe("½");
    expect(drumClockLabel({ timeDomain: { rate: 1, swing: 0.5 } })).toContain(
      "swing",
    );
  });

  it("says which lanes the clock moves, on the row that sets it", () => {
    // §P3.5: a clock cannot move the harmony, so it moves only the lanes that
    // carry their own time. The scope has to be visible where you press it.
    expect(clockScopeHint({})).toBe("song time");
    expect(clockScopeHint({ timeDomain: { rate: 0.5 } })).toBe(
      "½ · drums & melody",
    );
    expect(clockScopeHint({ timeDomain: { rate: 1, cycle: 4 } })).toContain(
      CLOCK_SCOPE,
    );
  });
});

describe("the loop ladder", () => {
  it("walks whole section → 4 → 8 → 16 and back", () => {
    let cycle = nextLoop(undefined, 32);
    const seen = [cycle];
    for (let step = 0; step < 3; step += 1) {
      cycle = nextLoop(cycle, 32);
      seen.push(cycle);
    }
    expect(seen).toEqual([4, 8, 16, 0]);
  });

  it("skips a loop that is not shorter than the section", () => {
    // An eight-beat section loses the 8 and 16 rungs; a four-beat loop of two
    // bars would be the whole thing again.
    expect(nextLoop(undefined, 8)).toBe(4);
    expect(nextLoop(4, 8)).toBe(0);
  });

  it("always offers something for a one-beat section", () => {
    expect(nextLoop(undefined, 1)).toBe(0);
  });
});

describe("the dynamic ladder (§P4.3)", () => {
  it("walks pp → ff and wraps", () => {
    let value: ReturnType<typeof nextVelocity> | undefined = undefined;
    const seen: string[] = [];
    for (let step = 0; step < VELOCITY_LADDER.length; step += 1) {
      value = nextVelocity(value);
      seen.push(value);
    }
    expect(seen).toEqual(["mf", "f", "ff", "pp", "p", "mp"]);
    expect(nextVelocity("ff")).toBe("pp");
  });

  it("starts an absent or unknown value at mf", () => {
    expect(nextVelocity(undefined)).toBe("mf");
    // A schema preset the canvas ladder does not carry still has a rung.
    expect(nextVelocity("fff")).toBe("mf");
  });

  it("names the current dynamic on the row", () => {
    expect(velocityHint("f")).toBe("f");
    expect(velocityHint(undefined)).toBe("mf");
  });
});

describe("groovePatchFor — the kit as a per-pass patch (§P4.3)", () => {
  it("reduces a preset choice to the two fields it sets", () => {
    expect(
      groovePatchFor({ kind: "preset", pattern: "half_time", variant: 2 }),
    ).toEqual({
      drumPattern: "half_time",
      drumVariantIndex: 2,
    });
  });

  it("defaults the variant to the first one", () => {
    expect(groovePatchFor({ kind: "preset", pattern: "standard" })).toEqual({
      drumPattern: "standard",
      drumVariantIndex: 0,
    });
  });

  it("refuses the choices a patch cannot express", () => {
    // "auto" and "muted" CLEAR drumPattern, and the override model can only
    // set a value — an absent key means "inherit the section". Those stay
    // section-level rather than being silently misapplied.
    expect(groovePatchFor({ kind: "auto" })).toBeNull();
    expect(groovePatchFor({ kind: "muted" })).toBeNull();
    expect(
      groovePatchFor({
        kind: "outline",
        outline: { cellBeats: 1, cells: [2, 2], label: "x" },
      }),
    ).toBeNull();
  });
});

describe("passVariance — what makes this pass different (§P4.4)", () => {
  const section = {
    velocity: "mf" as const,
    drumPattern: "standard",
    bars: 8,
  };

  it("says nothing when the pass is the section", () => {
    expect(passVariance(section, { ...section }).labels).toEqual([]);
    expect(passVariance(section, { ...section }).detail).toBe("");
  });

  it("names the dynamic and the kit it changes", () => {
    const pass = {
      ...section,
      velocity: "f" as const,
      drumPattern: "half_time",
    };
    const variance = passVariance(section, pass);
    expect(variance.labels).toEqual(["f", "half_time"]);
    expect(variance.detail).toContain("dynamic f (section mf)");
    expect(variance.detail).toContain("kit half_time (section standard)");
  });

  it("leaves the clock to the badge, but still explains it", () => {
    // The column already draws `×2`; a second chip saying the same would be noise.
    const variance = passVariance(
      { ...section, timeDomain: { rate: 0.5 } },
      {
        ...section,
        timeDomain: { rate: 2 },
      },
    );
    expect(variance.labels).toEqual([]);
    expect(variance.detail).toContain("clock ×2");
  });

  it("says when a pass is a different length", () => {
    expect(passVariance(section, { ...section, bars: 4 }).labels).toEqual([
      "4 bars",
    ]);
  });

  it("treats an absent field as the default, not as a difference", () => {
    expect(passVariance({}, {}).labels).toEqual([]);
    expect(passVariance(undefined, section).labels).toEqual([]);
  });
});

describe("stepping the clock backwards (g9)", () => {
  it("walks the ladder the other way", () => {
    expect(previousClock(null)?.swing).toBe(0.5);
    expect(previousClock({ rate: 1, swing: 0.5 })?.swing).toBe(0.25);
    expect(previousClock({ rate: 1, swing: 0.25 })?.rate).toBe(2);
    expect(previousClock({ rate: 2 })?.rate).toBe(0.5);
  });

  it("wraps from ½ back to song time", () => {
    expect(previousClock({ rate: 0.5 })).toBeNull();
  });

  it("lands on song time from a clock that is not on the ladder", () => {
    // A clock assembled elsewhere (phase-only, say) has no rung to step back to.
    expect(previousClock({ rate: 1, phase: 0.5 })).toBeNull();
  });

  it("is the exact inverse of nextClock", () => {
    let domain: TimeDomain | null | undefined = undefined;
    for (let step = 0; step < CLOCK_LADDER.length; step += 1) {
      const forward = nextClock(domain);
      expect(previousClock(forward)).toEqual(domain ?? null);
      domain = forward;
    }
  });
});
