import { describe, expect, it } from "vitest";
import { applyOverrides, captureLearn } from "../src/lib/learn";
import { defaultPhysicalMap, resolvePhysical } from "../src/lib/router";

describe("defaultPhysicalMap", () => {
  it("is seeded from the real hardware numbers in @hardware/controller-bridge", () => {
    const map = defaultPhysicalMap();
    expect(map.shift).toBe(98);
    expect(map.faders).toEqual([48, 49, 50, 51, 52, 53, 54, 55]);
    expect(map.trackButtons[0]).toBe(64);
    expect(map.sceneButtons[0]).toBe(82);
    expect(map.gridPads).toHaveLength(64);
    expect(new Set(map.gridPads).size).toBe(64); // all 64 pad notes are distinct
  });
});

describe("resolvePhysical", () => {
  const map = defaultPhysicalMap();

  it("resolves shift", () => {
    expect(resolvePhysical({ channel: 0, number: 98, value: 127, messageType: "note" }, map)).toEqual({
      kind: "shift",
      pressed: true,
    });
    expect(resolvePhysical({ channel: 0, number: 98, value: 0, messageType: "note" }, map)).toEqual({
      kind: "shift",
      pressed: false,
    });
  });

  it("resolves a fader CC to its index", () => {
    expect(resolvePhysical({ channel: 0, number: 52, value: 64, messageType: "cc" }, map)).toEqual({
      kind: "fader",
      index: 4,
      value: 64,
    });
  });

  it("resolves a track button to a bankSelect event", () => {
    expect(resolvePhysical({ channel: 0, number: 66, value: 127, messageType: "note" }, map)).toEqual({
      kind: "bankSelect",
      index: 2,
      pressed: true,
    });
  });

  it("resolves a scene button to a sceneButton event", () => {
    expect(resolvePhysical({ channel: 0, number: 89, value: 127, messageType: "note" }, map)).toEqual({
      kind: "sceneButton",
      index: 7,
      pressed: true,
    });
  });

  it("resolves a grid pad note to a gridPad event", () => {
    expect(resolvePhysical({ channel: 0, number: 5, value: 127, messageType: "note" }, map)).toEqual({
      kind: "gridPad",
      index: 5,
      pressed: true,
    });
  });

  it("returns null for an unrecognized number outside every known range", () => {
    expect(resolvePhysical({ channel: 0, number: 120, value: 127, messageType: "note" }, map)).toBeNull();
  });

  it("honors a learned override instead of the default number", () => {
    const overridden = applyOverrides(map, { faders: { 0: 20 } });
    expect(resolvePhysical({ channel: 0, number: 48, value: 10, messageType: "cc" }, overridden)).toBeNull();
    expect(resolvePhysical({ channel: 0, number: 20, value: 10, messageType: "cc" }, overridden)).toEqual({
      kind: "fader",
      index: 0,
      value: 10,
    });
  });
});

describe("captureLearn", () => {
  it("captures a fader CC and rejects a mismatched message type", () => {
    const patch = captureLearn({ kind: "fader", index: 3 }, { messageType: "cc", number: 30 }, {});
    expect(patch?.faders?.[3]).toBe(30);

    const rejected = captureLearn({ kind: "fader", index: 3 }, { messageType: "note", number: 30 }, {});
    expect(rejected).toBeNull();
  });

  it("captures a scene button note and rejects a mismatched message type", () => {
    const patch = captureLearn({ kind: "sceneButton", index: 2 }, { messageType: "note", number: 90 }, {});
    expect(patch?.sceneButtons?.[2]).toBe(90);

    const rejected = captureLearn({ kind: "sceneButton", index: 2 }, { messageType: "cc", number: 90 }, {});
    expect(rejected).toBeNull();
  });
});
