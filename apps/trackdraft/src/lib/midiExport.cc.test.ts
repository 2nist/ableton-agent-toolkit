import { describe, expect, it } from "vitest";
import { planDrumCcStem, songToMidi } from "./midiExport";
import { sectionSpans } from "./arrangement";

/**
 * Per-lane CC must reach the FILE, not just the UI: `planDrumCcStem` feeds
 * the drum track's controller events, and the events are ON the wire after
 * `songToMidi`.
 */
const song = (extra: Record<string, unknown> = {}) =>
  ({
    id: "s1", title: "CC probe", bpm: 120, key: "C", scale: "ionian",
    arrangement: [],
    sections: [{
      id: "sec1", name: "A", role: "verse", bars: 2,
      timeSignatureNumerator: 4, timeSignatureDenPower: 2,
      velocity: 100, drumPattern: "standard",
      chords: [{ id: "c1", root: "C", quality: "maj", beats: 4 }],
      ...extra,
    }],
  }) as any;

describe("per-lane CC", () => {
  it("plans a static value as a single message at the section start", () => {
    const cc = planDrumCcStem(sectionSpans(song({ drumLaneCc: { hat: { cc: 4, from: 64, to: 64 } } })));
    expect(cc).toEqual([{ beat: 0, cc: 4, value: 64 }]);
  });

  it("ramps across the section and off-sets later sections", () => {
    const ramped = planDrumCcStem(sectionSpans(song({ drumLaneCc: { cym: { cc: 74, from: 0, to: 127 } } })));
    expect(ramped.map((e) => e.beat)).toEqual([0, 4, 8]);
    expect(ramped[0].value).toBe(0);
    expect(ramped[ramped.length - 1].value).toBe(127);
  });

  it("emits nothing for a muted lane", () => {
    const s = song({ drumLaneCc: { hat: { cc: 4, from: 0, to: 100 } }, drumLaneMute: ["hat"] });
    expect(planDrumCcStem(sectionSpans(s))).toEqual([]);
  });

  it("writes real CC bytes (0xB0|ch) into the .mid drum track", () => {
    const withCc = songToMidi(song({ drumLaneCc: { hat: { cc: 4, from: 20, to: 20 } } }));
    const without = songToMidi(song());
    // byte 4 = 20 (0x14), controller 4, status 0xB0|channel
    const hasCcEvent = (bytes: Uint8Array) => {
      for (let i = 0; i + 2 < bytes.length; i++) {
        if ((bytes[i] & 0xf0) === 0xb0 && bytes[i + 1] === 4 && bytes[i + 2] === 20) return true;
      }
      return false;
    };
    expect(hasCcEvent(withCc)).toBe(true);
    expect(hasCcEvent(without)).toBe(false);
    expect(withCc.length).toBeGreaterThan(without.length);
  });
});
