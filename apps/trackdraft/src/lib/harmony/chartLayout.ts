import {
  barLengths,
  beatsPerBar,
  sectionDurationBeats,
  type BlueprintSong,
  type BlueprintSection,
  type Chord,
} from "../../types/blueprint";
import { resolveArrangement } from "../../types/blueprint";
import { noteName, pitchClass } from "@music-theory/core";
import { analyzeSection, type HarmonyEvent } from "./analysis";
import { chordSlotsForSection } from "./chordSlots";

/** One chord written into a bar. `beat` is 1-based inside the bar so the
 *  renderer can place it in the right part of the cell. */
export interface ChartChord {
  label: string;
  absolute: string;
  beat: number;
  beats: number;
  chordId: string | null;
  /** The chord's own root/quality, for anything that has to re-notate it
   *  (the iReal export writes its own symbol dialect). */
  root: string;
  quality: string;
  /** Sounding from before this bar: the chart writes it again (muted) so the
   *  player reads the whole bar, not just the beat it changes on. */
  carried?: boolean;
}

export interface ChartBar {
  /** Bar number from the top of the chart (1-based) — what a player counts. */
  number: number;
  /** 0-based bar inside its section, for the repeat/ending maths. */
  barInSection: number;
  chords: ChartChord[];
  /** Nothing new starts in this bar: the previous chord is still sounding. */
  sustained: boolean;
  /** Same chord content as the bar before it — the chart draws `%`. */
  repeatsPrevious: boolean;
  /** Meter change written at this bar ("7/8"), null when unchanged. */
  meter: string | null;
  /** The bar's real length in beats — a meter map means they differ. */
  beats: number;
}

/** One line of the chart. Charts are read in fours, so a line is four bars
 *  unless the section ends first. */
export interface ChartSystem {
  bars: ChartBar[];
}

export interface ChartSection {
  /** Index into `resolveArrangement(song)` — the arrangement slot, not the
   *  section list, because one slot can play several times. */
  entryIndex: number;
  sectionId: string;
  /** Margin letter: A, B, C… by first appearance of this section's material. */
  letter: string;
  /** The section's own name, for the line above the system. */
  name: string;
  bars: number;
  repeats: number;
  systems: ChartSystem[];
  /** One pass in beats — the width a repeat bracket multiplies. */
  durationBeats: number;
  /** True when this slot reuses material that already had a letter. */
  returns: boolean;
}

export interface ChartOptions {
  keyName: BlueprintSong["key"];
  scale: BlueprintSong["scale"];
  /** Semitones the chords are shifted for display (transpose − capo). The
   *  chords are transposed BEFORE analysis, so the names come out of the
   *  same net-accidental logic everything else uses — re-spelling them here
   *  is how ♭VI turned into A# in the first chart. */
  transpose?: number;
  /** Bars per line. Four is the chart convention; eight for long tunes. */
  barsPerSystem?: number;
  /** Label the numerals the way the desk's display settings ask. */
  label: (event: HarmonyEvent | null) => string;
  /** The absolute symbol. Defaults to the analysed name; the desk overrides
   *  this so a transposed/capo reading is what the chart prints. */
  absolute?: (chord: Chord, event: HarmonyEvent | null) => string;
}

/** The meter a bar is in, always — the caller decides whether to print it. */
function meterOf(section: BlueprintSection, bar: number): string {
  const change = (section.meterMap ?? []).find((entry) => entry.bar === bar);
  if (change) return `${change.numerator}/${change.denominator}`;
  return `${section.timeSignatureNumerator}/${2 ** section.timeSignatureDenPower}`;
}

/**
 * The whole tune as a player reads it: sections in arrangement order, each
 * one laid out in lines of four bars, with the chord that is sounding in each
 * bar. Repeats stay as repeat counts rather than copies — a chart says "×3",
 * it does not print the chorus three times.
 *
 * Pure on purpose: this is the thing worth testing, and the component that
 * draws it should only be deciding about type sizes.
 */
export function layoutChart(song: BlueprintSong, options: ChartOptions): ChartSection[] {
  const barsPerSystem = Math.max(1, options.barsPerSystem ?? 4);
  const sectionsById = new Map(song.sections.map((section) => [section.id, section]));
  const letters = new Map<string, string>();
  const sections: ChartSection[] = [];
  let barNumber = 1;
  // Printed only where the meter actually changes — a chart that writes 4/4
  // above every section is noise on a stand.
  let soundingMeter: string | null = null;

  const entries = resolveArrangement(song);
  entries.forEach((entry, entryIndex) => {
    const base = sectionsById.get(entry.sectionId);
    if (!base) return;
    const section: BlueprintSection = entry.overrides ? { ...base, ...entry.overrides } : base;
    const length = sectionDurationBeats(section);
    if (length <= 0) return;

    const meterBeats = beatsPerBar(section);
    const shift = options.transpose ?? 0;
    const shownChords: Chord[] =
      shift === 0
        ? section.chords
        : section.chords.map((chord) => ({
            ...chord,
            root: noteName((pitchClass(chord.root) + shift + 12) % 12, chord.root),
          }));
    const analysis = analyzeSection(shownChords, {
      key: section.key ?? options.keyName,
      scale: section.scale ?? options.scale,
      regions: section.tonicRegions,
      beatsPerBar: meterBeats,
    });
    const eventByChord = new Map<string, HarmonyEvent>();
    for (const event of analysis.events) eventByChord.set(event.chordId, event);
    const slots = chordSlotsForSection(shownChords, length);

    // Real bar boundaries, so a meter map produces honest cells.
    const lengths = barLengths(section);
    const barEdges: number[] = [0];
    for (const value of lengths) barEdges.push(barEdges[barEdges.length - 1] + value);
    if (barEdges[barEdges.length - 1] < length - 0.001) barEdges.push(length);
    const barCount = Math.max(1, barEdges.length - 1);

    const contentKey = (chords: ChartChord[]) =>
      chords.map((chord) => `${chord.absolute}@${chord.beat}`).join("|");

    const bars: ChartBar[] = [];
    for (let bar = 0; bar < barCount; bar++) {
      const start = barEdges[bar];
      const end = barEdges[bar + 1];
      const starting = slots.filter((slot) => slot.startBeat >= start - 0.001 && slot.startBeat < end - 0.001);
      const cellOf = (slot: (typeof slots)[number], beat: number, carried = false): ChartChord => {
        const event = eventByChord.get(slot.chord.id) ?? null;
        return {
          label: options.label(event),
          absolute: options.absolute
            ? options.absolute(slot.chord, event)
            : (event?.absoluteName ?? slot.chord.root),
          beat,
          beats: slot.durationBeats,
          chordId: slot.chord.id,
          root: slot.chord.root,
          quality: slot.chord.quality,
          ...(carried ? { carried: true } : {}),
        };
      };
      // A change that lands mid-bar leaves the top of the bar unexplained, and
      // a bar with no change at all is worse. Either way the chart restates the
      // chord that is still sounding, so every bar reads on its own.
      const sustained = starting.length === 0;
      let chords: ChartChord[] = starting.map((slot) => cellOf(slot, Math.floor(slot.startBeat - start) + 1));
      const carrying = slots.find(
        (slot) => slot.startBeat < start - 0.001 && slot.startBeat + slot.durationBeats > start + 0.001,
      );
      if (carrying && (chords[0]?.beat ?? 99) !== 1) {
        chords = [cellOf(carrying, 1, true), ...chords];
      }
      const previousKey = bars.length > 0 ? contentKey(bars[bars.length - 1].chords) : null;
      const meter = meterOf(section, bar);
      const meterChanged = meter !== soundingMeter;
      soundingMeter = meter;
      bars.push({
        number: barNumber + bar,
        barInSection: bar,
        chords,
        sustained,
        repeatsPrevious: previousKey !== null && previousKey === contentKey(chords) && chords.length > 0,
        meter: meterChanged ? meter : null,
        beats: end - start,
      });
    }
    barNumber += barCount;

    const systems: ChartSystem[] = [];
    for (let index = 0; index < bars.length; index += barsPerSystem) {
      systems.push({ bars: bars.slice(index, index + barsPerSystem) });
    }

    const material = section.chords.map((chord) => `${chord.root}:${chord.quality}`).join(",");
    const returns = letters.has(material);
    if (!returns) letters.set(material, String.fromCharCode(65 + letters.size));

    sections.push({
      entryIndex,
      sectionId: entry.sectionId,
      letter: letters.get(material) ?? "A",
      name: section.name,
      bars: barCount,
      durationBeats: length,
      repeats: Math.max(1, Math.floor(entry.repeats)),
      systems,
      returns,
    });
  });

  return sections;
}

/** Where the transport is in the chart, if it is inside it at all. */
export interface ChartPosition {
  entryIndex: number;
  /** The bar's chart number — what the cursor highlights. */
  barNumber: number;
  /** Which pass of a repeated section, 0-based. */
  pass: number;
}

/** Beat is song-relative; returns null past the last bar. */
export function positionInChart(sections: readonly ChartSection[], beat: number): ChartPosition | null {
  let cursor = 0;
  for (const section of sections) {
    const total = section.durationBeats * section.repeats;
    if (beat < cursor + total) {
      const within = beat - cursor;
      const pass = Math.min(section.repeats - 1, Math.max(0, Math.floor(within / section.durationBeats)));
      const inPass = within - pass * section.durationBeats;
      let acc = 0;
      for (const system of section.systems) {
        for (const bar of system.bars) {
          if (inPass < acc + bar.beats) return { entryIndex: section.entryIndex, barNumber: bar.number, pass };
          acc += bar.beats;
        }
      }
      const lastSystem = section.systems[section.systems.length - 1];
      const last = lastSystem?.bars[lastSystem.bars.length - 1];
      if (last) return { entryIndex: section.entryIndex, barNumber: last.number, pass };
      return null;
    }
    cursor += total;
  }
  return null;
}
