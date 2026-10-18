/**
 * ProgressionEditor — the progression as ONE time-aligned stack: the chord
 * cards, their voicing, and their performance effect, sharing one cycle
 * scale. This is the merge of the old `ProgressionTrack` (fixed-width cards +
 * effects lane) and `HarmonicRhythmStrip` (drag-to-rebalance), so a chord is
 * a single object you can see, select, move, resize and voice in one place.
 *
 * Gestures (pointer/touch first — no modifiers, no keyboard required):
 *   tap a card            select it (the inspector/dock follows)
 *   drag a card           reorder the progression (a caret shows the drop)
 *   drag a card boundary  trade beats with the neighbour
 *   drag the cycle end    re-time the loop (resizes the last chord)
 *   tap voicing chips     cycle the bass tone / toggle open spacing
 *   tap an effect chip    cycle none → strum → pulse → arp
 *   drag the velocity…    (not here — this is harmony, not melody)
 *
 * Every gesture is one `onChange`, so the song store's history gives each one
 * a single undo step.
 *
 * The voicing and effect lanes are collapsible and the choice persists
 * (`trackdraft-progression-lanes`): the workbench keeps the row slim, the
 * Harmony canvas opens everything up.
 */

import { uuid } from "../../lib/uuid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordDisplayName, chordFunction, functionColorHex } from "../../lib/harmony/chordBuilder";
import { isChordDiatonic } from "../../lib/harmony/modeInference";
import { bassName, cycleInversion, inversionCount, toggleSpread } from "../../lib/harmony/voicing";
import {
  insertionIndexAt,
  moveChord,
  nextPerformanceEffect,
} from "../../lib/harmony/progressionEdits";
import {
  cycleBars,
  cycleBeats,
  cycleRepeats,
  dominantBeatsPerChord,
  evenHarmonicRhythm,
  redistributeBeats,
  repeatsEvenly,
  resizeCycleEnd,
  rhythmPresets,
} from "../../lib/harmony/harmonicRhythm";

const HANDLE_PX = 14;
/** Left gutter that labels the lanes, so they stay aligned. */
const GUTTER_W = 50;
/** Floor for the horizontal scale: a very long cycle scrolls instead of
 *  squeezing its cards into unreadable slivers. */
const MIN_PX_PER_BEAT = 14;
/** How close to the edge a drag has to get before the strip scrolls itself. */
const EDGE_SCROLL_PX = 28;
/** Pointer travel before a press on a card counts as a reorder drag. */
const REORDER_THRESHOLD = 4;

const LANES_KEY = "trackdraft-progression-lanes";

export interface ProgressionLanes {
  voicing: boolean;
  effects: boolean;
}

function readLanes(compact: boolean): ProgressionLanes {
  try {
    const raw = localStorage.getItem(LANES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProgressionLanes>;
      return { voicing: parsed.voicing ?? !compact, effects: parsed.effects ?? !compact };
    }
  } catch {
    /* a corrupt flag is never worth breaking the editor over */
  }
  return { voicing: !compact, effects: !compact };
}

export interface ProgressionEditorProps {
  chords: Chord[];
  keyName: NoteName;
  scale: ScaleType;
  beatsPerBar: number;
  /** Length of the section in beats — only used for the repeat count. */
  sectionBeats: number;
  selectedChordId?: string | null;
  activeChordId?: string | null;
  /** Chord timing comes from a meter outline, so `beats` is not what plays. */
  outlineGoverned?: boolean;
  onSelectChord?: (chordId: string) => void;
  onChange: (chords: Chord[], beatsPerChord: number) => void;
  compact?: boolean;
}

type DragKind = "boundary" | "end" | "reorder";

interface Drag {
  kind: DragKind;
  index: number;
  startX: number;
  pxPerBeat: number;
  moved: boolean;
}

export default function ProgressionEditor({
  chords,
  keyName,
  scale,
  beatsPerBar,
  sectionBeats,
  selectedChordId,
  activeChordId,
  outlineGoverned = false,
  onSelectChord,
  onChange,
  compact = false,
}: ProgressionEditorProps) {
  const [width, setWidth] = useState(0);
  const [draft, setDraft] = useState<Chord[] | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [lanes, setLanes] = useState<ProgressionLanes>(() => readLanes(compact));

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Horizontal scale, pinned for the length of a gesture: dragging the cycle
   *  end changes the cycle, and letting the scale re-fit mid-drag would make
   *  the handle run away from the pointer. */
  const frozenPx = useRef<number | null>(null);
  const draftRef = useRef<Chord[] | null>(null);
  const caretRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = draft ?? chords;
  const cycle = cycleBeats(view);
  const naturalPx = width > 0 && cycle > 0 ? width / cycle : 0;
  const pxPerBeat = frozenPx.current ?? Math.max(MIN_PX_PER_BEAT, naturalPx);
  const contentWidth = Math.max(width, cycle * pxPerBeat);

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

  const setCaretAt = useCallback((index: number | null) => {
    caretRef.current = index;
    setCaret(index);
  }, []);

  function toggleLane(lane: keyof ProgressionLanes) {
    const next = { ...lanes, [lane]: !lanes[lane] };
    setLanes(next);
    try {
      localStorage.setItem(LANES_KEY, JSON.stringify(next));
    } catch {
      /* persistence is a nicety */
    }
  }

  function pointToBeat(clientX: number): number {
    const el = contentRef.current;
    if (!el || pxPerBeat <= 0) return 0;
    const x = clientX - el.getBoundingClientRect().left;
    return Math.max(0, Math.min(cycle, x / pxPerBeat));
  }

  function beginDrag(kind: DragKind, index: number, event: React.PointerEvent) {
    if (outlineGoverned || event.button !== 0 || pxPerBeat <= 0) return;
    frozenPx.current = pxPerBeat;
    drag.current = { kind, index, startX: event.clientX, pxPerBeat, moved: false };
    try {
      contentRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety */
    }
  }

  /** Keep the pointer in view while a drag pushes the cycle past the edge. */
  function autoScroll(event: React.PointerEvent) {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fromRight = event.clientX - (rect.right - EDGE_SCROLL_PX);
    const fromLeft = rect.left + EDGE_SCROLL_PX - event.clientX;
    if (fromRight > 0) el.scrollLeft += fromRight;
    else if (fromLeft > 0) el.scrollLeft -= fromLeft;
  }

  function handlePointerMove(event: React.PointerEvent) {
    const state = drag.current;
    if (!state || state.pxPerBeat <= 0) return;
    const dx = event.clientX - state.startX;

    if (state.kind === "reorder") {
      if (!state.moved && Math.abs(dx) < REORDER_THRESHOLD) return;
      state.moved = true;
      setDraggingIndex(state.index);
      setCaretAt(insertionIndexAt(cells, pointToBeat(event.clientX)));
      autoScroll(event);
      return;
    }

    const delta = dx / state.pxPerBeat;
    applyDraft(
      state.kind === "end"
        ? resizeCycleEnd(chords, delta)
        : redistributeBeats(chords, state.index, delta),
    );
    if (state.kind === "end") autoScroll(event);
  }

  function handlePointerUp() {
    const state = drag.current;
    drag.current = null;
    frozenPx.current = null;
    const next = draftRef.current;
    const insertion = caretRef.current;
    applyDraft(null);
    setCaretAt(null);
    setDraggingIndex(null);
    if (!state) return;

    if (state.kind === "reorder") {
      if (!state.moved) {
        onSelectChord?.(chords[state.index]?.id ?? "");
        return;
      }
      if (insertion != null) {
        const reordered = moveChord(chords, state.index, insertion);
        if (reordered !== chords) onChange(reordered, dominantBeatsPerChord(reordered));
      }
      return;
    }

    if (!next) return;
    onChange(next, dominantBeatsPerChord(next));
  }

  function handlePointerCancel() {
    drag.current = null;
    frozenPx.current = null;
    applyDraft(null);
    setCaretAt(null);
    setDraggingIndex(null);
  }

  function applyEven(beats: number) {
    const next = evenHarmonicRhythm(chords, beats);
    if (next === chords) return;
    onChange(next, beats);
  }

  function replaceChord(next: Chord) {
    onChange(
      chords.map((chord) => (chord.id === next.id ? next : chord)),
      dominantBeatsPerChord(chords),
    );
  }

  function cycleEffect(chord: Chord) {
    onChange(
      chords.map((item) =>
        item.id === chord.id ? { ...item, performance: nextPerformanceEffect(item.performance) } : item,
      ),
      dominantBeatsPerChord(chords),
    );
  }

  function removeChord(chord: Chord) {
    onChange(chords.filter((item) => item.id !== chord.id), dominantBeatsPerChord(chords));
  }

  /** Append a chord at the end of the cycle — a copy of the last one, so it
   *  lands with the same voicing and effect and is immediately editable in
   *  the chord menu. The strip could re-order, re-time and remove, but there
   *  was no way to ADD a chord from it at all. */
  function appendChord() {
    const last = chords[chords.length - 1];
    if (!last) return;
    const next: Chord = { ...last, id: uuid() };
    onChange([...chords, next], dominantBeatsPerChord(chords));
    onSelectChord?.(next.id);
  }

  if (chords.length === 0) {
    return (
      <p className="text-2xs font-mono italic text-inkMuted/50 px-1 py-1">
        No chords yet — add a progression to shape its rhythm.
      </p>
    );
  }

  const bars = cycleBars(view, beatsPerBar);
  const repeats = cycleRepeats(view, sectionBeats);
  const even = repeatsEvenly(view, sectionBeats);
  const barTicks = barTicksFor(cycle, beatsPerBar);
  const caretBeat = caret == null ? null : cells[caret]?.start ?? cycle;

  return (
    <div className="select-none">
      <div className="flex items-center gap-2 flex-wrap pb-1">
        <span className="text-3xs font-mono uppercase tracking-wide text-inkMuted">Progression</span>
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
          <span className="text-[9px] font-mono text-inkMuted/45">
            drag a card to reorder · a boundary to rebalance · the end to re-time
          </span>
        )}

        <span className="flex-1" />

        {!outlineGoverned && (
          <button
            type="button"
            className="rounded border border-edge px-1.5 py-0.5 text-[10px] font-mono text-inkMuted hover:border-accent/70 hover:text-accent"
            onClick={appendChord}
            title={`Add a chord at the end of the cycle (${formatBeats(chords[chords.length - 1].beats)}, a copy of the last one) and select it`}
          >
            + chord
          </button>
        )}

        {(["voicing", "effects"] as const).map((lane) => (
          <button
            key={lane}
            type="button"
            className={`rounded border px-1.5 py-0.5 text-[10px] font-mono ${
              lanes[lane]
                ? "border-edge text-inkMuted hover:text-ink"
                : "border-edge/50 text-inkMuted/40 hover:text-inkMuted"
            }`}
            onClick={() => toggleLane(lane)}
            aria-pressed={lanes[lane]}
            title={`${lanes[lane] ? "Hide" : "Show"} the ${lane} lane`}
          >
            {lanes[lane] ? "▾" : "▸"} {lane}
          </button>
        ))}

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
        <div style={{ width: GUTTER_W }} className="shrink-0">
          <div
            className={`flex items-center justify-end pr-1 text-[8px] font-mono uppercase tracking-wide text-inkMuted/50 ${
              compact ? "h-9" : "h-10"
            }`}
          >
            chords
          </div>
          {lanes.voicing && (
            <div
              className="mt-0.5 flex items-center justify-end pr-1 text-[8px] font-mono uppercase tracking-wide text-inkMuted/50"
              style={{ height: 22 }}
            >
              voicing
            </div>
          )}
          {lanes.effects && (
            <div
              className="mt-0.5 flex items-center justify-end pr-1 text-[8px] font-mono uppercase tracking-wide text-inkMuted/50"
              style={{ height: 24 }}
            >
              effects
            </div>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div
            ref={contentRef}
            style={{ width: contentWidth }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            {/* Chord cards — time-proportional, tap to select, drag to reorder,
                boundary handles to trade beats. */}
            <div
              className={`relative rounded border border-edge/70 bg-panelAlt/40 overflow-hidden ${
                compact ? "h-9" : "h-10"
              } ${outlineGoverned ? "" : "touch-none"}`}
            >
              {cells.map(({ chord, start, end }, index) => {
                const cellWidth = (end - start) * pxPerBeat;
                const selected = chord.id === selectedChordId;
                const active = chord.id === activeChordId;
                const name = chordDisplayName(pitchClass(chord.root), chord.quality, keyName);
                const func = chord.isSubstitution ? null : chordFunction(chord, scale);
                const stripe = chord.isSubstitution ? "#ffa500" : functionColorHex(func) ?? "#2e2e34";
                const borrowed = !chord.isSubstitution && !isChordDiatonic(chord, keyName, scale);
                return (
                  <div
                    key={chord.id}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Chord ${chord.romanNumeral} ${name}, ${formatBeats(chord.beats)}`}
                    className={`absolute inset-y-0 border-r border-edge/40 overflow-hidden ${
                      selected
                        ? "bg-accent/15 ring-1 ring-inset ring-accent/70"
                        : active
                          ? "bg-accent/10"
                          : "hover:bg-white/[0.03]"
                    } ${draggingIndex === index ? "opacity-40" : ""}`}
                    style={{ left: start * pxPerBeat, width: Math.max(2, cellWidth - 1) }}
                    title={`${chord.romanNumeral} — ${name}, ${formatBeats(chord.beats)} of the cycle\nTap to select · drag to reorder`}
                    onPointerDown={(event) => beginDrag("reorder", index, event)}
                  >
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: stripe }} />
                    <div className="absolute inset-y-0 left-[5px] right-1 flex flex-col justify-center overflow-hidden">
                      {cellWidth >= 22 && (
                        <span
                          className="truncate text-[9px] font-mono uppercase tracking-wide text-inkMuted/80"
                          style={chord.isSubstitution ? { color: "#ffa500" } : undefined}
                        >
                          {chord.romanNumeral}
                        </span>
                      )}
                      {cellWidth >= 46 && (
                        <span className="truncate text-[11px] leading-tight text-ink">
                          {name}
                          <span className="ml-1 text-[9px] font-mono text-inkMuted/60">
                            {formatBeats(chord.beats)}
                          </span>
                          {borrowed && (
                            <span
                              className="ml-1 inline-block h-[5px] w-[5px] rounded-full bg-accent/80 align-middle"
                              title={`${name} is borrowed — outside ${keyName} ${scale}`}
                            />
                          )}
                        </span>
                      )}
                    </div>
                    {selected && (
                      <button
                        type="button"
                        className="absolute right-0.5 top-0.5 z-30 rounded bg-[#0E1116]/70 px-1 text-[10px] leading-none text-inkMuted hover:text-red-400"
                        aria-label="Remove chord"
                        title="Remove this chord"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeChord(chord);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Bar yardstick. */}
              {barTicks.map((beat) => (
                <div
                  key={`bar-${beat}`}
                  className="absolute inset-y-0 w-px bg-white/12 pointer-events-none"
                  style={{ left: beat * pxPerBeat }}
                />
              ))}

              {/* Reorder caret. */}
              {caretBeat != null && (
                <div
                  className="absolute inset-y-0 z-30 w-0.5 bg-accent pointer-events-none"
                  style={{ left: caretBeat * pxPerBeat }}
                />
              )}

              {/* Boundary handles between neighbours. */}
              {!outlineGoverned &&
                cells.slice(0, -1).map(({ end }, index) => (
                  <div
                    key={`handle-${index}`}
                    role="separator"
                    aria-label={`Chord boundary ${index + 1}`}
                    className="absolute inset-y-0 z-20 -translate-x-1/2 cursor-col-resize group"
                    style={{ left: end * pxPerBeat, width: HANDLE_PX }}
                    onPointerDown={(event) => beginDrag("boundary", index, event)}
                    title="Drag to trade beats with the next chord (snaps to a half beat)"
                  >
                    <div className="mx-auto h-full w-1 rounded bg-white/15 group-hover:bg-accent/80" />
                  </div>
                ))}

              {/* Cycle-end handle — resizes the LAST chord, which re-times the
                  loop rather than trading with a neighbour. */}
              {!outlineGoverned && (
                <div
                  role="separator"
                  aria-label="Cycle end"
                  className="absolute inset-y-0 z-20 cursor-col-resize group"
                  style={{ left: Math.max(0, contentWidth - HANDLE_PX), width: HANDLE_PX }}
                  onPointerDown={(event) => beginDrag("end", cells.length - 1, event)}
                  title="Drag to lengthen or shorten the last chord — this changes the cycle length, so the progression repeats more or less often"
                >
                  <div className="mx-auto h-full w-1 rounded bg-white/25 group-hover:bg-accent" />
                </div>
              )}
            </div>

            {/* Voicing lane — bass tone and spacing, one click each. */}
            {lanes.voicing && (
              <div
                className="relative mt-0.5 rounded border border-edge/50 bg-panelAlt/20 overflow-hidden"
                style={{ height: 22 }}
              >
                {cells.map(({ chord, start, end }) => {
                  const cellWidth = (end - start) * pxPerBeat;
                  const inversion = chord.voicing?.inversion ?? 0;
                  const open = chord.voicing?.spread === "open";
                  const size = inversionCount(chord);
                  return (
                    <div
                      key={`voicing-${chord.id}`}
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
                          onClick={() => replaceChord(cycleInversion(chord))}
                          title={`Bass: ${bassName(inversion)} — click for ${bassName(
                            (inversion + 1) % size,
                          )}${inversion + 1 >= size ? " (root position again)" : ""}`}
                        >
                          {inversion === 0 ? "R" : String(inversion)}
                        </button>
                      )}
                      {cellWidth >= 46 && (
                        <button
                          type="button"
                          className={`rounded px-1 py-[1px] text-[9px] font-mono ${
                            open ? "bg-accent/20 text-accent" : "text-inkMuted/70 hover:text-ink"
                          }`}
                          onClick={() => replaceChord(toggleSpread(chord))}
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
            )}

            {/* Effects lane — click to cycle none → strum → pulse → arp. */}
            {lanes.effects && (
              <div
                className="relative mt-0.5 rounded border border-edge/50 bg-[#131316] overflow-hidden"
                style={{ height: 24 }}
              >
                {cells.map(({ chord, start, end }) => {
                  const cellWidth = (end - start) * pxPerBeat;
                  const style = chord.performance?.style;
                  return (
                    <div
                      key={`effect-${chord.id}`}
                      className="absolute inset-y-0 border-r border-edge/30 flex items-center justify-center overflow-hidden"
                      style={{ left: start * pxPerBeat, width: Math.max(2, cellWidth - 1) }}
                    >
                      <button
                        type="button"
                        className={`h-[18px] max-w-full rounded px-1 text-[9px] font-mono uppercase tracking-wide ${
                          style ? "text-accent" : "text-inkMuted/50 hover:text-inkMuted"
                        }`}
                        onClick={() => cycleEffect(chord)}
                        title={
                          style
                            ? `${style} — click to cycle none → strum → pulse → arp`
                            : "Add a performance effect — click to cycle"
                        }
                      >
                        {cellWidth >= 38 ? (style ?? "+ fx") : style ? "•" : ""}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
