import { describe, expect, it } from "vitest";
import { planLaneCc } from "../src/cc.js";

const base = { durationBeats: 8, beatsPerBar: 4 };

describe("planLaneCc — per-lane controller automation", () => {
  it("emits one message for a static value, at the section start", () => {
    expect(planLaneCc({ ...base, perLane: { hat: { cc: 4, from: 64, to: 64 } } })).toEqual([
      { beat: 0, cc: 4, value: 64, lane: "hat" },
    ]);
  });

  it("ramps one value per bar across the section, inclusive of both ends", () => {
    const events = planLaneCc({ ...base, perLane: { hat: { cc: 74, from: 0, to: 127 } } });
    expect(events.map((e) => e.beat)).toEqual([0, 4, 8]);
    expect(events.map((e) => e.value)).toEqual([0, 64, 127]);
  });

  it("can send a value per beat", () => {
    const events = planLaneCc({ ...base, perBar: 4, perLane: { cym: { cc: 1, from: 10, to: 90 } } });
    expect(events).toHaveLength(9);
    expect(events[0].value).toBe(10);
    expect(events[8].value).toBe(90);
  });

  it("stays inside 0..127", () => {
    const events = planLaneCc({ ...base, perBar: 4, perLane: { tom: { cc: 200, from: -40, to: 900 } } });
    expect(events.every((e) => e.cc >= 0 && e.cc <= 127 && e.value >= 0 && e.value <= 127)).toBe(true);
  });

  it("skips muted and un-soloed lanes — the same rule as their notes", () => {
    const perLane = { hat: { cc: 4, from: 0, to: 100 }, kick: { cc: 74, from: 0, to: 100 } };
    expect(planLaneCc({ ...base, perLane, mute: ["hat"] }).every((e) => e.lane === "kick")).toBe(true);
    expect(planLaneCc({ ...base, perLane, solo: ["hat"] }).every((e) => e.lane === "hat")).toBe(true);
    expect(planLaneCc({ ...base, perLane: { hat: { cc: 4, from: 0, to: 1 } }, solo: ["hat"], mute: ["hat"] })).toEqual([]);
  });

  it("says nothing when no lane has a controller", () => {
    expect(planLaneCc(base)).toEqual([]);
  });
});
