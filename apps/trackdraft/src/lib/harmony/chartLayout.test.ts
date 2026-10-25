import { describe, expect, it } from "vitest";
import type { BlueprintSection, BlueprintSong, Chord } from "../../types/blueprint";
import { layoutChart, positionInChart } from "./chartLayout";

let counter = 0;
function chord(root: string, quality: Chord["quality"], beats = 4): Chord {
  counter += 1;
  return { id: `c${counter}`, root, quality, beats, romanNumeral: "" };
}

function section(over: Partial<BlueprintSection> & { id: string }): BlueprintSection {
  return {
    name: over.id,
    role: "verse",
    bars: 8,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...over,
  } as BlueprintSection;
}

function song(sections: BlueprintSection[], arrangement?: BlueprintSong["arrangement"]): BlueprintSong {
  return {
    id: "song",
    title: "T",
    key: "C",
    scale: "ionian",
    bpm: 120,
    sections,
    arrangement: arrangement ?? sections.map((entry) => ({ sectionId: entry.id, repeats: 1 })),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as BlueprintSong;
}

const label = (event: { roman: string } | null) => event?.roman ?? "—";
const fourBars = () => [chord("C", "maj7"), chord("A", "min7"), chord("D", "min7"), chord("G", "7")];

describe("layoutChart — the tune as a player reads it", () => {
  it("lays an eight-bar section out in two systems of four", () => {
    const song1 = song([section({ id: "a", bars: 8, chords: [...fourBars(), ...fourBars()] })]);
    const [first] = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(first.systems).toHaveLength(2);
    expect(first.systems[0].bars.map((bar) => bar.number)).toEqual([1, 2, 3, 4]);
    expect(first.systems[1].bars.map((bar) => bar.number)).toEqual([5, 6, 7, 8]);
    expect(first.letter).toBe("A");
  });

  it("ends a system where the section ends", () => {
    const song1 = song([section({ id: "a", bars: 6, chords: [...fourBars(), chord("F", "maj", 8)] })]);
    const [first] = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(first.systems.map((system) => system.bars.length)).toEqual([4, 2]);
  });

  it("writes a bar with two chords as two cells on their beats", () => {
    const song1 = song([
      section({ id: "a", bars: 1, chords: [chord("C", "maj", 2), chord("G", "7", 2)] }),
    ]);
    const [first] = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(first.systems[0].bars[0].chords.map((entry) => entry.beat)).toEqual([1, 3]);
    expect(first.systems[0].bars[0].repeatsPrevious).toBe(false);
  });

  it("carries a held chord into the bars it sounds through", () => {
    const song1 = song([section({ id: "a", bars: 4, chords: [chord("C", "maj", 16)] })]);
    const [first] = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    const bars = first.systems[0].bars;
    expect(bars[0].sustained).toBe(false);
    expect(bars.slice(1).every((bar) => bar.sustained)).toBe(true);
    // Still named, so the player isn't reading an empty cell.
    expect(bars[2].chords[0].absolute).toBe("C");
  });

  it("marks a bar that repeats the one before it", () => {
    const song1 = song([
      section({ id: "a", bars: 2, chords: [chord("C", "maj7", 8), chord("C", "maj7", 8)] }),
    ]);
    const [first] = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(first.systems[0].bars[1].repeatsPrevious).toBe(true);
  });

  it("keeps repeats as a count instead of printing the section twice", () => {
    const song1 = song(
      [section({ id: "a", bars: 8, chords: [...fourBars(), ...fourBars()] })],
      [{ sectionId: "a", repeats: 3 }],
    );
    const sections = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(sections).toHaveLength(1);
    expect(sections[0].repeats).toBe(3);
    expect(sections[0].systems).toHaveLength(2);
  });

  it("gives returning material its first letter back", () => {
    const song1 = song([
      section({ id: "a", name: "Verse", bars: 4, chords: fourBars() }),
      section({ id: "b", name: "Chorus", bars: 4, chords: [chord("F", "maj"), chord("G", "7"), chord("C", "maj"), chord("C", "maj")] }),
      section({ id: "a2", name: "Verse", bars: 4, chords: fourBars() }),
    ]);
    const sections = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(sections.map((entry) => entry.letter)).toEqual(["A", "B", "A"]);
    expect(sections[2].returns).toBe(true);
  });

  it("writes a meter change on the bar it happens", () => {
    const song1 = song([
      section({
        id: "a",
        bars: 2,
        chords: [chord("C", "maj", 4), chord("G", "7", 3)],
        meterMap: [{ bar: 1, numerator: 7, denominator: 8 }],
      }),
    ]);
    const [first] = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    const bars = first.systems[0].bars;
    expect(bars[0].meter).toBe("4/4");
    expect(bars[1].meter).toBe("7/8");
    // The second bar is really 3.5 beats long, not 4.
    expect(bars[1].beats).toBeCloseTo(3.5, 5);
  });

  it("writes the meter once, not above every section", () => {
    const song1 = song([
      section({ id: "a", bars: 4, chords: fourBars() }),
      section({ id: "b", bars: 4, chords: fourBars() }),
    ]);
    const sections = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(sections[0].systems[0].bars[0].meter).toBe("4/4");
    expect(sections[1].systems[0].bars[0].meter).toBeNull();
  });

  it("numbers bars continuously across sections", () => {
    const song1 = song([
      section({ id: "a", bars: 4, chords: fourBars() }),
      section({ id: "b", bars: 4, chords: fourBars() }),
    ]);
    const sections = layoutChart(song1, { keyName: "C", scale: "ionian", label });
    expect(sections[1].systems[0].bars[0].number).toBe(5);
  });
});

describe("positionInChart — where the transport is", () => {
  const song1 = song(
    [
      section({ id: "a", bars: 4, chords: fourBars() }),
      section({ id: "b", bars: 4, chords: fourBars() }),
    ],
    [
      { sectionId: "a", repeats: 1 },
      { sectionId: "b", repeats: 2 },
    ],
  );
  const sections = layoutChart(song1, { keyName: "C", scale: "ionian", label });

  it("finds the bar inside the first section", () => {
    expect(positionInChart(sections, 0)).toEqual({ entryIndex: 0, barNumber: 1, pass: 0 });
    expect(positionInChart(sections, 9)).toEqual({ entryIndex: 0, barNumber: 3, pass: 0 });
  });

  it("reports which pass of a repeated section is playing", () => {
    // Section B starts at beat 16 and plays twice: bars 5-8, then 5-8 again.
    expect(positionInChart(sections, 16)).toEqual({ entryIndex: 1, barNumber: 5, pass: 0 });
    expect(positionInChart(sections, 20)).toEqual({ entryIndex: 1, barNumber: 6, pass: 0 });
    // Second pass: 16 beats in, so bar 5 of the repeat is beat 32.
    expect(positionInChart(sections, 32)).toEqual({ entryIndex: 1, barNumber: 5, pass: 1 });
    expect(positionInChart(sections, 36)).toEqual({ entryIndex: 1, barNumber: 6, pass: 1 });
  });

  it("returns null past the end of the chart", () => {
    expect(positionInChart(sections, 16 + 32 + 1)).toBeNull();
  });
});
