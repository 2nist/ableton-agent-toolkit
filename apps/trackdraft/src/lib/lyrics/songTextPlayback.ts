import type { BlueprintSong } from "../../types/blueprint";
import type { NoteName } from "@music-theory/core";
import { NOTE_TO_PC, pitchClass } from "@music-theory/core";
import type { SectionSpan } from "../arrangement";
import { chordSlotAt, chordSlotsForSection } from "../harmony/chordSlots";
import { chordDisplayName } from "../harmony/chordBuilder";
import type { TransportTick } from "../playback/songTransport";
import type { SongTextModel } from "./songTextRows";

/**
 * Where the playhead sits inside the song-text document — what the Song
 * text view needs to follow the track: which block, which PASS of it,
 * which line, and the chord sounding right then (the section's authored
 * progression loops to fill the section, exactly as playback/export will).
 *
 * Derived from every transport tick, but consumers apply it only when
 * something actually changes (`samePlayPos`) — the view re-renders at
 * line/chord boundaries, never at the tick's 60fps.
 */
export interface SongTextPlayPos {
  sectionId: string;
  /** Which pass of the section is playing (0-based) — with `passCount`,
   *  drives the "▶ 2/3" readout when the arrangement repeats a section. */
  occurrenceIndex: number;
  passCount: number;
  /** Index into the block's line rows; -1 before the first line (e.g. the
   *  intro bars before the vocal) or when the block has no lines. */
  lineIdx: number;
  playing: boolean;
  /** The chord sounding at the playhead, if the section has chords. */
  chordId: string | null;
  chordLabel: string | null;
}

export function playbackPosFor(
  song: BlueprintSong,
  spans: SectionSpan[],
  model: SongTextModel,
  tick: TransportTick,
): SongTextPlayPos | null {
  if (tick.sectionIndex < 0 || tick.sectionIndex >= spans.length) return null;
  const span = spans[tick.sectionIndex];
  const block = model.blocks.find((b) => b.section.id === span.sectionId);
  if (!block) return null;

  const beatIn = tick.beat - span.startBeat;

  // Line: the last row whose startBeat has passed. `LyricLine.startBeat`s
  // are GLOBAL song beats (see startBeatsForLines / the popout's
  // rebaseLyricsTimeline note), so compare against the tick directly.
  // Blocks with no timing at all fall back to even distribution across
  // the span — same feel as the popout's fallback.
  let lineIdx = -1;
  let anyTimed = false;
  for (let i = 0; i < block.lines.length; i++) {
    const startBeat = block.lines[i].line.startBeat;
    if (startBeat === undefined) continue;
    anyTimed = true;
    if (startBeat <= tick.beat) lineIdx = i;
    else break;
  }
  if (!anyTimed && block.lines.length > 0 && span.durationBeats > 0) {
    const frac = beatIn / span.durationBeats;
    lineIdx = Math.min(block.lines.length - 1, Math.max(0, Math.floor(frac * block.lines.length)));
  }

  // Chord: loop the authored progression to fill the section.
  let chordId: string | null = null;
  let chordLabel: string | null = null;
  const slots = chordSlotsForSection(block.section.chords, span.durationBeats);
  const slot = chordSlotAt(slots, Math.max(0, beatIn));
  if (slot) {
    chordId = slot.chord.id;
    const rawKey = block.section.key ?? song.key;
    const key: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
    chordLabel = `${slot.chord.romanNumeral} · ${chordDisplayName(pitchClass(slot.chord.root), slot.chord.quality, key)}`;
  }

  const passCount = spans.filter((s) => s.sectionId === span.sectionId).length;
  return {
    sectionId: span.sectionId,
    occurrenceIndex: span.occurrenceIndex,
    passCount,
    lineIdx,
    playing: tick.isPlaying,
    chordId,
    chordLabel,
  };
}

/** Cheap equality so the view can ignore the ticks that change nothing. */
export function samePlayPos(a: SongTextPlayPos | null, b: SongTextPlayPos | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sectionId === b.sectionId &&
    a.occurrenceIndex === b.occurrenceIndex &&
    a.passCount === b.passCount &&
    a.lineIdx === b.lineIdx &&
    a.playing === b.playing &&
    a.chordId === b.chordId &&
    a.chordLabel === b.chordLabel
  );
}
