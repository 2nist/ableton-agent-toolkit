import { describe, expect, it } from "vitest";
import type { BlueprintSection, DrumBlock } from "../../types/blueprint";
import { stepsBlockId } from "./drumSteps";
import {
  STEP_MENU_HOLDS,
  STEP_MENU_PROBS,
  STEP_MENU_RATCHETS,
  stepMenuBlockId,
  stepMenuTitle,
  withStepFlam,
  withStepGate,
  withStepProbability,
  withStepRatchet,
  withoutStep,
} from "./drumStepMenu";

const edit = { lane: "kick" as const, startBeat: 2, endBeat: 3 };

function section(notes?: DrumBlock[]): BlueprintSection {
  return {
    id: "s1",
    name: "Verse",
    role: "verse",
    bars: 2,
    chords: [
      { id: "c1", romanNumeral: "I", root: "C", quality: "maj", beats: 4 },
    ],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...(notes ? { drumBlocks: notes } : {}),
  } as BlueprintSection;
}

function painted(): BlueprintSection {
  return section([
    {
      id: stepsBlockId("kick", 2, 3),
      lane: "kick",
      startBeat: 2,
      endBeat: 3,
      mode: "steps",
      notes: [{ beat: 0, voice: "kick", velocity: 100 }],
    },
  ]);
}

const note = (s: BlueprintSection) =>
  (s.drumBlocks ?? []).find((block) => block.id === stepsBlockId("kick", 2, 3))
    ?.notes?.[0];

describe("the menu's rows", () => {
  it("offers four ratchets, coarsest first", () => {
    expect(STEP_MENU_RATCHETS.map((row) => row.value)).toEqual([1, 2, 3, 4]);
    expect(STEP_MENU_RATCHETS[0].label).toBe("×1");
  });

  it("offers probability as an ascending ladder ending in 'always'", () => {
    expect(STEP_MENU_PROBS.map((row) => row.value)).toEqual([
      1, 0.75, 0.5, 0.25,
    ]);
    expect(STEP_MENU_PROBS[0].label).toBe("always");
  });

  it("offers holds in whole cells", () => {
    expect(STEP_MENU_HOLDS).toEqual([1, 2, 4]);
  });

  it("addresses the same block the cell does", () => {
    // If these ever diverge, the menu edits a block nobody draws.
    expect(stepMenuBlockId(edit)).toBe(stepsBlockId("kick", 2, 3));
  });
});

describe("withStepRatchet", () => {
  it("writes the ratchet", () => {
    expect(note(withStepRatchet(painted(), edit, 3))?.ratchet).toBe(3);
  });

  it("clamps outside the ladder", () => {
    expect(note(withStepRatchet(painted(), edit, 9))?.ratchet).toBe(4);
    expect(note(withStepRatchet(painted(), edit, 0))).not.toHaveProperty(
      "ratchet",
    );
  });

  it("leaves the section alone when there is no painted step", () => {
    const bare = section();
    expect(withStepRatchet(bare, edit, 2)).toBe(bare);
  });
});

describe("withStepProbability", () => {
  it("stores a reduced probability", () => {
    expect(note(withStepProbability(painted(), edit, 0.5))?.prob).toBe(0.5);
  });

  it("removes the field at 100%", () => {
    const half = withStepProbability(painted(), edit, 0.5);
    expect(note(withStepProbability(half, edit, 1))).not.toHaveProperty("prob");
  });

  it("clamps to 0..1", () => {
    expect(note(withStepProbability(painted(), edit, 4))?.prob).toBeUndefined();
    expect(note(withStepProbability(painted(), edit, -1))?.prob).toBe(0);
  });
});

describe("withStepFlam", () => {
  it("toggles both ways", () => {
    const on = withStepFlam(painted(), edit, true);
    expect(note(on)?.flam).toBe(true);
    expect(note(withStepFlam(on, edit, false))).not.toHaveProperty("flam");
  });
});

describe("withStepGate", () => {
  it("writes the hold", () => {
    expect(note(withStepGate(painted(), edit, 2, 8))?.durBeats).toBe(2);
  });

  it("cannot hold past the end of the section", () => {
    // The note starts at beat 2 of an 8-beat section, so 6 is the room.
    expect(note(withStepGate(painted(), edit, 99, 8))?.durBeats).toBe(6);
  });

  it("keeps the feel it had", () => {
    const rolled = withStepRatchet(painted(), edit, 2);
    const held = withStepGate(rolled, edit, 3, 8);
    expect(note(held)?.ratchet).toBe(2);
    expect(note(held)?.durBeats).toBe(3);
  });
});

describe("withoutStep", () => {
  it("clears the step, leaving the block as silence", () => {
    // A cleared step is an empty block, not a removed one: `applyDrumBlocks`
    // reads that as "this lane is silent here", which is the point of clearing.
    const cleared = withoutStep(painted(), edit);
    expect(note(cleared)).toBeUndefined();
    expect(cleared.drumBlocks).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = withoutStep(painted(), edit);
    expect(withoutStep(once, edit).drumBlocks).toHaveLength(1);
  });
});

describe("stepMenuTitle", () => {
  it("names the step and everything set on it", () => {
    expect(
      stepMenuTitle("Kick", 1, 8, {
        gate: 3,
        ratchet: 2,
        flam: true,
        prob: 0.5,
      }),
    ).toBe("Kick step 2 of 8 · 3 beat hold · ×2 · flam · 50%");
  });

  it("says just the step when nothing is set", () => {
    expect(stepMenuTitle("Kick", 0, 8, null)).toBe("Kick step 1 of 8");
    expect(
      stepMenuTitle("Kick", 0, 8, { ratchet: 1, flam: false, prob: 1 }),
    ).toBe("Kick step 1 of 8");
  });
});
