import { describe, expect, it } from "vitest";
import { resolvePadMapping, remapPitch, type RackReport, type PadReport } from "../src/probe.js";

function pad(receivingNote: number): PadReport {
  return { receivingNote, devices: [], samplePath: null, velocityParameters: [], allParameters: [] };
}

function report(pads: PadReport[]): RackReport {
  return { trackName: "kit", deviceName: "Drum Rack", pads };
}

describe("resolvePadMapping", () => {
  it("maps roles for pads sitting at their assumed note", () => {
    const mapping = resolvePadMapping(report([pad(36), pad(38), pad(42)]));
    expect(mapping).toEqual({ kick: 36, snare: 38, "closed hat": 42 });
  });

  it("leaves a role unresolved rather than guessing when no pad matches it", () => {
    const mapping = resolvePadMapping(report([pad(36)]));
    expect(mapping.snare).toBeUndefined();
    expect(mapping.kick).toBe(36);
  });

  it("ignores pads whose note has no assumed role (e.g. the pedal hi-hat mismatch case)", () => {
    // Note 44 (pedal hi-hat) isn't in ASSUMED at all — a pad reporting it
    // should not resolve to any role, honest about not knowing what it is.
    const mapping = resolvePadMapping(report([pad(44)]));
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it("returns an empty mapping for an empty report", () => {
    expect(resolvePadMapping(report([]))).toEqual({});
  });
});

describe("remapPitch", () => {
  it("is mechanically correct against a hand-built mapping (not one resolvePadMapping can produce today)", () => {
    // resolvePadMapping can never itself set { "closed hat": 44 } — that
    // would require identifying a pad as "closed hat" from something other
    // than it already sitting at note 42 (see resolvePadMapping's own
    // docstring). This test only proves remapPitch's own lookup/fallback
    // logic is correct in isolation, against a mapping built by hand — it
    // is not a claim that resolvePadMapping could ever produce this input.
    const explicitMapping = { "closed hat": 44 } as const;
    expect(remapPitch(42, explicitMapping)).toBe(44);
  });

  it("passes through unchanged when the pitch has no known role", () => {
    expect(remapPitch(60, { kick: 36 })).toBe(60); // 60 isn't in ASSUMED at all
  });

  it("passes through unchanged when the role has no resolved note in the mapping", () => {
    expect(remapPitch(38, { kick: 36 })).toBe(38); // snare's role has no entry
  });

  it("passes through unchanged for an empty mapping", () => {
    expect(remapPitch(36, {})).toBe(36);
  });

  it("is a no-op for ANY mapping resolvePadMapping can actually produce — the real limitation to know about", () => {
    // Proof by construction, not just by example: resolvePadMapping only
    // ever sets mapping[role] = pad.receivingNote when ASSUMED[receivingNote]
    // already equals role — so mapping[role] can only ever be the one note
    // ASSUMED already assigns that role. remapPitch(pitch, mapping) looks up
    // role = ASSUMED[pitch] and returns mapping[role] ?? pitch, which is
    // therefore always pitch itself. Exhaustively checked over every note
    // ASSUMED knows about, from a report that includes every one of them.
    const allAssumedNotes = [36, 37, 38, 39, 42, 45, 46, 47, 49, 51];
    const mapping = resolvePadMapping(report(allAssumedNotes.map(pad)));
    for (const note of allAssumedNotes) {
      expect(remapPitch(note, mapping)).toBe(note);
    }
  });
});
