import { describe, expect, it } from "vitest";
import {
  BAR_PX, X0,
  barX, beatsPerBarOf, gridStepForZoom, snapBeat, spanBeatToX, spanXToBeat, xToSpanBeat,
} from "./beatMap";
import type { SectionSpan } from "../arrangement";
import { beatsPerBar, sectionDurationBeats, type BlueprintSection } from "../../types/blueprint";

function makeSection(overrides: Partial<BlueprintSection>): BlueprintSection {
  return {
    id: "s",
    name: "Section",
    role: "verse",
    bars: 4,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...overrides,
  };
}

function makeSpan(section: BlueprintSection, startBar: number): SectionSpan {
  return {
    sectionId: section.id,
    section,
    occurrenceIndex: 0,
    startBeat: startBar * beatsPerBar(section),
    durationBeats: sectionDurationBeats(section),
    startBar,
    bars: section.bars,
  };
}

describe("beatMap — px ↔ beat mapping", () => {
  it("round-trips a 4/4 span", () => {
    const span = makeSpan(makeSection({}), 0);
    expect(beatsPerBarOf(span)).toBe(4);
    expect(spanBeatToX(span, 4, 1)).toBe(X0 + BAR_PX);
    expect(spanXToBeat(span, X0 + BAR_PX, 1)).toBe(4);
    expect(xToSpanBeat([span], X0 + BAR_PX, 1)?.beat).toBe(4);
  });

  it("handles odd meters (7/8 = 3.5 beats per bar)", () => {
    const span = makeSpan(makeSection({ timeSignatureNumerator: 7, timeSignatureDenPower: 3 }), 0);
    expect(beatsPerBarOf(span)).toBe(3.5);
    expect(spanBeatToX(span, 3.5, 1)).toBe(X0 + BAR_PX);
    expect(spanXToBeat(span, X0 + BAR_PX, 1)).toBe(3.5);
  });

  it("scales with zoom and finds the right span in a sequence", () => {
    const a = makeSpan(makeSection({ id: "a" }), 0);
    const b = makeSpan(makeSection({ id: "b", bars: 4 }), 4);
    const spans = [a, b];
    // Zoom 2 → one bar is twice the base bar width.
    expect(spanBeatToX(a, 4, 2)).toBe(X0 + 2 * BAR_PX);
    const hit = xToSpanBeat(spans, barX(4, 1) + BAR_PX / 2, 1);
    expect(hit?.span.sectionId).toBe("b");
    expect(hit?.beat).toBe(2);
  });

  it("clamps to span bounds and reports outside positions as null", () => {
    const span = makeSpan(makeSection({}), 2);
    expect(spanXToBeat(span, -1000, 1)).toBe(0);
    expect(spanXToBeat(span, 1e6, 1)).toBe(span.durationBeats);
    expect(xToSpanBeat([span], X0 - 1, 1)).toBeNull();
    expect(xToSpanBeat([span], barX(span.startBar + span.bars, 1) + 5, 1)).toBeNull();
  });

  it("snaps to a grid without float noise", () => {
    expect(snapBeat(1.3, 0.25)).toBe(1.25);
    expect(snapBeat(1.4, 0.25)).toBe(1.5);
    expect(snapBeat(3.5, 1)).toBe(4);
    expect(snapBeat(2.0000001, 0.25)).toBe(2);
  });

  it("subdivides the edit grid with zoom (beat by default)", () => {
    expect(gridStepForZoom(0.5)).toBe(1);
    expect(gridStepForZoom(1)).toBe(1);
    expect(gridStepForZoom(1.4)).toBe(1);
    expect(gridStepForZoom(2.39)).toBe(1);
    expect(gridStepForZoom(2.4)).toBe(0.5);
    expect(gridStepForZoom(3.5)).toBe(0.5);
    expect(gridStepForZoom(4.6)).toBe(0.25);
    expect(gridStepForZoom(6)).toBe(0.25);
  });
});
