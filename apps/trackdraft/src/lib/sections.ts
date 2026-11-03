import { applyGrooveChoice } from "./drums/grooveModel";
import {
  barLengths,
  meanBeatsPerBar,
  syncArrangementToSections,
  type BlueprintSong,
  type BlueprintSection,
  type Chord,
  type LyricsTimelineEntry,
  type MelodyTrack,
  type MeterChange,
  type SectionOverride,
  type TonicRegion,
} from "../types/blueprint";
import { buildEuclideanOutline, twoThreeCellCounts } from "@drum/library";
import type { SongMap, MapSlot } from "../data/songMaps";
import { honeycombTextToChords } from "./harmony/chordBuilder";
import { inferGrooveOverride } from "./playback/drumPreview";
import { STYLE_RECIPES } from "./style/bend";

function newSection(name: string, role: BlueprintSection["role"]): BlueprintSection {
  return {
    id: crypto.randomUUID(),
    name,
    role,
    bars: 8,
    chords: [],
    beatsPerChord: 4,
    velocity: "mf",
    timeSignatureNumerator: 4,
    timeSignatureDenPower: 2,
  };
}

/** Every function here that changes *which* sections exist or *what order*
 *  they're in ends with `syncArrangementToSections` — it rebuilds
 *  `arrangement` to match `sections` 1:1 (same length, same order),
 *  preserving each section's existing repeat count/overrides and
 *  defaulting anything new to `repeats: 1`. Without this, `arrangement`
 *  would silently drift out of sync with the section list the moment a
 *  user added, removed, or drag-reordered a section — exactly the kind
 *  of divergence this field exists to prevent. `updateSection` is the one
 *  exception: it only ever changes a section's own fields, never the
 *  list's shape or order, so there's nothing to re-sync. */

export function addSection(song: BlueprintSong, role: BlueprintSection["role"] = "verse"): BlueprintSong {
  return syncArrangementToSections({ ...song, sections: [...song.sections, blankSection(song, role)] });
}

/** An empty section, named against what the song already has ("Verse 3"). */
function blankSection(
  song: BlueprintSong,
  role: BlueprintSection["role"],
): BlueprintSection {
  const name = `${role.charAt(0).toUpperCase()}${role.slice(1)} ${song.sections.filter((s) => s.role === role).length + 1}`;
  return newSection(name, role);
}

/**
 * Put an empty section **between** two others, and hand back its id so the
 * caller can select it.
 *
 * `addSection` only appends, and `copySectionTo` only copies — so "I need a
 * chorus in here" had no verb at all: you either built the song backwards from
 * the end or duplicated something and cleaned it up. Inserting a blank section
 * is the third, missing case.
 */
export function insertSection(
  song: BlueprintSong,
  atIndex: number,
  role: BlueprintSection["role"] = "verse",
): { song: BlueprintSong; sectionId: string } | null {
  const sections = [...song.sections];
  const at = Math.max(0, Math.min(sections.length, Math.round(atIndex)));
  const created = blankSection(song, role);
  sections.splice(at, 0, created);
  return {
    song: syncArrangementToSections({ ...song, sections }),
    sectionId: created.id,
  };
}

/**
 * Copy a section, insert the copy directly after it, and hand back both the
 * song and the new id so the caller can select it.
 *
 * A long song is made of repeated material, and until now the only way to add
 * a section was `addSection`, which produces an empty verse — so building
 * "verse 1, verse 2, chorus, verse 2 again" meant retyping the chords. The
 * copy owns its own chord objects: two sections sharing one array would mean
 * editing the copy silently rewrote the original.
 */
export function duplicateSection(
  song: BlueprintSong,
  sectionId: string,
): { song: BlueprintSong; sectionId: string } | null {
  const index = song.sections.findIndex((section) => section.id === sectionId);
  if (index < 0) return null;
  const copy = copyOfSection(song.sections, song.sections[index]);
  const sections = [...song.sections];
  sections.splice(index + 1, 0, copy);
  return {
    song: syncArrangementToSections({ ...song, sections }),
    sectionId: copy.id,
  };
}

/** A deep-enough copy of one section: the arrays a later edit would otherwise
 *  share with the original (a dragged note must not move in two places). */
function copyOfSection(
  sections: readonly BlueprintSection[],
  source: BlueprintSection,
): BlueprintSection {
  return {
    ...source,
    id: crypto.randomUUID(),
    name: nextCopyName(sections, source.name),
    chords: source.chords.map((chord) => ({ ...chord })),
    ...(source.melody
      ? { melody: { ...source.melody, notes: [...source.melody.notes] } }
      : {}),
    ...(source.drumBlocks
      ? { drumBlocks: source.drumBlocks.map((block) => ({ ...block })) }
      : {}),
    ...(source.bassNotes ? { bassNotes: [...source.bassNotes] } : {}),
  };
}

/**
 * Copy a section **into** a position: the "and again, here" the canvas drag
 * offers with ⌥. Unlike duplicate-then-reorder there is no index arithmetic —
 * the copy is spliced at `toIndex` of the list as it stands, so it lands before
 * whatever is currently there, exactly where the drop indicator sits.
 */
export function copySectionTo(
  song: BlueprintSong,
  sectionId: string,
  toIndex: number,
): BlueprintSong {
  const source = song.sections.find((section) => section.id === sectionId);
  if (!source) return song;
  const sections = [...song.sections];
  const at = Math.max(0, Math.min(sections.length, Math.round(toIndex)));
  sections.splice(at, 0, copyOfSection(song.sections, source));
  return syncArrangementToSections({ ...song, sections });
}

/** "Chorus" → "Chorus 2" → "Chorus 3", never a second "Chorus". */
function nextCopyName(
  sections: readonly BlueprintSection[],
  name: string,
): string {
  const base = name.replace(/\s+\d+$/, "");
  const taken = new Set(sections.map((section) => section.name));
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} copy`;
}

export function removeSection(song: BlueprintSong, sectionId: string): BlueprintSong {
  return syncArrangementToSections({ ...song, sections: song.sections.filter((s) => s.id !== sectionId) });
}

/** One section the chord stream was found to contain — see
 *  `lib/harmony/segmentSections.ts`, which produces these from the chords. */
export interface SectionSplit {
  /** A, B, C … the pattern's letter, not a role. */
  label: string;
  chords: Chord[];
  /** How many times this span plays in a row; 1 for a phrase that doesn't. */
  repeats: number;
}

/**
 * Whole bars per part, each one at least as long as its own chords.
 *
 * A part that ends mid-bar takes the next whole bar, and no rounding trick
 * avoids it: making the parts add up to the source's own length would leave
 * exactly those parts with fewer bars than their chords need — and a section
 * is truncated at its declared length on export, so that "fix" quietly eats
 * chords. The total can therefore grow (Layla: 77 → 83 across 18 parts); the
 * form drawer says so before the split is applied.
 */
export function partBars(beatsList: readonly number[], beatsPerBar: number): number[] {
  const perBar = Math.max(1, beatsPerBar);
  return beatsList.map((beats) => Math.max(1, Math.ceil(Math.max(0, beats) / perBar - 0.001)));
}


/** Beats in one pass of a chord list. */
function passBeats(chords: readonly Chord[]): number {
  return chords.reduce((sum, chord) => sum + Math.max(0.25, chord.beats ?? 4), 0);
}

/**
 * How many of `section`'s own bars `beats` covers. With a meter map the bars
 * are not all the same length, so counting them against the mean is what made
 * a four-bar head claim five; without one this is the plain `partBars` rule.
 */
function barsForBeats(section: BlueprintSection, beats: number): number {
  const lengths = barLengths(section);
  if (!section.meterMap || section.meterMap.length === 0 || lengths.length === 0) {
    return partBars([beats], meanBeatsPerBar(section))[0];
  }
  let sum = 0;
  let count = 0;
  for (const length of lengths) {
    sum += length;
    count += 1;
    if (sum >= beats - 0.001) break;
  }
  return Math.max(1, count);
}

/**
 * Section-scoped data that is positioned in *time* — beats or bars from the
 * section start. Copying it onto both halves of a split (or keeping only the
 * first section's copy on a merge) writes the wrong music: a modulation at
 * bar 4 does not happen twice, and a meter map's third bar is not the same
 * bar in both halves. Everything below slices, clamps or shifts it instead.
 */
function sliceRegions(
  regions: readonly TonicRegion[] | undefined,
  fromBeat: number,
  toBeat: number,
): TonicRegion[] | undefined {
  if (!regions || regions.length === 0) return undefined;
  const inside = regions.filter((region) => region.startBeat < toBeat - 0.001);
  if (inside.length === 0) return undefined;
  // The home in force at the cut becomes the slice's opening region: the
  // schema expects the first region of a section to start at 0.
  const active = inside.filter((region) => region.startBeat <= fromBeat + 0.001).pop() ?? inside[0];
  const kept: TonicRegion[] = [{ ...active, startBeat: 0 }];
  for (const region of inside) {
    if (region.startBeat <= fromBeat + 0.001) continue;
    kept.push({ ...region, startBeat: region.startBeat - fromBeat });
  }
  return kept;
}

function shiftRegions(regions: readonly TonicRegion[] | undefined, byBeat: number): TonicRegion[] {
  return (regions ?? []).map((region) => ({ ...region, startBeat: region.startBeat + byBeat }));
}

function sliceMeterMap(
  map: readonly MeterChange[] | undefined,
  fromBar: number,
  toBar: number,
): MeterChange[] | undefined {
  if (!map || map.length === 0) return undefined;
  const kept = map
    .filter((entry) => entry.bar >= fromBar && entry.bar < toBar)
    .map((entry) => ({ ...entry, bar: entry.bar - fromBar }));
  return kept.length > 0 ? kept : undefined;
}

/** The written meter in force at `bar` — a bar that no change names. */
function meterAt(
  section: BlueprintSection,
  bar: number,
): { numerator: number; denPower: number } {
  const change = (section.meterMap ?? []).filter((entry) => entry.bar <= bar).pop();
  if (!change) return { numerator: section.timeSignatureNumerator, denPower: section.timeSignatureDenPower };
  return { numerator: change.numerator, denPower: Math.max(0, Math.round(Math.log2(change.denominator))) };
}

function sliceNotes(
  notes: readonly { startTime: number }[] | undefined,
  fromBeat: number,
  toBeat: number,
): { startTime: number }[] {
  return (notes ?? [])
    .filter((note) => note.startTime >= fromBeat - 0.001 && note.startTime < toBeat - 0.001)
    .map((note) => ({ ...note, startTime: Math.max(0, note.startTime - fromBeat) }));
}

/**
 * A melody fragment loses its generator provenance: `params`/`seed` describe
 * the whole line, and regenerating from them would overwrite the piece the
 * user kept. Without them the track reads as the player's own (absent →
 * "recorded"), which is exactly what a fragment is.
 */
function sliceMelody(
  melody: MelodyTrack | undefined,
  fromBeat: number,
  toBeat: number,
): MelodyTrack | undefined {
  const notes = melody ? sliceNotes(melody.notes, fromBeat, toBeat) : [];
  return notes.length > 0 ? ({ notes } as MelodyTrack) : undefined;
}

function mergeMelody(
  first: MelodyTrack | undefined,
  second: MelodyTrack | undefined,
  firstBeats: number,
): MelodyTrack | undefined {
  const notes = [
    ...(first?.notes ?? []),
    ...(second?.notes ?? []).map((note) => ({ ...note, startTime: note.startTime + firstBeats })),
  ].sort((left, right) => left.startTime - right.startTime);
  return notes.length > 0 ? ({ notes } as MelodyTrack) : undefined;
}

function sliceLyrics(
  timeline: readonly LyricsTimelineEntry[] | undefined,
  fromBeat: number,
  toBeat: number,
): LyricsTimelineEntry[] | undefined {
  if (!timeline || timeline.length === 0) return undefined;
  const kept = timeline
    .filter((entry) => entry.startBeat >= fromBeat - 0.001 && entry.startBeat < toBeat - 0.001)
    .map((entry) => ({
      ...entry,
      startBeat: Math.max(0, entry.startBeat - fromBeat),
      ...(entry.endBeat === undefined ? {} : { endBeat: Math.max(0, entry.endBeat - fromBeat) }),
    }));
  return kept.length > 0 ? kept : undefined;
}

/**
 * Replace one section with the sections its own chord stream is made of.
 *
 * This is how a 77-bar "Unlabeled" import becomes the form it actually is:
 * the harmony floor can only ever show a window, and the spine can only show
 * one block, so the split is what makes the structure visible everywhere
 * else in the app. The parent's role, velocity, meter and groove are carried
 * onto every part (a detected split is about *boundaries*, not about
 * re-labelling the material); lyrics — which have no way to be cut at a
 * chord boundary — stay with the first part so nothing is lost.
 */
export function splitSection(song: BlueprintSong, sectionId: string, splits: readonly SectionSplit[]): BlueprintSong {
  const index = song.sections.findIndex((entry) => entry.id === sectionId);
  if (index === -1 || splits.length === 0) return song;
  const parent = song.sections[index];

  // Bars come from the parent's real bar lengths where it has a meter map.
  const bars = splits.map((split) => barsForBeats(parent, passBeats(split.chords)));

  // Where each part starts in the parent's own beats and bars — the offset
  // everything time-positioned is sliced against.
  const fromBeat = splits.map((_, position) =>
    splits.slice(0, position).reduce((sum, split) => sum + passBeats(split.chords), 0),
  );
  const fromBar = bars.map((_, position) => bars.slice(0, position).reduce((sum, value) => sum + value, 0));

  const created = splits.map((split, position) => {
    const start = fromBeat[position];
    const end = start + passBeats(split.chords);
    const isHead = position === 0;
    const opening = meterAt(parent, fromBar[position]);
    return {
      ...parent,
      id: crypto.randomUUID(),
      name: split.label,
      bars: bars[position],
      chords: split.chords,
      // A tail half opens on whatever meter was in force at the cut, and its
      // remaining meter changes move back with it.
      ...(isHead
        ? {}
        : { timeSignatureNumerator: opening.numerator, timeSignatureDenPower: opening.denPower }),
      tonicRegions: sliceRegions(parent.tonicRegions, start, end),
      meterMap: sliceMeterMap(parent.meterMap, fromBar[position], fromBar[position] + bars[position]),
      melody: sliceMelody(parent.melody, start, end),
      lyricsTimeline: sliceLyrics(parent.lyricsTimeline, start, end),
      // These describe the section as a whole and have no piecewise form:
      // the first part keeps them, the rest carry none.
      ...(isHead
        ? { lyrics: parent.lyrics, transitionNote: parent.transitionNote }
        : {
            lyrics: undefined,
            transitionNote: undefined,
            harmonyMeterOutline: undefined,
            drumMeterOutline: undefined,
            drumVariationOutline: undefined,
          }),
    };
  });

  const sections = [...song.sections];
  sections.splice(index, 1, ...created);
  const synced = syncArrangementToSections({ ...song, sections });

  // Consecutive passes of one pattern are not extra sections: they are the
  // same section played again, which is exactly what `arrangement.repeats`
  // is for. Syncing above reset these to 1, so write them back by id.
  const repeatsById = new Map<string, number>(
    created.map((section, position) => [section.id as string, Math.max(1, splits[position].repeats)]),
  );
  return {
    ...synced,
    arrangement: synced.arrangement.map((entry) => ({
      ...entry,
      repeats: repeatsById.get(entry.sectionId) ?? entry.repeats,
    })),
  };
}

/**
 * Fold detected parts into the one above them, before anything is written.
 *
 * A reading is a proposal: a vamp of four-bar A's reads as one sixteen-bar A
 * to the ear, and the song should never see a split nobody agreed with. Each
 * fold concatenates the chords (expanding any `repeats` the part above had,
 * because those passes are now literal) and re-derives whole bars.
 */
export function foldSectionSplits<T extends { chords: Chord[]; repeats: number; bars: number }>(
  splits: readonly T[],
  folded: readonly number[],
  beatsPerBar: number,
): T[] {
  const into = new Set(folded);
  const out: T[] = [];
  splits.forEach((part, index) => {
    if (index > 0 && into.has(index)) {
      const previous = out[out.length - 1];
      const passes = Math.max(1, previous.repeats);
      const expand = (list: Chord[]) => (passes > 1 ? Array.from({ length: passes }, () => list).flat() : list);
      const chords = [...expand(previous.chords), ...part.chords];
      out[out.length - 1] = {
        ...previous,
        chords,
        repeats: 1,
        bars: partBars([chords.reduce((sum, chord) => sum + Math.max(0.25, chord.beats ?? 4), 0)], beatsPerBar)[0],
      };
    } else {
      out.push({ ...part });
    }
  });
  return out;
}

/**
 * Cut this section in two at a chord — the manual counterpart to
 * `segmentSections`, for the times the reading is off or you simply want a
 * boundary somewhere it didn't put one.
 *
 * The cut is chord-aligned (a chord is never split in half): the chord you
 * point at starts the second section. Bars are recomputed per part, so a cut
 * that lands mid-bar grows the total by less than a bar — the same accounting
 * `splitSection` documents.
 */
export function splitSectionAt(
  song: BlueprintSong,
  sectionId: string,
  chordId: string,
): BlueprintSong {
  const section = song.sections.find((s) => s.id === sectionId);
  if (!section) return song;
  const cut = section.chords.findIndex((chord) => chord.id === chordId);
  // A cut at the first chord would leave an empty section in front of it.
  if (cut <= 0) return song;
  const named = section.name.trim() !== "" && !/^unlabeled$/i.test(section.name.trim());
  return splitSection(song, sectionId, [
    { label: named ? `${section.name} A` : "A", chords: section.chords.slice(0, cut), repeats: 1 },
    { label: named ? `${section.name} B` : "B", chords: section.chords.slice(cut), repeats: 1 },
  ]);
}

/**
 * Cut at a BAR rather than a chord — what a click on the section's bar strip
 * means. The cut lands on the first chord at or after that bar, so a chord is
 * never split in half; bar 1 would leave an empty section, so it is a no-op.
 */
export function splitSectionAtBar(song: BlueprintSong, sectionId: string, bar: number): BlueprintSong {
  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section || bar <= 0) return song;
  // Bars are not all the same length once a section carries a meter map, so
  // the cut is the sum of the bars before it rather than `bar × mean`.
  const lengths = barLengths(section);
  const beatsPerBar = meanBeatsPerBar(section);
  const cutBeat =
    lengths.length > 0
      ? lengths.slice(0, Math.min(bar, lengths.length)).reduce((sum, length) => sum + length, 0)
      : bar * beatsPerBar;
  let cursor = 0;
  const slots = section.chords.map((chord) => {
    const start = cursor;
    cursor += Math.max(0.25, chord.beats ?? 4);
    return start;
  });
  const target = section.chords.find((_, index) => (slots[index] ?? 0) >= cutBeat - 0.001);
  if (!target) return song;
  return splitSectionAt(song, sectionId, target.id);
}

/**
 * Glue a section onto the one after it — the undo of an over-eager split.
 * Any repeats either side had are expanded into the chord list first, because
 * `arrangement.repeats` belongs to a section that still exists; a merged block
 * plays its own chords once, in order.
 */
export function mergeWithNext(song: BlueprintSong, sectionId: string): BlueprintSong {
  const index = song.sections.findIndex((entry) => entry.id === sectionId);
  if (index === -1 || index >= song.sections.length - 1) return song;
  const first = song.sections[index];
  const second = song.sections[index + 1];

  const CHORD_CAP = 3000;
  const repeatOf = (section: BlueprintSection) =>
    Math.max(1, Math.floor(song.arrangement.find((entry) => entry.sectionId === section.id)?.repeats ?? 1));
  const expand = (section: BlueprintSection) => {
    const times = repeatOf(section);
    const chords: Chord[] = [];
    for (let pass = 0; pass < times && chords.length < CHORD_CAP; pass += 1) {
      chords.push(...section.chords.map((chord) => ({ ...chord, id: pass === 0 ? chord.id : crypto.randomUUID() })));
    }
    return chords;
  };

  const firstChords = expand(first);
  const chords = [...firstChords, ...expand(second)];
  const beatsPerBar = meanBeatsPerBar(first);
  const firstBeats = passBeats(firstChords);
  // Bar offset for the second section's meter map (its bars move right by the
  // bars the first one occupies); beat offset for its regions and melody.
  const firstBars = partBars([firstBeats], beatsPerBar)[0];
  // The second section's own titles/timings now sit AFTER the first: its
  // meter changes move by the first's bar count, its regions and melody by
  // the first's beats. `...first` alone would drop all of it.
  const secondMeters = (second.meterMap ?? []).map((entry) => ({ ...entry, bar: entry.bar + firstBars }));
  const merged: BlueprintSection = {
    ...first,
    bars: Math.max(1, partBars([passBeats(chords)], beatsPerBar)[0]),
    chords,
    lyrics: first.lyrics ?? second.lyrics,
    meterMap: (() => {
      const map = [...(first.meterMap ?? []), ...secondMeters];
      return map.length > 0 ? map : undefined;
    })(),
    tonicRegions: (() => {
      const regions = [...(first.tonicRegions ?? []), ...shiftRegions(second.tonicRegions, firstBeats)];
      return regions.length > 0 ? regions : undefined;
    })(),
    melody: mergeMelody(first.melody, second.melody, firstBeats),
    lyricsTimeline: (() => {
      const timeline = [
        ...(first.lyricsTimeline ?? []),
        ...(second.lyricsTimeline ?? []).map((entry) => ({
          ...entry,
          startBeat: entry.startBeat + firstBeats,
          ...(entry.endBeat === undefined ? {} : { endBeat: entry.endBeat + firstBeats }),
        })),
      ];
      return timeline.length > 0 ? timeline : undefined;
    })(),
  };
  const sections = [...song.sections];
  sections.splice(index, 2, merged);
  const synced = syncArrangementToSections({ ...song, sections });
  // The repeats are in the chord list now, so the merged block plays once.
  return {
    ...synced,
    arrangement: synced.arrangement.map((entry) =>
      entry.sectionId === merged.id ? { ...entry, repeats: 1 } : entry,
    ),
  };
}

export function updateSection(
  song: BlueprintSong,
  sectionId: string,
  updater: (section: BlueprintSection) => BlueprintSection,
): BlueprintSong {
  return {
    ...song,
    sections: song.sections.map((s) => (s.id === sectionId ? updater(s) : s)),
  };
}

export function reorderSections(song: BlueprintSong, fromIndex: number, toIndex: number): BlueprintSong {
  const sections = [...song.sections];
  const [moved] = sections.splice(fromIndex, 1);
  sections.splice(toIndex, 0, moved);
  return syncArrangementToSections({ ...song, sections });
}

/** Sets how many times a section plays in a row at its point in the
 *  timeline — 1 is "plays once" (today's only behavior before this
 *  existed), 0 deliberately skips it without deleting it, anything higher
 *  repeats it without duplicating the section itself. Self-normalizing:
 *  runs `syncArrangementToSections` first, so this works even on a song
 *  whose `arrangement` doesn't fully cover its sections yet (real
 *  catalog data can be in this state — an earlier ingestion pass only
 *  partially populated it). */
export function updateRepeats(song: BlueprintSong, sectionId: string, repeats: number): BlueprintSong {
  const synced = syncArrangementToSections(song);
  const clamped = Math.max(0, Math.floor(repeats) || 0);
  return {
    ...synced,
    arrangement: synced.arrangement.map((entry) =>
      entry.sectionId === sectionId ? { ...entry, repeats: clamped } : entry,
    ),
  };
}

/**
 * Give ONE pass of a section its own value for a field (§P4.1).
 *
 * `overrides` on the arrangement entry covers every pass; this covers pass
 * `passIndex` only, on top of it. `undefined` in the patch CLEARS that field
 * for the pass — the pass falls back to the entry, then to the section — so a
 * patch never leaves `{ timeDomain: undefined }` behind and "the same as
 * before" stays byte-identical.
 */
export function setPassOverride(
  song: BlueprintSong,
  sectionId: string,
  passIndex: number,
  patch: SectionOverride,
): BlueprintSong {
  const synced = syncArrangementToSections(song);
  const key = String(Math.max(0, Math.floor(passIndex)));
  return {
    ...synced,
    arrangement: synced.arrangement.map((entry) => {
      if (entry.sectionId !== sectionId) return entry;
      const forPass = { ...(entry.occurrenceOverrides?.[key] ?? {}), ...patch };
      for (const [field, value] of Object.entries(forPass)) {
        if (value === undefined) delete forPass[field as keyof SectionOverride];
      }
      const occurrenceOverrides = { ...entry.occurrenceOverrides };
      if (Object.keys(forPass).length === 0) delete occurrenceOverrides[key];
      else occurrenceOverrides[key] = forPass;
      const next = { ...entry };
      if (Object.keys(occurrenceOverrides).length === 0) delete next.occurrenceOverrides;
      else next.occurrenceOverrides = occurrenceOverrides;
      return next;
    }),
  };
}

/** Drop a pass's own overrides, so it plays like the rest of the section.
 *  Not `setPassOverride(song, id, pass, {})` — an empty patch merges nothing
 *  and would leave the old fields in place. */
export function clearPassOverride(
  song: BlueprintSong,
  sectionId: string,
  passIndex: number,
): BlueprintSong {
  const entry = song.arrangement.find((candidate) => candidate.sectionId === sectionId);
  const key = String(Math.max(0, Math.floor(passIndex)));
  if (!entry?.occurrenceOverrides || !(key in entry.occurrenceOverrides)) return song;
  const occurrenceOverrides = { ...entry.occurrenceOverrides };
  delete occurrenceOverrides[key];
  const next = { ...entry };
  if (Object.keys(occurrenceOverrides).length === 0) delete next.occurrenceOverrides;
  else next.occurrenceOverrides = occurrenceOverrides;
  return {
    ...song,
    arrangement: song.arrangement.map((candidate) =>
      candidate.sectionId === sectionId ? next : candidate,
    ),
  };
}

/** What pass `passIndex` of a section overrides, if anything. */
export function passOverrideFor(
  song: BlueprintSong,
  sectionId: string,
  passIndex: number,
): SectionOverride | null {
  const entry = song.arrangement.find((candidate) => candidate.sectionId === sectionId);
  return entry?.occurrenceOverrides?.[String(Math.max(0, Math.floor(passIndex)))] ?? null;
}

/**
 * Remove ONE pass of a section (§P4.2).
 *
 * Deleting a section that plays three times should not have to mean deleting all
 * three, so `⌫` on a pass takes that pass away: `repeats` drops by one and every
 * later pass's overrides move down an index (the pass you removed is gone, so
 * "pass 3 is half time" becomes "pass 2 is half time"). The last remaining pass
 * is the section, so that case falls through to `removeSection`.
 */
export function removePass(
  song: BlueprintSong,
  sectionId: string,
  passIndex: number,
): BlueprintSong {
  const pass = Math.max(0, Math.floor(passIndex) || 0);
  if (repeatsFor(song, sectionId) <= 1) return removeSection(song, sectionId);
  const entry = song.arrangement.find((candidate) => candidate.sectionId === sectionId);
  const shifted: Record<string, SectionOverride> = {};
  for (const [key, value] of Object.entries(entry?.occurrenceOverrides ?? {})) {
    const index = Number(key);
    if (index === pass) continue;
    shifted[String(index > pass ? index - 1 : index)] = value;
  }
  return {
    ...song,
    arrangement: song.arrangement.map((candidate) => {
      if (candidate.sectionId !== sectionId) return candidate;
      const next = {
        ...candidate,
        repeats: Math.max(1, Math.floor(candidate.repeats) - 1),
      };
      if (Object.keys(shifted).length === 0) delete next.occurrenceOverrides;
      else next.occurrenceOverrides = shifted;
      return next;
    }),
  };
}

/**
 * One more pass, behaving like the one you are on (§P4.4).
 *
 * "Chorus ×3" is easy (`updateRepeats`); "the last two choruses are both half
 * time and loud" meant setting the same two overrides twice. This appends a pass
 * and copies this pass's overrides onto it, so authoring once means authoring
 * once.
 */
export function repeatPassLike(
  song: BlueprintSong,
  sectionId: string,
  passIndex: number,
): BlueprintSong {
  const repeats = repeatsFor(song, sectionId);
  const key = String(Math.max(0, Math.floor(passIndex) || 0));
  const next = updateRepeats(song, sectionId, repeats + 1);
  const entry = next.arrangement.find((candidate) => candidate.sectionId === sectionId);
  const like = entry?.occurrenceOverrides?.[key];
  if (!like) return next;
  // The new pass is the last one; give it the same overrides, not the same object.
  return setPassOverride(next, sectionId, repeats, { ...like });
}

/** Reads a section's current repeat count for display — 1 when the song
 *  hasn't explicitly set one (an un-synced `arrangement`, or a section
 *  with no entry at all), matching `sectionSpans`' own fallback. */
export function repeatsFor(song: BlueprintSong, sectionId: string): number {
  const entry = song.arrangement.find((e) => e.sectionId === sectionId);
  return entry?.repeats ?? 1;
}

export interface ApplySongMapOptions {
  /** Apply one of `map.variants` instead of the map's primary `slots` —
   *  match by `SongMapVariant.name`. Falls back to `slots` if the name
   *  doesn't match anything (e.g. a stale selection after the map's
   *  variants changed underneath it). */
  variantName?: string;
  /** Drop every slot marked `optional: true` before applying — for a
   *  shorter arrangement. Slots with no `optional` field are always kept. */
  excludeOptional?: boolean;
  /** Copy the map's engine `genre` style recipe (STYLE_RECIPES) into the
   *  song's Bend sliders on apply — tempo excluded (the map's own BPM
   *  wins). Only meaningful for maps whose `defaults.genre` is set; the
   *  genre itself is applied either way, and without this flag the song's
   *  existing `bend` stays untouched (neutral stays neutral). */
  seedStyleRecipe?: boolean;
  /** Copy the template's narrative arcs — the song-level master and each
   *  slot's own profile — onto the result. Off by default, for the same
   *  reason as `seedStyleRecipe`: applying a template sets the STRUCTURE,
   *  and the abstract arc is an opinion about the feel. Without the flag
   *  the song's own `narrative` survives and every fresh section starts
   *  with no arc (neutral, i.e. a byte-identical render). */
  seedNarrative?: boolean;
}

/** Replaces the song's sections wholesale with a MAP template's slots.
 *  Destructive by design (confirmed in the UI before calling this) —
 *  applying a template is meant to set the initial shape of a song, not
 *  merge with whatever's already there.
 *
 *  Slot musical fields (bars/velocity/meter/beatsPerChord) override the
 *  blank-section defaults; ids are always minted fresh (they seed
 *  deterministic generation in the Ableton extension, so a template must
 *  never ship them). Song-level defaults apply only where the map sets
 *  them — a map with no `concept` leaves the song's own concept alone,
 *  and maps without an engine `genre` leave the song's genre alone. An
 *  engine genre (one of the eight `STYLE_RECIPES` keys) additionally
 *  writes `song.genre` on apply — engaging the drum engine's Groove DNA
 *  family-lean — and `options.seedStyleRecipe` seeds the Bend sliders
 *  from that recipe (tempo excepted; the map's BPM wins).
 *
 *  Three slot fields get real generation, not just storage:
 *  - `progression` (roman-numeral chord cycle) is resolved into actual
 *    `Chord`s via the same parser the Harmony tab's honeycomb-text import
 *    uses (`honeycombTextToChords`), against the *map's* key/scale (a
 *    genre's harmonic identity, not whatever the song happened to have
 *    before) — a slot with no `progression` keeps today's behavior
 *    (`chords: []`, built manually afterward).
 *  - `groove` (free-text rhythm description) only ever *narrows* the
 *    section's drum pattern when it names something the legacy
 *    `drumPattern` dropdown can actually represent (`inferGrooveOverride`,
 *    a small high-confidence keyword table) — e.g. "half-time" or
 *    "no kit yet". Most groove intent (four-on-the-floor, trap, breakbeat)
 *    isn't representable as an explicit per-section choice at all — the
 *    engine treats those as heuristic-only outcomes — so those slots are
 *    deliberately left on "auto" and rely on the song's `concept` reaching
 *    the live heuristic correctly instead (see `inferPatternForSection`).
 *  - `harmonyRhythm` also gets real generation when `"euclid"`: the 2s/3s
 *    outline is built from the slot's own meter (`harmonyCellCount` /
 *    `harmonyRotation` shape it), and `"follow drums"` sets
 *    `harmonyFollowsDrums` while `syncopationOffset` passes straight
 *    through — a template programs the harmony arrangement exactly like
 *    it already programs the drums. */
/** The slots an apply would use: the chosen variant (or the primary form),
 *  minus optional ones when the caller asked for the short version. Shared by
 *  the destructive apply and the arc-only one so they can't disagree about
 *  which form they are reading. */
export function resolveMapSlots(map: SongMap, options?: ApplySongMapOptions): MapSlot[] {
  const variant = options?.variantName ? map.variants?.find((v) => v.name === options.variantName) : undefined;
  return options?.excludeOptional
    ? (variant?.slots ?? map.slots).filter((slot) => !slot.optional)
    : (variant?.slots ?? map.slots);
}

export function applySongMap(song: BlueprintSong, map: SongMap, options?: ApplySongMapOptions): BlueprintSong {
  const slots = resolveMapSlots(map, options);

  const defaults = map.defaults ?? {};
  const resolvedKey = defaults.key ?? song.key;
  const resolvedScale = defaults.scale ?? song.scale;

  // Engine genre (Groove DNA): a map whose genre IS one of the eight drum
  // families writes `song.genre` on apply, so the family-lean matches the
  // template's identity the same way manually applying a style recipe in
  // Mix/Bend would. `seedStyleRecipe` goes one step further and copies
  // that genre's recipe into the Bend sliders — tempo excluded, since the
  // recipe's BPM is generic while the map's BPM is researched; the map
  // wins. Without the flag the song's existing `bend` stays untouched.
  let bend = song.bend;
  if (options?.seedStyleRecipe && defaults.genre) {
    const recipe = STYLE_RECIPES[defaults.genre];
    if (recipe) {
      const seed: Partial<typeof recipe> = { ...recipe };
      delete seed.tempo;
      bend = seed;
    }
  }

  const sections = slots.map((slot) => {
    const section = newSection(slot.label, slot.role);
    const beatsPerChord = slot.beatsPerChord ?? section.beatsPerChord;
    const numerator = slot.timeSignatureNumerator ?? section.timeSignatureNumerator;
    const denominator = 2 ** (slot.timeSignatureDenPower ?? section.timeSignatureDenPower);
    // "euclid" builds the 2s/3s outline from the slot's own meter (the
    // same shape the Harmony tab's euclid default produces); a 1-beat
    // meter has no valid 2/3 decomposition, so it falls back to no
    // outline rather than throwing. No harmonyRhythm → undefined, which
    // now means "follow the drums" whenever the section has a drum
    // outline (the closest sync) — only an explicit "beats" opts out.
    const harmonyRhythm = slot.harmonyRhythm;
    let harmonyMeterOutline: BlueprintSection["harmonyMeterOutline"];
    if (harmonyRhythm === "euclid") {
      const cellCount = slot.harmonyCellCount ?? twoThreeCellCounts(numerator)[0];
      if (cellCount !== undefined) {
        harmonyMeterOutline = buildEuclideanOutline(numerator, denominator, cellCount, slot.harmonyRotation ?? 0);
      }
    }
    // A genre slot's groove is a whole-section groove choice: when it names
    // one, it replaces what's there (and clears the rhythm blocks authored
    // against the old groove) rather than writing the field directly. No
    // override in the slot → the section's own groove is left untouched.
    const grooveOverride = inferGrooveOverride(slot.groove);
    const withGroove = grooveOverride
      ? applyGrooveChoice(section, grooveOverride === "none" ? { kind: "muted" } : { kind: "preset", pattern: grooveOverride })
      : section;

    return {
      ...withGroove,
      bars: slot.bars ?? withGroove.bars,
      velocity: slot.velocity ?? withGroove.velocity,
      beatsPerChord,
      timeSignatureNumerator: numerator,
      timeSignatureDenPower: slot.timeSignatureDenPower ?? withGroove.timeSignatureDenPower,
      transitionNote: slot.purpose,
      chords: slot.progression?.length
        ? honeycombTextToChords(slot.progression.join(" "), resolvedKey, beatsPerChord, resolvedScale)
        : withGroove.chords,
      harmonyMeterOutline,
      harmonyFollowsDrums: harmonyRhythm === "follow drums" ? true : harmonyRhythm === "beats" ? false : undefined,
      syncopationOffset: slot.syncopationOffset,
      // The abstract narrative arc, only when the apply asked for it. The
      // translation middleware turns it into deltas over the subgenre's
      // concrete vocabulary (packages/drum-library/src/narrative.ts).
      narrative: options?.seedNarrative ? (slot.narrative ?? section.narrative) : section.narrative,
    };
  });
  // Every slot mints a fresh section id (see the comment above), so
  // syncArrangementToSections finds nothing to preserve and simply gives
  // the new song a clean, fully-populated arrangement — one repeats:1
  // entry per section, in the template's order.
  return syncArrangementToSections({
    ...song,
    bpm: defaults.bpm ?? song.bpm,
    key: resolvedKey,
    scale: resolvedScale,
    concept: defaults.concept ?? song.concept,
    genre: defaults.genre ?? song.genre,
    bend,
    narrative: options?.seedNarrative ? (defaults.narrative ?? song.narrative) : song.narrative,
    sections,
  });
}
