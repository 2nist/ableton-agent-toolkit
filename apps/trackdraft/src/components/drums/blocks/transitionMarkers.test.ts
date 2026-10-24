import { describe, expect, it } from "vitest";
import { sectionMarkers, type MarkerSpan } from "./transitionMarkers";
import type { BlueprintSection } from "../../../types/blueprint";

/** A 4/4 section of `bars` bars; `extra` overrides the drum fields. */
const sec = (id: string, bars: number, extra: Partial<BlueprintSection> = {}): BlueprintSection =>
  ({
    id,
    name: id,
    role: "verse",
    bars,
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    chords: [],
    velocity: 100,
    ...extra,
  }) as BlueprintSection;

const span = (section: BlueprintSection, durationBeats?: number): MarkerSpan => ({
  sectionId: section.id,
  occurrenceIndex: 0,
  durationBeats: durationBeats ?? section.bars * 4,
  section,
  hasVariant: true,
});

describe("sectionMarkers — the rail's readout", () => {
  it("places an automatic transition on the section's last bar", () => {
    const [a] = sectionMarkers([span(sec("A", 8, { role: "verse" })), span(sec("B", 8, { role: "chorus" }))]);
    expect(a.transition).not.toBeNull();
    expect(a.transition!.manual).toBe(false);
    expect(a.transition!.endBeat).toBe(32);
    expect(a.transition!.startBeat).toBe(32 - a.transition!.bars * 4);
  });

  it("gives the last section no handoff at all", () => {
    const markers = sectionMarkers([span(sec("A", 8)), span(sec("B", 8))]);
    expect(markers[1].transition).toBeNull();
  });

  it("prefers the authored model and its bar count over the role plan", () => {
    const [a] = sectionMarkers([
      span(sec("A", 8, { drumTransitionModel: "cut", drumTransitionBars: 2 } as Partial<BlueprintSection>)),
      span(sec("B", 8)),
    ]);
    expect(a.transition).toMatchObject({ model: "cut", manual: true, bars: 2, startBeat: 24, endBeat: 32 });
  });

  it("clamps an authored bar count to the section length", () => {
    const [a] = sectionMarkers([
      span(sec("A", 2, { drumTransitionModel: "cut", drumTransitionBars: 9 } as Partial<BlueprintSection>)),
      span(sec("B", 8)),
    ]);
    expect(a.transition).toMatchObject({ bars: 2, startBeat: 0, endBeat: 8 });
  });

  it("hangs the detour at the section's end when no start beat is authored", () => {
    const [a] = sectionMarkers([
      span(
        sec("A", 8, {
          drumVariationOutline: { cells: [3, 3], cellBeats: 2, label: "3 3" },
          drumVariationBars: 1,
        } as Partial<BlueprintSection>),
      ),
    ]);
    expect(a.detour).toEqual({ startBeat: 28, endBeat: 32 });
  });

  it("honours an authored detour start and clamps it inside the section", () => {
    const withStart = (beat: number) =>
      sectionMarkers([
        span(
          sec("A", 8, {
            drumVariationOutline: { cells: [3, 3], cellBeats: 2, label: "3 3" },
            drumVariationBars: 2,
            drumVariationStartBeat: beat,
          } as Partial<BlueprintSection>),
        ),
      ])[0].detour;
    expect(withStart(16)).toEqual({ startBeat: 16, endBeat: 24 });
    // 2 bars need 8 beats, so the start can never pass 32 − 8 = 24
    expect(withStart(99)).toEqual({ startBeat: 24, endBeat: 32 });
    expect(withStart(-4)).toEqual({ startBeat: 0, endBeat: 8 });
  });

  it("reads the author's beats against the section's own meter", () => {
    const [a] = sectionMarkers([
      span(
        sec("A", 4, {
          timeSignatureNumerator: 6,
          timeSignatureDenPower: 3,
          drumVariationOutline: { cells: [3], cellBeats: 2, label: "3" },
        } as Partial<BlueprintSection>),
        4 * 3,
      ),
    ]);
    expect(a.detour).toEqual({ startBeat: 9, endBeat: 12 });
  });

  it("reports no handoff for a section that resolves to no groove", () => {
    const markers = sectionMarkers([
      { ...span(sec("A", 8)), hasVariant: false },
      span(sec("B", 8, { role: "chorus" })),
    ]);
    expect(markers[0].transition).toBeNull();
  });
});
