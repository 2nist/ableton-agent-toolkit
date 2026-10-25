import { describe, expect, it } from "vitest";
import type { BlueprintSong, BlueprintSection, Chord } from "../../types/blueprint";
import { decodeChordString, encodeChordString, type IrealSection } from "./chordString";
import { encodeIrealUrl, irealPlaylistHtml, irealSymbol, scramble, toIrealSections } from "./encodeSong";

let counter = 0;
function chord(root: string, quality: Chord["quality"], beats = 4): Chord {
  counter += 1;
  return { id: `c${counter}`, root, quality, beats, romanNumeral: "" };
}

function section(over: Partial<BlueprintSection> & { id: string }): BlueprintSection {
  return {
    name: over.id,
    role: "verse",
    bars: 4,
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
    title: "Test Tune",
    artist: "Nobody",
    key: "C",
    scale: "ionian",
    bpm: 132,
    sections,
    arrangement: arrangement ?? sections.map((entry) => ({ sectionId: entry.id, repeats: 1 })),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as BlueprintSong;
}

const fourBars = () => [chord("C", "maj7"), chord("A", "min7"), chord("D", "min7"), chord("G", "7")];

describe("irealSymbol — the dialect iReal writes", () => {
  it("uses iReal's own shorthand", () => {
    expect(irealSymbol("C", "maj")).toBe("C");
    expect(irealSymbol("D", "min7")).toBe("D-7");
    expect(irealSymbol("F", "maj7")).toBe("F^7");
    expect(irealSymbol("B", "m7b5")).toBe("Bh7");
    expect(irealSymbol("C♯", "dim7")).toBe("C#o7");
    expect(irealSymbol("G", "7b9")).toBe("G7b9");
    expect(irealSymbol("E♭", "maj13")).toBe("Eb^13");
  });
});

describe("encodeChordString — bars, sections and repeats", () => {
  it("writes an eight-bar tune as two sections of four bars", () => {
    const plain = encodeChordString([
      { letter: "A", repeats: 1, bars: fourBars().map((entry) => ({ meter: null, cells: [{ symbol: irealSymbol(entry.root, entry.quality), beat: 1 }] })) },
    ]);
    expect(plain.startsWith("*A")).toBe(true);
    expect(plain.endsWith("Z")).toBe(true);
    // Four barlines for four bars, each chord given the rest of its bar.
    expect(plain.split("|")).toHaveLength(4);
    expect(plain).toContain("C^7XyQ");
  });

  it("writes two chords on beats 1 and 3 with a space, four with commas", () => {
    const two = encodeChordString([
      { letter: "A", repeats: 1, bars: [{ meter: null, cells: [{ symbol: "C", beat: 1 }, { symbol: "G7", beat: 3 }] }] },
    ]);
    expect(two).toContain("C G7");
    const four = encodeChordString([
      {
        letter: "A",
        repeats: 1,
        bars: [
          {
            meter: null,
            cells: [
              { symbol: "C", beat: 1 },
              { symbol: "A-7", beat: 2 },
              { symbol: "D-7", beat: 3 },
              { symbol: "G7", beat: 4 },
            ],
          },
        ],
      },
    ]);
    expect(four).toContain("C,A-7,D-7,G7,");
  });

  it("brackets a section that repeats", () => {
    const plain = encodeChordString([{ letter: "B", repeats: 3, bars: [{ meter: null, cells: [{ symbol: "F", beat: 1 }] }] }]);
    expect(plain.startsWith("*B{")).toBe(true);
    expect(plain).toContain("}");
  });

  it("writes a meter change on its bar", () => {
    const plain = encodeChordString([
      { letter: "A", repeats: 1, bars: [{ meter: "4/4", cells: [{ symbol: "C", beat: 1 }] }, { meter: "7/8", cells: [{ symbol: "G", beat: 1 }] }] },
    ]);
    expect(plain).toContain("T44");
    expect(plain).toContain("T78");
  });
});

describe("round trip — what we write, we can read", () => {
  const readBack = (sections: IrealSection[]) =>
    decodeChordString(encodeChordString(sections));

  it("keeps every bar and chord of a four-bar tune", () => {
    const song1 = song([section({ id: "a", chords: fourBars() })]);
    const sections = toIrealSections(song1);
    const back = readBack(sections);
    expect(back).toHaveLength(1);
    expect(back[0].letter).toBe("A");
    expect(back[0].bars).toHaveLength(4);
    expect(back[0].bars.map((bar) => bar.cells[0].symbol)).toEqual(["C^7", "A-7", "D-7", "G7"]);
  });

  it("keeps the beats of a bar with two chords", () => {
    const song1 = song([section({ id: "a", bars: 1, chords: [chord("C", "maj", 2), chord("G", "7", 2)] })]);
    const back = readBack(toIrealSections(song1));
    expect(back[0].bars[0].cells.map((cell) => `${cell.symbol}@${cell.beat}`)).toEqual(["C@1", "G7@3"]);
  });

  it("keeps the section order, letters and repeat count", () => {
    const song1 = song(
      [
        section({ id: "a", bars: 4, chords: fourBars() }),
        section({ id: "b", bars: 4, chords: [chord("F", "maj"), chord("G", "7"), chord("C", "maj"), chord("C", "maj")] }),
      ],
      [
        { sectionId: "a", repeats: 1 },
        { sectionId: "b", repeats: 2 },
      ],
    );
    const back = readBack(toIrealSections(song1));
    expect(back.map((entry) => entry.letter)).toEqual(["A", "B"]);
    expect(back[1].repeats).toBe(2);
    expect(back[1].bars).toHaveLength(4);
  });

  it("keeps a meter change", () => {
    const song1 = song([
      section({
        id: "a",
        bars: 2,
        chords: [chord("C", "maj"), chord("G", "7", 3)],
        meterMap: [{ bar: 1, numerator: 7, denominator: 8 }],
      }),
    ]);
    const back = readBack(toIrealSections(song1));
    expect(back[0].bars[0].meter).toBe("4/4");
    expect(back[0].bars[1].meter).toBe("7/8");
  });

  it("survives the obfuscation", () => {
    const music = encodeChordString(toIrealSections(song([section({ id: "a", chords: fourBars() })])));
    expect(scramble(scramble(music))).toBe(music);
  });
});

describe("encodeIrealUrl — the field order iReal expects", () => {
  const song1 = song([section({ id: "a", chords: fourBars() })]);
  const url = encodeIrealUrl(song1, { style: "Medium Swing" });

  it("starts with the scheme and carries the music prefix", () => {
    expect(url.startsWith("irealb://")).toBe(true);
    expect(decodeURIComponent(url)).toContain("=1r34LbKcu7");
  });

  it("puts title, composer, style, key, music, style, bpm and repeats in order", () => {
    const fields = decodeURIComponent(url).replace("irealb://", "").split("=");
    expect(fields[0]).toBe("Test Tune");
    expect(fields[1]).toBe("Nobody");
    expect(fields[2]).toBe("Medium Swing");
    expect(fields[3]).toBe("C");
    expect(fields[4].startsWith("1r34LbKcu7")).toBe(true);
    expect(fields[5]).toBe("Medium Swing");
    expect(fields[6]).toBe("132");
    expect(fields[7]).toBe("1");
  });

  it("wraps a playlist iReal can open", () => {
    const html = irealPlaylistHtml([{ title: "Test Tune", composer: "Nobody", url }]);
    expect(html).toContain("iReal Pro");
    expect(html).toContain('href="irealb://');
    expect(html).toContain("Test Tune");
  });
});
