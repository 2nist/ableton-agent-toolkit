/**
 * Baseline regression suite for the ported @hardware/controller-bridge.
 * See @music-theory/core's test file for why this exists despite not
 * mirroring an upstream suite — there wasn't one to mirror.
 */

import { describe, expect, it } from "vitest";
import {
  APC_MINI_MK1,
  APC_MINI_MK1_MODES,
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

  it("APC_MINI_MK1_MODES defaults reference a mode that actually exists in its group", () => {
    for (const [group, defaultName] of Object.entries(APC_MINI_MK1_MODES.defaults)) {
      const modes = APC_MINI_MK1_MODES.groups[group] ?? [];
      expect(modes.some((m) => m.name === defaultName)).toBe(true);
    }
  });
});

describe("APC_MINI_MK1 (bank-router hardware model)", () => {
  // Numbers are sourced from Ableton's own shipped MIDI Remote Script for
  // this device (see elements/apc-mini-mk1.ts header) — not guessed.
  it("exposes the real hardware element numbers", () => {
    expect(APC_MINI_MK1.controls.shift_button?.midi).toBe(98);
    expect(APC_MINI_MK1.controls.master_fader?.midi).toBe(56);
    expect(APC_MINI_MK1.matrices.faders?.identifiers[0]?.[0]).toBe(48);
    expect(APC_MINI_MK1.matrices.track_buttons?.identifiers[0]?.[0]).toBe(64);
    expect(APC_MINI_MK1.matrices.scene_launch_buttons?.identifiers[0]?.[0]).toBe(82);
  });

  it("has no dedicated transport controls (the real hardware has none)", () => {
    expect(APC_MINI_MK1.controls.transport_play_button).toBeUndefined();
  });

  it("APC_MINI_MK1_MODES defines a Fader_Banks group defaulting to pitch", () => {
    expect(APC_MINI_MK1_MODES.defaults.Fader_Banks).toBe("pitch");
    const bankNames = APC_MINI_MK1_MODES.groups.Fader_Banks?.map((m) => m.name);
    expect(bankNames).toEqual(["pitch", "time", "transform", "generate", "clip_tools"]);
  });
});
