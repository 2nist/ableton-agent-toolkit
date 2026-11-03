import { noteName, pitchClass } from "@music-theory/core";
import {
  BI_TONAL_MATRIX,
  DEFAULT_COLOR_FLAVOR,
  resolveFlavor,
} from "@platform/progression-engine";
import {
  conductSection,
  planSectionBassFor,
  resolveBassProfile,
  type BassNote,
  resolveChordOccurrences,
  resolveEffectiveStyle,
  resolveNarrativeProfile,
  narrativeHarmonySection,
  styleSpacing,
} from "@drum/library";
import {
  sectionDurationBeats,
  type BlueprintSection,
  type BlueprintSong,
} from "../../types/blueprint";

/**
 * The two generated voices, as marks on the floor's pitch axis.
 *
 * The Voices tab used to describe these as settings — "bass and colour are
 * section-wide, they colour every chord" — which told the writer nothing about
 * where the voices actually GO. Both voices have a definite pitch at a
 * definite time, so they can be drawn on the same axis as the chords:
 *
 *  - **bass** as thin bars, one per generated note. Not one bar per chord:
 *    `planSectionBass` emits 1 note per chord on "Per chord", 2 on "Half", 4 on
 *    "8ths", and `Root+5th` / `Walking` move the line off the root — a single
 *    wide rectangle would hide exactly what the control changes.
 *  - **colour** as one mark per chord, at the root of the bi-tonal chord the
 *    flavour produces (`root + recipe.shift`), sustained for the chord.
 *
 * The axis is the floor's: TWELVE CHROMATIC PITCH CLASSES, not octaves. The
 * bass register and the colour octave therefore collapse onto the same rows —
 * a bass note on the chord's root shares its row with the chord, which is
 * accurate (it IS the root) and is why the bars are drawn thinner and in
 * front rather than competing with the box.
 *
 * Both marks come from the SAME planners the exports use (`planSectionBassFor`,
 * `resolveFlavor`), so what is drawn cannot drift from what is heard.
 */

/** One mark on the floor: a pitch class over a span, in section beats. */
export interface VoiceMark {
  /** Chromatic semitones above the tonic, 0-11 — the ladder's x axis. */
  step: number;
  start: number;
  duration: number;
  /** For the reader: the note name (bass), or the colour chord's quality
   *  label — "m11", "Maj9". */
  label: string;
  /** The colour chord's SYMBOL, built from the root and the triad family the
   *  engine actually stacks. Not root + `label`: several flavour labels name a
   *  texture the recipe does not build (`neo_soul_glow` labels itself "m11" but
   *  its `quality` is "maj", so the notes are a plain major triad). Absent on
   *  bass marks, whose `label` is already the note. */
  name?: string;
  /**
   * True when the colour chord is a UNISON of its anchor — the engine's
   * fallback when a flavour has no recipe for the chord's family (the default
   * `neo_soul_glow` is minor-only, so every major chord falls back). Drawn
   * fainter, because a colour chord that adds no note is not adding colour.
   */
  plain?: boolean;
}

/** The chord-symbol suffix for a triad family, so a mark never claims a
 *  quality the engine does not play. */
const QUALITY_SYMBOL: Record<string, string> = {
  maj: "",
  min: "m",
  "7": "7",
  maj7: "maj7",
  min7: "m7",
  m7b5: "m7b5",
  dim: "dim",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
};

/** Semitones above the tonic, which is what the ladder's rows count. */
function stepOf(pc: number, tonic: number): number {
  return (((pc - tonic) % 12) + 12) % 12;
}

/** The section's chords resolved onto the full section, with the same
 *  occurrence math (and Bend spacing) the exports use. */
function occurrences(
  section: BlueprintSection,
  song: BassSongSource | undefined,
) {
  const profile = resolveEffectiveStyle(section, song);
  const narrative = resolveNarrativeProfile(section, song);
  return resolveChordOccurrences(
    narrativeHarmonySection(section, narrative),
    sectionDurationBeats(section),
    styleSpacing(profile.density),
  ).map((occ) => ({
    chord: occ.chord,
    rootPc: pitchClass(occ.chord.root),
    startTime: occ.startTime,
    duration: occ.duration,
  }));
}

/**
 * The section's bass line in MIDI terms: the authored notes when it has any,
 * the generated `bassProfile` line otherwise.
 *
 * The ONE resolve. `bassVoiceMarks` (the ladder), `midiExport`'s bass stem and
 * the bridge's `planBassLine` all go through this or through
 * `planSectionBassFor` directly, which is what stops an authored line from
 * sounding one way in the app and another in Live.
 */
/** What the bass resolve needs from the song: the style/narrative inputs, not
 *  the whole song (§S1.6 — a canvas column holds only these). */
export type BassSongSource = NonNullable<
  Parameters<typeof resolveEffectiveStyle>[1]
> & {
  /** The song's key, when a call site wants the section to fall back to it. */
  key?: string;
};

export function sectionBassLine(
  section: BlueprintSection,
  keyName: string,
  song?: BassSongSource,
): BassNote[] {
  const profile = resolveEffectiveStyle(section, song);
  const occ = occurrences(section, song);
  // The chords above are already conducted (the resolver reads the clock), so an
  // authored line has to be conducted too — otherwise the notes stay on the
  // local grid while the changes move out from under them (§P3.6).
  const conducted = conductSection(section, sectionDurationBeats(section));
  return planSectionBassFor(
    occ.map(({ rootPc, startTime, duration }) => ({
      rootPc,
      startTime,
      duration,
    })),
    resolveBassProfile(section.bassProfile, profile),
    conducted.bassNotes,
  );
}

/** Every note of the generated Bass track, as bars on the ladder. */
export function bassVoiceMarks(
  section: BlueprintSection,
  keyName: string,
  song?: BlueprintSong,
): VoiceMark[] {
  const tonic = pitchClass(keyName);
  const occ = occurrences(section, song);
  const line = sectionBassLine(section, keyName, song);
  return line.map((note) => {
    // Spelled against the CHORD's written root, not the section's key: the
    // key only names a pitch class, and `noteName` can only choose sharps or
    // flats from it (D major is sharp, D aeolian is flat — same letter). The
    // chord root is the author's own spelling, so a Bb chord reads Bb.
    const owner =
      occ.find(
        (entry) =>
          note.startTime >= entry.startTime - 1e-6 &&
          note.startTime < entry.startTime + entry.duration - 1e-6,
      ) ?? occ[0];
    return {
      step: stepOf(note.pitch % 12, tonic),
      start: note.startTime,
      duration: note.duration,
      label: noteName(note.pitch % 12, owner?.chord.root),
    };
  });
}

/** One mark per chord, at the root of the bi-tonal colour chord it generates. */
export function colorVoiceMarks(
  section: BlueprintSection,
  keyName: string,
  song?: BlueprintSong,
): VoiceMark[] {
  const tonic = pitchClass(keyName);
  const flavor = section.colorFlavor ?? DEFAULT_COLOR_FLAVOR;
  return occurrences(section, song).map(
    ({ chord, rootPc, startTime, duration }) => {
      // The flavour's shift is what moves the colour chord off its anchor —
      // reading it directly keeps the mark exact without re-deriving a voicing.
      const recipe = resolveFlavor(BI_TONAL_MATRIX, chord.quality, flavor);
      const colorRootPc = (((rootPc + recipe.shift) % 12) + 12) % 12;
      return {
        step: stepOf(colorRootPc, tonic),
        start: startTime,
        duration,
        label: recipe.label,
        name: `${noteName(colorRootPc, chord.root)}${QUALITY_SYMBOL[recipe.quality] ?? recipe.quality}`,
        plain: recipe.shift === 0,
      };
    },
  );
}
