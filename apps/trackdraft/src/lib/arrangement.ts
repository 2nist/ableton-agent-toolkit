import { resolveArrangement, sectionDurationBeats } from "../types/blueprint";
import type { BlueprintSong, BlueprintSection } from "../types/blueprint";

export interface SectionSpan {
  sectionId: string;
  section: BlueprintSection;
  /** Which repeat pass this span is (0-based) — always 0 for a section
   *  that plays once. Mirrors extensions/trackdraft-bridge/src/blueprint.ts's
   *  `occurrenceIndex`, so a repeated section (e.g. three Chorus passes)
   *  renders as three distinct timeline blocks, not one. */
  occurrenceIndex: number;
  variation?: string;
  startBeat: number;
  durationBeats: number;
  startBar: number;
  bars: number;
}

/**
 * The app-side equivalent of the bridge's `sectionSpans`
 * (extensions/trackdraft-bridge/src/blueprint.ts) — same algorithm, built
 * from the same shared `resolveArrangement`/`sectionDurationBeats`/
 * `beatsPerBar` math (`@music-theory/song-blueprint`) so the Studio tab's
 * timeline can't drift from what the Ableton extension actually renders.
 * Deliberately not importing the bridge's own copy: that file lives in a
 * separate extension package the web app has no dependency on, and the
 * underlying math is already shared, not duplicated.
 */
export function sectionSpans(song: BlueprintSong): SectionSpan[] {
  const sectionsById = new Map(song.sections.map((section) => [section.id, section]));
  const spans: SectionSpan[] = [];
  let startBeat = 0;
  // Bars are accumulated, not derived from beats: a section with a meter map
  // (or a song whose sections use different meters) has no single
  // beats-per-bar to divide by.
  let startBar = 0;

  for (const entry of resolveArrangement(song)) {
    const base = sectionsById.get(entry.sectionId);
    if (!base) continue; // stale reference (section since deleted) — skip rather than crash
    const section: BlueprintSection = entry.overrides ? { ...base, ...entry.overrides } : base;
    const durationBeats = sectionDurationBeats(section);

    const repeats = Math.max(0, Math.floor(entry.repeats));
    for (let occurrenceIndex = 0; occurrenceIndex < repeats; occurrenceIndex++) {
      spans.push({
        sectionId: entry.sectionId,
        section,
        occurrenceIndex,
        variation: entry.variation,
        startBeat,
        durationBeats,
        startBar,
        bars: section.bars,
      });
      startBeat += durationBeats;
      startBar += section.bars;
    }
  }
  return spans;
}

/** Total song length in bars across every expanded pass — the timeline's
 *  ruler needs this, and it's cheap to derive from the last span rather
 *  than re-summing bars separately. */
export function totalBars(spans: SectionSpan[]): number {
  const last = spans[spans.length - 1];
  if (!last) return 0;
  return last.startBar + last.bars;
}

/** The identifying half of a transport tick — where it is, without trusting
 *  an array position. */
export interface TickPosition {
  beat: number;
  /** Identity of the span the tick fired in. Every tick `SongTransport`
   *  emits carries it; only hand-built ticks (pure helpers, tests) omit it,
   *  and those fall back to `sectionIndex`. */
  sectionId?: string | null;
  /** Which repeat pass, so a section that plays three times is never
   *  guessed at. -1 when the tick sits outside every span. */
  occurrenceIndex?: number;
  /** Positional index into the transport's OWN span snapshot. */
  sectionIndex?: number;
}

function containsBeat(span: SectionSpan, beat: number): boolean {
  return beat >= span.startBeat && beat < span.startBeat + span.durationBeats;
}

/**
 * Index of the span `tick` belongs to in `spans` (which callers derive from
 * the LIVE song), or -1.
 *
 * `sectionIndex` is an index into the span map the transport snapshotted when
 * playback started. Resizing a section's bars, reordering, splitting or
 * deleting one mid-playback therefore makes that index alias a DIFFERENT
 * section — the playhead jumps to another block and the harmony highlight
 * lands on another section's chord, silently. Resolving by identity can only
 * fail (return -1), never point somewhere wrong, so identity wins whenever
 * the tick carries it.
 */
export function spanIndexForTick(spans: SectionSpan[], tick: TickPosition): number {
  if (!tick.sectionId) {
    const index = tick.sectionIndex ?? -1;
    return index >= 0 && index < spans.length ? index : -1;
  }

  const wantedPass = tick.occurrenceIndex ?? 0;
  let containing = -1;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (span.sectionId !== tick.sectionId) continue;
    if (span.occurrenceIndex === wantedPass) return index;
    if (containing < 0 && containsBeat(span, tick.beat)) containing = index;
  }
  if (containing >= 0) return containing;
  // The pass itself is gone (its repeat count was lowered) but the section
  // still exists — report its first pass rather than dropping the playhead.
  return spans.findIndex((span) => span.sectionId === tick.sectionId);
}

/** The span `tick` belongs to, or null when the song no longer contains it. */
export function spanForTick(spans: SectionSpan[], tick: TickPosition): SectionSpan | null {
  const index = spanIndexForTick(spans, tick);
  return index >= 0 ? spans[index] : null;
}
