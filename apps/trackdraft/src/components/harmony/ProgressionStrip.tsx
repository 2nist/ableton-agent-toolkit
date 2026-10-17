/**
 * ProgressionStrip — the progression's rhythm and voicing, in one place.
 *
 * A section's chord list is one pass through the progression and the
 * generator loops it to fill the section, so the strip shows ONE cycle:
 * each chord sized by its `beats`, bar lines for a yardstick, and the repeat
 * count for the section beside it. Drag a boundary and the two neighbours
 * trade beats (cycle length preserved → same repeat rate); use an even
 * preset and every chord gets the same share (cycle length changes → the
 * progression repeats more or less often).
 *
 * Pointer/touch first, like the melody note editor: no modifier keys, no
 * drag-with-Alt — the handles are wide and the snap is a half beat. When a
 * meter outline governs chord timing (the Bend/drums grid), the strip turns
 * read-only rather than pretending a `beats` edit will be heard.
 *
 * The second lane is the **voicing**: each chord shows the tone in its bass
 * (R / 1 / 2 / 3) and whether the upper voices are stacked close or spread
 * open. Both are one click to cycle — no menus — and both are resolved by the
 * shared `voiceChord` in `@music-theory/core`, so the .mid export, live MIDI
 * out, the audition and the Ableton bridge voice the chord identically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { bassName, cycleInversion, inversionCount, toggleSpread } from "../../lib/harmony/voicing";
import {
  cycleBars,
  cycleBeats,
  cycleRepeats,
  dominantBeatsPerChord,
  evenHarmonicRhythm,
  redistributeBeats,
  repeatsEvenly,
  rhythmPresets,
} from "../../lib/harmony/harmonicRhythm";

const HANDLE_PX = 14;
/** Left gutter that labels the two lanes, so they stay aligned. */
const GUTTER_W = 50;

export interface ProgressionStripProps {
  chords: Chord[];
  keyName: NoteName;
  beatsPerBar: number;
  /** Length of the section in beats — only used for the repeat count. */
  sectionBeats: number;
  selectedChordId?: string | null;
  /** Chord timing comes from a meter outline, so `beats` is not what plays. */
  outlineGoverned?: boolean;
  onSelectChord?: (chordId: string) => void;
  onChange: (chords: Chord[], beatsPerChord: number) => void;
  compact?: boolean;
}

export default function ProgressionStrip({
  chords,
  keyName,
  beatsPerBar,
  sectionBeats,
  selectedChordId,
  outlineGoverned = false,
  onSelectChord,
  onChange,
  compact = false,
}: ProgressionStripProps) {
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<Chord[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startX: number } | null>(null);
  const draftRef = useRef<Chord[] | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = draft ?? chords;
  const cycle = cycleBeats(chords);
  const pxPerBeat = width > 0 && cycle > 0 ? width / cycle : 0;

  const cells = useMemo(() => {
    let acc = 0;
    return view.map((chord) => {
      const start = acc;
      acc += chord.beats;
      return { chord, start, end: acc };
    });
  }, [view]);

  const applyDraft = useCallback((next: Chord[] | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  function handleDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (outlineGoverned || event.button !== 0) return;
    event.stopPropagation();
    drag.current = { index, startX: event.clientX };
    try {
      wrapRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety */
    }
  }

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || pxPerBeat <= 0) return;
    applyDraft(redistributeBeats(chords, state.index, (event.clientX - state.startX) / pxPerBeat));
  }

  function handleUp() {
    const state = drag.current;
    drag.current = null;
    const next = draftRef.current;
    applyDraft(null);
    if (!state || !next) return;
    onChange(next, dominantBeatsPerChord(next));
  }

  function handleCancel() {
    drag.current = null;
    applyDraft(null);
  }

  function applyEven(beats: number) {
    const next = evenHarmonicRhythm(chords, beats);
    if (next === chords) return;
    onChange(next, beats);
  }

  if (chords.length === 0) {
    return (
      <p className="text-2xs font-mono italic text-inkMuted/50 px-1 py-1">
        No chords yet — add a progression to shape its rhythm.
      </p>
    );
  }

  const bars = cycleBars(chords, beatsPerBar);
  const repeats = cycleRepeats(chords, sectionBeats);
  const even = repeatsEvenly(chords, sectionBeats);
  const barTicks = barTicksFor(cycle, beatsPerBar);

  return (
    <div className="select-none">
      <div className="flex items-center gap-2 flex-wrap pb-1">
        <span className="text-3xs font-mono uppercase tracking-wide text-inkMuted">Rhythm</span>
        <span className={`text-[9px] font-mono ${even ? "text-inkMuted/70" : "text-accent/80"}`}>
          {formatBars(bars)} cycle · ↻ ×{repeats}
          {even ? "" : " (last pass truncated)"}
        </span>

        {outlineGoverned ? (
          <span
            className="text-[9px] font-mono text-inkMuted/60"
            title="Chord timing follows the meter outline (drums/Bend grid) — change that in the drums layer instead"
          >
            follows the drum grid
          </span>
        ) : (
          <span className="text-[9px] font-mono text-inkMuted/45">drag a boundary to rebalance</span>
        )}

        <span className="flex-1" />
        {!outlineGoverned &&
          rhythmPresets(beatsPerBar).map((preset) => {
            const active = chords.every((chord) => chord.beats === preset.beats);
            return (
              <button
                key={preset.label}
                type="button"
                className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
                  active
                    ? "border-accent/70 bg-accent/15 text-accent"
                    : "border-edge text-inkMuted hover:text-ink"
                }`}
                onClick={() => applyEven(preset.beats)}
                disabled={active}
                title={`One chord per ${preset.label} — every chord gets ${preset.beats} beat${
                  preset.beats === 1 ? "" : "s"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
      </div>

      <div className="flex">
        <div
          style={{ width: GUTTER_W }}
          className="shrink-0 pr-1 text-right text-[8px] font-mono uppercase tracking-wide text-inkMuted/50 self-center"
        >
          rhythm
        </div>
        <div
          ref={wrapRef}
          className={`relative flex-1 rounded border border-edge/70 bg-panelAlt/40 overflow-hidden ${
            compact ? "h-9" : "h-10"
          } ${outlineGoverned ? "" : "touch-none"}`}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleCancel}
        >
        {cells.map(({ chord, start, end }, index) => {
          const cellWidth = (end - start) * pxPerBeat;
          const selected = chord.id === selectedChordId;
          const name = chordDisplayName(pitchClass(chord.root), chord.quality, keyName);
          return (
            <div
              key={`${chord.id}-${index}`}
              className={`absolute inset-y-0 border-r border-edge/40 px-1 flex flex-col justify-center overflow-hidden ${
                selected ? "bg-accent/15 ring-1 ring-inset ring-accent/70" : ""
              }`}
              style={{ left: start * pxPerBeat, width: Math.max(2, cellWidth - 1) }}
            >
              <button
                type="button"
                className="text-left"
                onClick={() => onSelectChord?.(chord.id)}
                title={`${chord.romanNumeral} — ${name}, ${formatBeats(chord.beats)} of the cycle`}
              >
                {cellWidth >= 22 && (
                  <span className="block truncate text-[9px] font-mono uppercase tracking-wide text-inkMuted/80">
                    {chord.romanNumeral}
                  </span>
                )}
                {cellWidth >= 46 && (
                  <span className="block truncate text-[11px] leading-tight text-ink">
                    {name}
                    <span className="ml-1 text-[9px] font-mono text-inkMuted/60">
                      {formatBeats(chord.beats)}
                    </span>
                  </span>
                )}
              </button>
            </div>
          );
        })}

        {/* Bar yardstick — the cycle's length in bars, so "two chords per bar"
            is legible without counting beats. */}
        {barTicks.map((beat) => (
          <div
            key={`bar-${beat}`}
            className="absolute inset-y-0 w-px bg-white/12 pointer-events-none"
            style={{ left: beat * pxPerBeat }}
          />
        ))}

        {/* Boundary handles between neighbours — the cycle's end is the sum,
            not a chord, so there is no handle after the last one. */}
        {!outlineGoverned &&
          cells.slice(0, -1).map(({ end }, index) => (
            <div
              key={`handle-${index}`}
              role="separator"
              aria-label={`Chord boundary ${index + 1}`}
              className="absolute inset-y-0 z-20 -translate-x-1/2 cursor-col-resize group"
              style={{ left: end * pxPerBeat, width: HANDLE_PX }}
              onPointerDown={(event) => handleDown(event, index)}
              title="Drag to trade beats with the next chord (snaps to a half beat)"
            >
                <div className="mx-auto h-full w-1 rounded bg-white/15 group-hover:bg-accent/80" />
              </div>
            ))}
        </div>
      </div>

      {/* Voicing lane — bass tone and spacing, one click each. Aligned with
          the rhythm cells above via the same px-per-beat. */}
      <div className="flex mt-0.5">
        <div
          style={{ width: GUTTER_W }}
          className="shrink-0 pr-1 text-right text-[8px] font-mono uppercase tracking-wide text-inkMuted/50 self-center"
        >
          voicing
        </div>
        <div className="relative flex-1 rounded border border-edge/50 bg-panelAlt/20 overflow-hidden" style={{ height: 22 }}>
          {cells.map(({ chord, start, end }, index) => {
            const cellWidth = (end - start) * pxPerBeat;
            const inversion = chord.voicing?.inversion ?? 0;
            const open = chord.voicing?.spread === "open";
            const size = inversionCount(chord);
            const bassLabel = inversion === 0 ? "R" : String(inversion);
            return (
              <div
                key={`voicing-${chord.id}-${index}`}
                className="absolute inset-y-0 border-r border-edge/30 flex items-center gap-0.5 px-0.5 overflow-hidden"
                style={{ left: start * pxPerBeat, width: Math.max(2, cellWidth - 1) }}
              >
                {cellWidth >= 26 && (
                  <button
                    type="button"
                    className={`rounded px-1 py-[1px] text-[9px] font-mono ${
                      inversion === 0
                        ? "text-inkMuted/70 hover:text-ink"
                        : "bg-accent/20 text-accent"
                    }`}
                    onClick={() => onChange(replaceChord(chords, cycleInversion(chord)), dominantBeatsPerChord(chords))}
                    title={`Bass: ${bassName(inversion)} — click for ${bassName(
                      (inversion + 1) % size,
                    )}${inversion + 1 >= size ? " (root position again)" : ""}`}
                  >
                    {bassLabel}
                  </button>
                )}
                {cellWidth >= 46 && (
                  <button
                    type="button"
                    className={`rounded px-1 py-[1px] text-[9px] font-mono ${
                      open ? "bg-accent/20 text-accent" : "text-inkMuted/70 hover:text-ink"
                    }`}
                    onClick={() => onChange(replaceChord(chords, toggleSpread(chord)), dominantBeatsPerChord(chords))}
                    title={
                      open
                        ? "Open spacing — click for close"
                        : "Close spacing — click to drop the second-highest voice an octave"
                    }
                  >
                    {open ? "open" : "close"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}



/** Bar lines inside one cycle, skipping the very end (the container's edge). */
function barTicksFor(cycle: number, beatsPerBar: number): number[] {
  if (beatsPerBar <= 0 || cycle <= 0) return [];
  const ticks: number[] = [];
  for (let beat = beatsPerBar; beat < cycle - 1e-6; beat += beatsPerBar) {
    ticks.push(Math.round(beat * 1_000) / 1_000);
  }
  return ticks;
}

function formatBars(bars: number): string {
  if (Number.isInteger(bars)) return `${bars} bar${bars === 1 ? "" : "s"}`;
  return `${Math.round(bars * 100) / 100} bars`;
}

function formatBeats(beats: number): string {
  return `${Math.round(beats * 100) / 100}b`;
}

/** Swap one chord back into the progression by id. */
function replaceChord(chords: Chord[], next: Chord): Chord[] {
  return chords.map((chord) => (chord.id === next.id ? next : chord));
}
