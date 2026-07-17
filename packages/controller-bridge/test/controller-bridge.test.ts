/**
 * Baseline regression suite for the ported @hardware/controller-bridge.
 * See @music-theory/core's test file for why this exists despite not
 * mirroring an upstream suite — there wasn't one to mirror.
 */

import { describe, expect, it } from "vitest";
import {
  APC_MINI_MK2,
  APC_MINI_MK2_MAPPINGS,
  APC_MINI_MK2_MODES,
  ATOMSQ,
  ATOMSQ_MAPPINGS,
  ATOMSQ_MODES,
  ControllerBridge,
} from "../src/index.js";

describe("ControllerBridge.getMidi", () => {
  const bridge = new ControllerBridge(APC_MINI_MK2, APC_MINI_MK2_MAPPINGS, APC_MINI_MK2_MODES);

  it("resolves a direct control by name", () => {
    expect(bridge.getMidi("shift_button")).toBe(122);
  });

  it("resolves an indexed matrix element ('name[index]')", () => {
    // track_buttons matrix starts at CC 100
    expect(bridge.getMidi("track_buttons[4]")).toBe(104);
  });

  it("returns null for a whole-matrix reference with no index", () => {
    // getMidi only understands single elements (direct controls or "name[index]"),
    // not a bare matrix name like "faders" — see README gotcha.
    expect(bridge.getMidi("faders")).toBeNull();
  });

  it("returns null for a name that doesn't exist anywhere", () => {
    expect(bridge.getMidi("not_a_real_element")).toBeNull();
  });
});

describe("ControllerBridge.getElementNames", () => {
  it("includes both direct controls and matrix names", () => {
    const bridge = new ControllerBridge(APC_MINI_MK2, APC_MINI_MK2_MAPPINGS, APC_MINI_MK2_MODES);
    const names = bridge.getElementNames();
    expect(names).toContain("shift_button"); // control
    expect(names).toContain("faders"); // matrix
  });
});

describe("ControllerBridge.validate", () => {
  it("flags whole-matrix mapping references as unresolvable — a known gap in getMidi, not introduced by this port", () => {
    // The shipped APC_MINI_MK2_MAPPINGS maps several properties directly to a
    // whole matrix (e.g. mixer.volume_controls -> "faders"), but getMidi()
    // only resolves single elements. validate() therefore reports these as
    // errors against the controller's own shipped preset. Treat validate()
    // as diagnostic rather than a pass/fail gate until whole-matrix
    // resolution is added to getMidi.
    const bridge = new ControllerBridge(APC_MINI_MK2, APC_MINI_MK2_MAPPINGS, APC_MINI_MK2_MODES);
    const result = bridge.validate();
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('"faders"'))).toBe(true);
  });

  it("passes for a mapping that only references direct controls and indexed matrix elements", () => {
    const bridge = new ControllerBridge(APC_MINI_MK2, {
      mixer: {},
      session: {},
      transport: { play_button: "not_mapped" },
      device: {},
      navigation: { up_button: "track_buttons[4]" },
      subModes: {},
    }, APC_MINI_MK2_MODES);
    expect(bridge.validate()).toEqual({ valid: true, errors: [] });
  });
});

describe("ControllerBridge.toReaLearnPreset", () => {
  it("exports a preset with mappings only for resolvable, non-'not_mapped' elements", () => {
    const bridge = new ControllerBridge(APC_MINI_MK2, APC_MINI_MK2_MAPPINGS, APC_MINI_MK2_MODES);
    const preset = bridge.toReaLearnPreset();
    expect(preset.controller).toBe("APC mini mk2");
    expect(preset.mappings.length).toBeGreaterThan(0);
    // "transport" mappings are all "not_mapped" for this controller — none should appear
    expect(preset.mappings.some((m) => m.label?.startsWith("APC mini mk2: play_button"))).toBe(false);
  });

  it("resolves the source channel/messageType from the underlying hardware element", () => {
    const bridge = new ControllerBridge(APC_MINI_MK2, APC_MINI_MK2_MAPPINGS, APC_MINI_MK2_MODES);
    const preset = bridge.toReaLearnPreset();
    const masterVolume = preset.mappings.find((m) => m.label?.includes("master_track_volume_control"));
    expect(masterVolume?.source).toMatchObject({ type: "midi", number: 56, messageType: "cc" });
  });
});

describe("ATOMSQ controller", () => {
  it("builds and validates the same way as APC mini mk2 (also has whole-matrix mapping references)", () => {
    const bridge = new ControllerBridge(ATOMSQ, ATOMSQ_MAPPINGS, ATOMSQ_MODES);
    expect(bridge.getMidi("shift_button")).toBe(31);
    expect(bridge.getMidi("encoders[0]")).toBe(14);
  });
});

describe("mode definitions", () => {
  it("APC_MINI_MK2_MODES defaults reference a mode that actually exists in its group", () => {
    for (const [group, defaultName] of Object.entries(APC_MINI_MK2_MODES.defaults)) {
      const modes = APC_MINI_MK2_MODES.groups[group] ?? [];
      expect(modes.some((m) => m.name === defaultName)).toBe(true);
    }
  });

  it("ATOMSQ_MODES defaults reference a mode that actually exists in its group", () => {
    for (const [group, defaultName] of Object.entries(ATOMSQ_MODES.defaults)) {
      const modes = ATOMSQ_MODES.groups[group] ?? [];
      expect(modes.some((m) => m.name === defaultName)).toBe(true);
    }
  });
});
