import { describe, expect, it } from "vitest";
import {
  planSectionBass,
  planSectionBassFor,
  type BassOccurrence,
} from "../src/bass.js";

const occurrences: BassOccurrence[] = [
  { rootPc: 0, startTime: 0, duration: 4 },
  { rootPc: 7, startTime: 4, duration: 4 },
];

describe("planSectionBassFor", () => {
  it("is byte-identical to the generator when nothing is authored", () => {
    expect(planSectionBassFor(occurrences)).toEqual(
      planSectionBass(occurrences),
    );
    expect(planSectionBassFor(occurrences, { rhythm: "eighth" }, [])).toEqual(
      planSectionBass(occurrences, { rhythm: "eighth" }),
    );
    expect(planSectionBassFor(occurrences, {}, null)).toEqual(
      planSectionBass(occurrences),
    );
  });

  it("returns the authored notes as written", () => {
    const line = planSectionBassFor(occurrences, {}, [
      { pitch: 36, startTime: 0, duration: 3.5 },
      { pitch: 43, startTime: 3.5, duration: 0.5, velocity: 120 },
    ]);
    expect(line).toEqual([
      { pitch: 36, startTime: 0, duration: 3.5, velocity: 100 },
      { pitch: 43, startTime: 3.5, duration: 0.5, velocity: 120 },
    ]);
  });

  it("takes the profile's velocity for a note that does not name one", () => {
    const line = planSectionBassFor(occurrences, { velocity: 70 }, [
      { pitch: 36, startTime: 0, duration: 2 },
    ]);
    expect(line[0].velocity).toBe(70);
  });
});
