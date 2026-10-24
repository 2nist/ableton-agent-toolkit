import { describe, expect, it } from "vitest";
import { audibleLanes, KIT_PITCHES, planSectionDrumNotes, FILL_DATA, type SectionDrumInput } from "../src/index.js";
import { PRESET_DATA } from "../src/presetData.js";

const input = (extra: Partial<SectionDrumInput> = {}): SectionDrumInput => ({
  sectionId: "s1",
  occurrenceIndex: 0,
  role: "verse",
  variant: PRESET_DATA.standard!.variants[0]!,
  beatsPerBar: 4,
  gridBeats: 0.25,
  durationBeats: 8,
  velocityTarget: 100,
  ...extra,
});

const pitches = (i: SectionDrumInput) => planSectionDrumNotes([i], FILL_DATA)[0].notes.map((n) => n.pitch);
const has = (list: number[], voice: keyof typeof KIT_PITCHES) => list.includes(KIT_PITCHES[voice]);

describe("lane mute / solo — the shared planner drops the lane", () => {
  it("audibleLanes: plain, muted, soloed, and solo + mute together", () => {
    expect([...audibleLanes()].sort()).toEqual(["cym", "hat", "kick", "rim", "snare", "tom"]);
    expect([...audibleLanes(["snare"])]).not.toContain("snare");
    expect([...audibleLanes([], ["kick"])]).toEqual(["kick"]);
    // a soloed-but-muted lane stays silent
    expect([...audibleLanes(["kick"], ["kick"])]).toEqual([]);
  });

  it("a muted lane loses its notes; every other lane is untouched", () => {
    const plain = pitches(input());
    const muted = pitches(input({ mute: ["snare"] }));
    expect(has(plain, "snare")).toBe(true);
    expect(has(muted, "snare")).toBe(false);
    expect(muted.length).toBeLessThan(plain.length);
    // the kick survives
    expect(has(muted, "kick")).toBe(true);
  });

  it("solo keeps only the soloed lanes", () => {
    const soloed = pitches(input({ solo: ["kick"] }));
    expect(has(soloed, "kick")).toBe(true);
    expect(has(soloed, "snare")).toBe(false);
    expect(has(soloed, "closedHat")).toBe(false);
  });

  it("a blocks-only section is filtered too", () => {
    const blocksOnly = (mute?: ("kick" | "snare")[]) =>
      planSectionDrumNotes(
        [
          input({
            variant: null,
            mute,
            blocks: [
              {
                id: "b1", lane: "kick", startBeat: 0, endBeat: 4, mode: "steps",
                notes: [{ beat: 0, voice: "kick", velocity: 100 }],
              },
            ],
          }),
        ],
        FILL_DATA,
      )[0].notes;
    expect(blocksOnly().length).toBeGreaterThan(0);
    expect(blocksOnly(["kick"]).length).toBe(0);
  });
});
