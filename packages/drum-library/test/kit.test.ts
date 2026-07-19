import { describe, expect, it } from "vitest";
import { mapKit, voiceOf } from "../src/kit.js";

describe("voiceOf", () => {
  it("maps the TD-11 extended hi-hat articulations E-GMD actually uses", () => {
    // 22 and 26 are not General MIDI; they appear in the real data and would
    // be dropped entirely by a strict GM table.
    expect(voiceOf(22)).toBe("closedHat");
    expect(voiceOf(26)).toBe("openHat");
  });

  it("keeps the pedal hat distinct from the closed hat", () => {
    expect(voiceOf(44)).toBe("pedalHat");
    expect(voiceOf(42)).toBe("closedHat");
  });

  it("returns null for voices outside the kit", () => {
    expect(voiceOf(1)).toBeNull();
  });
});

describe("mapKit", () => {
  it("distinguishes open from closed hats when the qualifier trails the noun", () => {
    // `Hat C` / `Hat O` is the TR-909 folder's convention. Matching only
    // `open hat`-style names silently mapped both to the closed sample.
    const mapping = mapKit([
      "TR-909Hat C 01.wav",
      "TR-909Hat C 02.wav",
      "TR-909Hat O 01.wav",
      "TR-909Hat O 02.wav",
    ]);
    expect(mapping.get("closedHat")).toBe("TR-909Hat C 01.wav");
    expect(mapping.get("openHat")).toBe("TR-909Hat O 01.wav");
  });

  it("separates the three toms when the qualifier trails the noun", () => {
    const mapping = mapKit(["TR-909Tom Low 01.wav", "TR-909Tom Mid 01.wav", "TR-909Tom Hi 01.wav"]);
    expect(mapping.get("tomLow")).toBe("TR-909Tom Low 01.wav");
    expect(mapping.get("tomMid")).toBe("TR-909Tom Mid 01.wav");
    expect(mapping.get("tomHigh")).toBe("TR-909Tom Hi 01.wav");
  });

  it("does not read CLAP as a closed hat", () => {
    // `cl` prefixes both; ordering the clap rule first is what prevents it.
    const mapping = mapKit(["MaxV - Roland909 - 909CLAP 03.wav", "MaxV - Roland909 - 909HHA 04.wav"]);
    expect(mapping.get("clap")).toBe("MaxV - Roland909 - 909CLAP 03.wav");
    expect(mapping.get("closedHat")).toBe("MaxV - Roland909 - 909HHA 04.wav");
  });

  it("handles terse machine naming with digits fused to letters", () => {
    const mapping = mapKit([
      "MaxV - Roland808 - BD0000 13.wav",
      "MaxV - Roland808 - 808Ch 03.wav",
      "MaxV - Roland808 - 808Oh25 11.wav",
      "MaxV - Roland808 - 808Rs 12.wav",
    ]);
    expect(mapping.get("kick")).toBe("MaxV - Roland808 - BD0000 13.wav");
    expect(mapping.get("closedHat")).toBe("MaxV - Roland808 - 808Ch 03.wav");
    expect(mapping.get("openHat")).toBe("MaxV - Roland808 - 808Oh25 11.wav");
    expect(mapping.get("rim")).toBe("MaxV - Roland808 - 808Rs 12.wav");
  });

  it("prefers the tersely named variant as the canonical sound", () => {
    const mapping = mapKit(["TR-909Kick 01.wav", "TR-909Kick 12.wav", "TR-909Kick long tail.wav"]);
    expect(mapping.get("kick")).toBe("TR-909Kick 01.wav");
  });

  it("never assigns one sample to two voices", () => {
    // A kit whose snare and kick resolve to the same file is a mapping
    // failure worth seeing as a gap, not hiding behind a duplicate.
    const mapping = mapKit(["TR-909Kick 01.wav", "TR-909Snare 01.wav", "TR-909Hat C 01.wav"]);
    const chosen = [...mapping.values()];
    expect(new Set(chosen).size).toBe(chosen.length);
  });

  it("ignores non-wav files", () => {
    const mapping = mapKit(["TR-909Kick 01.wav.asd", "TR-909Kick 01.wav", ".DS_Store"]);
    expect(mapping.get("kick")).toBe("TR-909Kick 01.wav");
  });

  it("returns an empty mapping rather than throwing on an unrecognisable folder", () => {
    expect(mapKit(["readme.txt", "notes.md"]).size).toBe(0);
  });
});
