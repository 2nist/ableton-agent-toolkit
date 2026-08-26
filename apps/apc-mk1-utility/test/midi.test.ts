import { describe, expect, it } from "vitest";
import { isMk1 } from "../src/lib/midi";

describe("isMk1", () => {
  it("matches the plain device name", () => {
    expect(isMk1("APC mini")).toBe(true);
  });

  it("matches the real underscore-separated CoreMIDI name seen behind an iConnectivity interface", () => {
    // Confirmed from a real Ableton MIDI Preferences screenshot: the actual
    // port name is "APC_mini Input (iConnectAUDIO4+ (HST3))", not "APC mini
    // Input" — the original space-only check silently failed to match this
    // and broke auto-detect entirely.
    expect(isMk1("APC_mini Input (iConnectAUDIO4+ (HST3))")).toBe(true);
  });

  it("excludes the mk2's own name, including its underscore variant", () => {
    expect(isMk1("APC mini mk2")).toBe(false);
    expect(isMk1("APC_mini_mk2 Input (iConnectAUDIO4+ (HST2))")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isMk1("apc_mini input")).toBe(true);
  });
});
