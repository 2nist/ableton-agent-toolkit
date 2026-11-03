import { describe, expect, it } from "vitest";
import { parseTdpPresetXml, sanitisePresetName, toTdpPresetXml, toTdpSongXml } from "./tdpPreset";
import type { BlueprintSection, BlueprintSong, Chord } from "../../types/blueprint";

/**
 * The plug-in's own output, verbatim.
 *
 * Produced by `plugins/trackdraft` via
 * `TrackDraftTests --dump-xml`, which prints three slots: Cmaj7 blocked,
 * F minor strummed at 150 ms, G7 arpeggiated at 8 subdivisions downward.
 * Parsing these exact bytes is what proves the two implementations agree —
 * a fixture this test wrote for itself would only prove it agrees with itself.
 */
const PLUGIN_DUMP = `<?xml version="1.0" encoding="UTF-8"?>

<TrackDraftPreset version="1" count="3">
  <slot root="0" quality="maj7" beats="4.0" performance="0" param="0"
        direction="2"/>
  <slot root="5" quality="min" beats="2.0" performance="1" param="150"
        direction="2" inversion="1"/>
  <slot root="7" quality="7" beats="8.0" performance="3" param="8" direction="1"/>
</TrackDraftPreset>
`;

function chord(overrides: Partial<Chord>): Chord {
  return {
    id: "c1",
    romanNumeral: "",
    root: "C",
    quality: "maj",
    beats: 4,
    ...overrides,
  };
}

describe("parseTdpPresetXml", () => {
  it("reads the plug-in's exact output", () => {
    const preset = parseTdpPresetXml(PLUGIN_DUMP, "C");

    expect(preset.warnings).toEqual([]);
    expect(preset.chords).toHaveLength(3);

    expect(preset.chords[0]).toMatchObject({ root: "C", quality: "maj7", beats: 4 });
    expect(preset.chords[1]).toMatchObject({ root: "F", quality: "min", beats: 2 });
    expect(preset.chords[2]).toMatchObject({ root: "G", quality: "7", beats: 8 });
  });

  it("reads the inversion the plug-in wrote", () => {
    const preset = parseTdpPresetXml(PLUGIN_DUMP, "C");

    expect(preset.chords[0].voicing).toBeUndefined();
    expect(preset.chords[1].voicing).toEqual({ inversion: 1 });
    expect(preset.chords[2].voicing).toBeUndefined();
  });

  it("carries the articulation across, including arp direction", () => {
    const preset = parseTdpPresetXml(PLUGIN_DUMP, "C");

    expect(preset.chords[0].performance).toBeUndefined();
    expect(preset.chords[1].performance).toEqual({ style: "strum", params: { strumMs: 150 } });
    expect(preset.chords[2].performance).toEqual({
      style: "arp",
      params: { subdivision: 8, direction: 1 },
    });
  });

  it("spells the root in the reading key", () => {
    const preset = parseTdpPresetXml(PLUGIN_DUMP, "Bb");
    // Pitch class 5 is F natural either way; pitch class 0 is C, not B#.
    expect(preset.chords[0].root).toBe("C");
    expect(preset.chords[1].root).toBe("F");
  });

  it("leaves the Roman numeral for the analysis pass to derive", () => {
    const preset = parseTdpPresetXml(PLUGIN_DUMP, "C");
    expect(preset.chords.every((c) => c.romanNumeral === "")).toBe(true);
  });

  it("falls back to major for an unknown quality and says so", () => {
    const xml = `<TrackDraftPreset count="1"><slot root="3" quality="not-a-quality" beats="4"/></TrackDraftPreset>`;
    const preset = parseTdpPresetXml(xml, "C");

    expect(preset.chords[0].quality).toBe("maj");
    expect(preset.warnings[0]).toContain("not-a-quality");
  });

  it("drops an unreadable root rather than inventing one", () => {
    const xml = `<TrackDraftPreset count="2"><slot root="oops" beats="4"/><slot root="7" quality="min7" beats="4"/></TrackDraftPreset>`;
    const preset = parseTdpPresetXml(xml, "C");

    expect(preset.chords).toHaveLength(1);
    expect(preset.chords[0].root).toBe("G");
    expect(preset.warnings).toHaveLength(1);
  });

  it("throws when there is nothing to read", () => {
    expect(() => parseTdpPresetXml("<TrackDraftPreset count=\"0\"></TrackDraftPreset>")).toThrow(
      /no readable slots/,
    );
  });
});

describe("toTdpPresetXml", () => {
  it("writes a preset the plug-in's reader accepts", () => {
    const xml = toTdpPresetXml([
      chord({ root: "C", quality: "maj7", beats: 4 }),
      chord({ root: "F", quality: "min", beats: 2, performance: { style: "strum", params: { strumMs: 150 } } }),
      chord({ root: "G", quality: "7", beats: 8, performance: { style: "arp", params: { subdivision: 8, direction: 1 } } }),
    ]);

    expect(xml).toContain('<TrackDraftPreset version="1" count="3">');
    expect(xml).toContain('<slot root="0" quality="maj7" beats="4" performance="0" param="0" direction="2"/>');
    expect(xml).toContain('<slot root="5" quality="min" beats="2" performance="1" param="150" direction="2"/>');
    expect(xml).toContain('<slot root="7" quality="7" beats="8" performance="3" param="8" direction="1"/>');
  });

  it("round-trips its own output", () => {
    const original = [
      chord({ root: "Bb", quality: "min9", beats: 3.5 }),
      chord({ root: "E", quality: "m7b5", beats: 1, performance: { style: "pulse", params: { subdivision: 6 } } }),
    ];

    const parsed = parseTdpPresetXml(toTdpPresetXml(original), "Bb");

    expect(parsed.chords).toHaveLength(2);
    expect(parsed.chords[0]).toMatchObject({ root: "Bb", quality: "min9", beats: 3.5 });
    expect(parsed.chords[0].performance).toBeUndefined();
    expect(parsed.chords[1]).toMatchObject({ root: "E", quality: "m7b5", beats: 1 });
    expect(parsed.chords[1].performance).toEqual({ style: "pulse", params: { subdivision: 6 } });
  });

  it("uses the plug-in's defaults when an articulation has no parameters", () => {
    const xml = toTdpPresetXml([
      chord({ performance: { style: "strum" } }),
      chord({ performance: { style: "pulse" } }),
    ]);

    expect(xml).toContain('performance="1" param="150"');
    expect(xml).toContain('performance="2" param="4"');
  });

  it("round-trips a voicing", () => {
    const original = [
      chord({ root: "C", quality: "maj", voicing: { inversion: 1 } }),
      chord({ root: "G", quality: "min7", voicing: { inversion: 2, spread: "open" } }),
      chord({ root: "A", quality: "min" }),
    ];

    const xml = toTdpPresetXml(original);

    // Root position writes nothing, so a chord without a voicing is byte-for-byte
    // what it was before voicings existed.
    expect(xml).toContain('root="0" quality="maj" beats="4" performance="0" param="0" direction="2" inversion="1"/>');
    expect(xml).toContain('root="7" quality="min7" beats="4" performance="0" param="0" direction="2" inversion="2" spread="open"/>');

    const parsed = parseTdpPresetXml(xml, "C");
    expect(parsed.chords[0].voicing).toEqual({ inversion: 1 });
    expect(parsed.chords[1].voicing).toEqual({ inversion: 2, spread: "open" });
    expect(parsed.chords[2].voicing).toBeUndefined();
  });

  it("warns about an impossible inversion instead of trusting it", () => {
    const xml = `<TrackDraftPreset count="1"><slot root="0" quality="maj" beats="4" inversion="99"/></TrackDraftPreset>`;
    const preset = parseTdpPresetXml(xml, "C");

    expect(preset.chords[0].voicing).toBeUndefined();
    expect(preset.warnings.join(" ")).toContain("99");
  });

  it("escapes a quality id so the attribute cannot break the document", () => {
    const xml = toTdpPresetXml([chord({ quality: 'maj"><script>' as Chord["quality"] })]);
    expect(xml).toContain("&quot;&gt;&lt;script&gt;");
    expect(xml).not.toContain('maj"><script>');
  });
});

/**
 * The plug-in's filename rule over awkward names, verbatim.
 *
 * Produced by `TrackDraftTests --dump-names`; each line is `input <TAB> output`.
 * The same rule lives in `PresetStore::sanitiseName` (C++), `sanitisePresetName`
 * here, and `sanitisePresetName` in `electron/main.cjs` — a fixture written on
 * one side is the only way to notice the three drifting apart.
 */
const PLUGIN_NAME_DUMP = [
  "Late Night\tLate Night",
  "Café Minor\tCafé Minor",
  "Chaos/../../etc/passwd\tChaos....etcpasswd",
  "  ..hidden  \thidden",
  "\tUntitled",
  "🔥🔥🔥\t🔥🔥🔥",
  "Song: Part 2 (draft)\tSong Part 2 (draft)",
].join("\n");

describe("sanitisePresetName", () => {
  it.each(
    PLUGIN_NAME_DUMP.split("\n").map((line) => {
      const [input, output] = line.split("\t");
      return [input, output] as const;
    }),
  )("matches the plug-in for %j", (input, output) => {
    expect(sanitisePresetName(input)).toBe(output);
  });

  it("truncates by character so a surrogate pair is never split", () => {
    expect(sanitisePresetName("A".repeat(100))).toBe("A".repeat(64));
    expect(sanitisePresetName("🔥".repeat(70))).toBe("🔥".repeat(64));
  });
});

/**
 * The whole song, as the plug-in's song player wants it.
 *
 * This literal is also parsed by `plugins/trackdraft/Tests/PluginTests.cpp`
 * (`testSongXml`), so "the app writes it" and "the plug-in reads it" are checked
 * against one string rather than against each other's assumptions.
 */
const APP_SONG_XML = `<?xml version="1.0" encoding="UTF-8"?>

<TrackDraftSong version="2" count="2">
  <section name="Verse">
    <progression version="1" count="2">
      <slot root="9" quality="min" beats="4" performance="1" param="150" direction="2" inversion="1"/>
      <slot root="2" quality="maj" beats="4" performance="0" param="0" direction="2"/>
      <bass octave="3" motion="root" rhythm="locked" velocity="100"/>
    </progression>
  </section>
  <section name="Chorus">
    <progression version="1" count="2">
      <slot root="5" quality="maj" beats="4" performance="0" param="0" direction="2"/>
      <slot root="7" quality="7" beats="4" performance="3" param="8" direction="1"/>
      <bass octave="2" motion="walking" rhythm="eighth" velocity="88"/>
    </progression>
  </section>
  <arrangement>
    <pass section="0" repeats="1"/>
    <pass section="1" repeats="2"/>
  </arrangement>
</TrackDraftSong>
`;

function song(): BlueprintSong {
  const section = (id: string, name: string, chords: Chord[], bassProfile?: BlueprintSection["bassProfile"]) => ({
    id,
    name,
    role: "verse" as const,
    bars: 2,
    chords,
    beatsPerChord: 4,
    velocity: "mf" as const,
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    ...(bassProfile ? { bassProfile } : {}),
  });

  return {
    id: "song-1",
    title: "Test Song",
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
    sections: [
      section("s1", "Verse", [
        chord({
          root: "A",
          quality: "min",
          beats: 4,
          performance: { style: "strum", params: { strumMs: 150 } },
          voicing: { inversion: 1 },
        }),
        chord({ root: "D", quality: "maj", beats: 4 }),
      ]),
      section("s2", "Chorus", [
        chord({ root: "F", quality: "maj", beats: 4 }),
        chord({ root: "G", quality: "7", beats: 4, performance: { style: "arp", params: { subdivision: 8, direction: 1 } } }),
      ], { octave: 2, motion: "walking", rhythm: "eighth", velocity: 88 }),
    ],
    arrangement: [
      { sectionId: "s1", repeats: 1 },
      { sectionId: "s2", repeats: 2 },
    ],
  } as unknown as BlueprintSong;
}

describe("toTdpSongXml", () => {
  it("writes the bytes the plug-in is tested against", () => {
    expect(toTdpSongXml(song())).toBe(APP_SONG_XML);
  });

  it("carries a voicing into the song file", () => {
    expect(toTdpSongXml(song())).toContain(
      '<slot root="9" quality="min" beats="4" performance="1" param="150" direction="2" inversion="1"/>',
    );
  });

  it("leaves out a section with no chords without shifting the arrangement", () => {
    const withEmpty = song();
    withEmpty.sections.splice(1, 0, {
      ...withEmpty.sections[0],
      id: "empty",
      name: "Empty",
      chords: [],
    });

    const xml = toTdpSongXml(withEmpty);

    expect(xml).toContain('count="2"');
    expect(xml).not.toContain('name="Empty"');
    expect(xml).toContain('<pass section="1" repeats="2"/>');
  });

  it("escapes a section name so the attribute cannot break the document", () => {
    const named = song();
    named.sections[0].name = 'Verse "loud" & <fast>';
    const xml = toTdpSongXml(named);
    expect(xml).toContain('name="Verse &quot;loud&quot; &amp; &lt;fast&gt;"');
  });
});
