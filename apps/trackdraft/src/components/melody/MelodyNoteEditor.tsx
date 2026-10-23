/**
 * MelodyNoteEditor — the Melody layer's note editing surface, built for
 * pointer and touch first (no keyboard shortcut is required for any of it).
 *
 *   tap empty grid          add a note at the snapped beat + pitch
 *   drag a note             move it in time and pitch
 *   drag a note's edge      change its length
 *   drag the velocity lane  set that note's velocity
 *   ✕ Delete                remove the selected note
 *
 * Everything snaps to the editor grid (`QuantizeGrid`, the same vocabulary as
 * the capture quantizer) and is clamped inside the section window by the pure
 * helpers in `lib/melody/noteEdits`. The parent gets one `onChange` per
 * gesture — not per pointermove — so a drag never writes to the song store on
 * every frame, and the song store's own history gives each gesture one undo
 * step.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCALE_INTERVALS, pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { MelodyNote } from "../../types/blueprint";
import { midiToNoteName } from "../../lib/melody/recorder";
import {
  MAX_VELOCITY,
  MIN_VELOCITY,
  addNote,
  moveNote,
  nearestNoteIndex,
  removeNote,
  resizeNote,
  setVelocity,
} from "../../lib/melody/noteEdits";
import type { QuantizeGrid } from "../../lib/melody/quantize";
import {
  anchorDegree,
  canShiftOctave,
  noteRange,
  scaleDegreeLabels,
  shiftOctave,
  transposeToDegree,
} from "../../lib/melody/transpose";

const GUTTER_W = 46;
const RULER_H = 16;
const LANE_H = 36;
/** Pointer tolerance for the resize handles at a note's edges. */
const EDGE_PX = 8;
/** Pixels of movement before a press counts as a drag (touch-friendly). */
const DRAG_THRESHOLD = 3;

const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

const SNAP_OPTIONS: { value: QuantizeGrid; label: string }[] = [
  { value: "1/16", label: "16th" },
  { value: "1/8", label: "8th" },
  { value: "1/4", label: "Quarter" },
  { value: "1/8T", label: "8th-T" },
  { value: "none", label: "Free" },
];

type DragKind = "move" | "resize-start" | "resize-end" | "velocity";

interface Drag {
  kind: DragKind;
  index: number;
  startX: number;
  startY: number;
  orig: MelodyNote;
  moved: boolean;
  /** State to restore if the gesture is cancelled (Escape / pointercancel). */
  base: MelodyNote[];
}

export interface MelodyNoteEditorProps {
  notes: MelodyNote[];
  /** Length of the section in beats — the editor's right edge. */
  sectionBeats: number;
  /** Beats per bar, for bar lines and the ruler. */
  beatsPerBar: number;
  /** Section key + scale shade the rows the line "belongs" to. */
  keyName?: NoteName;
  scale?: ScaleType;
  /** Max height of the scrolling grid, in px. */
  maxHeight?: number;
  onChange: (notes: MelodyNote[]) => void;
  /** Optional bridge to the header's undo, so the button sits by the notes. */
  onUndo?: () => void;
  canUndo?: boolean;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function noteColor(pitch: number): string {
  return `hsl(${(pitch * 17) % 360}, 62%, 56%)`;
}

function sameNotes(a: MelodyNote[], b: MelodyNote[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const key = (note: MelodyNote) =>
    `${note.pitch}:${note.startTime}:${note.duration}:${note.velocity ?? 96}`;
  // Order-insensitive: the hosts re-sort by onset, so a note dragged past its
  // neighbour is still the same line and must not reset the selection.
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}

export default function MelodyNoteEditor({
  notes,
  sectionBeats,
  beatsPerBar,
  keyName,
  scale,
  maxHeight = 320,
  onChange,
  onUndo,
  canUndo = false,
}: MelodyNoteEditorProps) {
  const [grid, setGrid] = useState<QuantizeGrid>("1/8");
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const [local, setLocal] = useState<MelodyNote[]>(notes);

  const contentRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Mirror of `local`, updated synchronously — gesture code reads it so a
   *  quick second pointermove never sees a stale array. */
  const localRef = useRef(local);

  const applyLocal = useCallback((next: MelodyNote[]) => {
    localRef.current = next;
    setLocal(next);
  }, []);

  // Adopt the parent's notes when they change from the outside (a reroll, a
  // section switch, an undo) — but never mid-gesture, and never for the echo
  // of our own commit (which would drop the selection after every edit).
  useEffect(() => {
    if (drag.current || sameNotes(localRef.current, notes)) return;
    applyLocal(notes);
  }, [notes, applyLocal]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const perBar = beatsPerBar > 0 ? beatsPerBar : 4;
  const pxPerBeat = width > 0 && sectionBeats > 0 ? width / sectionBeats : 0;
  const barPx = pxPerBeat * perBar;

  const range = useMemo(() => {
    const pitches = local.map((note) => note.pitch);
    const low = pitches.length ? Math.min(...pitches) : 60;
    const high = pitches.length ? Math.max(...pitches) : 72;
    let min = Math.max(0, Math.floor(low) - 2);
    let max = Math.min(127, Math.ceil(high) + 2);
    if (max - min < 12) max = Math.min(127, min + 12);
    if (max - min < 12) min = Math.max(0, max - 12);
    return { min, max, span: max - min + 1 };
  }, [local]);

  const rowH = Math.max(8, Math.min(16, Math.floor(360 / range.span)));
  const contentHeight = range.span * rowH;

  const rows = useMemo(() => {
    const scalePcs = keyName && scale
      ? new Set(
          (SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).map(
            (interval) => (pitchClass(keyName) + interval) % 12,
          ),
        )
      : null;
    const out: { pitch: number; pc: number; black: boolean; inScale: boolean }[] = [];
    for (let pitch = range.max; pitch >= range.min; pitch--) {
      const pc = ((pitch % 12) + 12) % 12;
      out.push({
        pitch,
        pc,
        black: !NATURAL_PCS.has(pc),
        inScale: scalePcs ? scalePcs.has(pc) : true,
      });
    }
    return out;
  }, [range.max, range.min, keyName, scale]);

  function pointFor(event: { clientX: number; clientY: number }): { beat: number; pitch: number } | null {
    const el = contentRef.current;
    if (!el || pxPerBeat <= 0) return null;
    const rect = el.getBoundingClientRect();
    const beat = clamp((event.clientX - rect.left) / pxPerBeat, 0, Math.max(0, sectionBeats));
    const row = Math.floor((event.clientY - rect.top) / rowH);
    return { beat, pitch: clamp(range.max - row, 0, 127) };
  }

  function beginDrag(
    kind: DragKind,
    index: number,
    event: React.PointerEvent,
    orig: MelodyNote,
  ) {
    drag.current = {
      kind,
      index,
      startX: event.clientX,
      startY: event.clientY,
      orig: { ...orig },
      moved: false,
      base: localRef.current,
    };
    try {
      contentRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is a nicety — the gestures still work without it */
    }
  }

  function handlePointerMove(event: React.PointerEvent) {
    const state = drag.current;
    if (!state || pxPerBeat <= 0) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    state.moved = true;

    const current = localRef.current;
    if (state.kind === "move") {
      applyLocal(
        moveNote(current, state.index, {
          startTime: state.orig.startTime + dx / pxPerBeat,
          pitch: state.orig.pitch - Math.round(dy / rowH),
          grid,
          sectionBeats,
        }),
      );
    } else if (state.kind === "resize-end") {
      applyLocal(
        resizeNote(current, state.index, {
          edge: "end",
          time: state.orig.startTime + state.orig.duration + dx / pxPerBeat,
          grid,
          sectionBeats,
        }),
      );
    } else if (state.kind === "resize-start") {
      applyLocal(
        resizeNote(current, state.index, {
          edge: "start",
          time: state.orig.startTime + dx / pxPerBeat,
          grid,
          sectionBeats,
        }),
      );
    } else {
      const lane = laneRef.current;
      if (!lane) return;
      const rect = lane.getBoundingClientRect();
      const ratio = 1 - (event.clientY - rect.top - 2) / (LANE_H - 8);
      applyLocal(
        setVelocity(current, state.index, MIN_VELOCITY + ratio * (MAX_VELOCITY - MIN_VELOCITY)),
      );
    }
  }

  function handlePointerUp() {
    const state = drag.current;
    drag.current = null;
    if (!state || !state.moved) return;
    onChange(localRef.current);
  }

  function handlePointerCancel() {
    const state = drag.current;
    drag.current = null;
    if (!state || !state.moved) return;
    applyLocal(state.base);
  }

  function handleSurfaceDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const point = pointFor(event);
    if (!point) return;
    const next = addNote(localRef.current, {
      pitch: point.pitch,
      startTime: point.beat,
      grid,
      sectionBeats,
    });
    const index = next.length - 1;
    applyLocal(next);
    setSelected(index);
    onChange(next);
    // Keep the fresh note under the pointer so a tap-drag can place it.
    beginDrag("move", index, event, next[index]);
  }

  function handleNoteDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const note = localRef.current[index];
    if (!note) return;
    setSelected(index);
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const kind: DragKind =
      offsetX <= EDGE_PX ? "resize-start" : offsetX >= rect.width - EDGE_PX ? "resize-end" : "move";
    beginDrag(kind, index, event, note);
  }

  function handleLaneDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || pxPerBeat <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const beat = (event.clientX - rect.left) / pxPerBeat;
    // Two notes can share an onset; the lane prefers the one already selected
    // so a velocity drag doesn't jump to its neighbour.
    const selectedNote = selected != null ? localRef.current[selected] : undefined;
    const index =
      selectedNote && Math.abs(selectedNote.startTime - beat) <= 0.25
        ? selected
        : nearestNoteIndex(localRef.current, beat);
    if (index == null || index < 0) return;
    setSelected(index);
    beginDrag("velocity", index, event, localRef.current[index]);
  }

  function deleteSelected() {
    if (selected == null || !localRef.current[selected]) return;
    const next = removeNote(localRef.current, selected);
    applyLocal(next);
    setSelected(null);
    onChange(next);
  }

  const key = keyName && scale ? { keyName, scale } : null;
  const degreeLabels = useMemo(
    () => (scale ? scaleDegreeLabels({ scale }) : []),
    [scale],
  );
  const anchor = key ? anchorDegree(local, key) : null;
  const pitchSpan = noteRange(local);

  function moveOctave(direction: 1 | -1) {
    const next = shiftOctave(localRef.current, direction);
    if (next === localRef.current) return;
    applyLocal(next);
    onChange(next);
  }

  function moveToDegree(degree: number) {
    if (!key) return;
    const next = transposeToDegree(localRef.current, degree, key);
    if (next === localRef.current) return;
    applyLocal(next);
    onChange(next);
  }

  // Escape cancels a gesture in flight; Delete/Backspace removes the selected
  // note. Both are announced in the toolbar hint — neither is required.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)) return;
      if (event.key === "Escape" && drag.current) {
        handlePointerCancel();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selected != null) {
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const selectedNote = selected != null ? local[selected] : undefined;
  const bars = Math.max(1, Math.ceil(sectionBeats / perBar));

  return (
    <div className="select-none">
      {/* Toolbar — grid snap, the selected note, undo. */}
      <div className="flex items-center gap-2 flex-wrap pb-1.5">
        <label className="flex items-center gap-1 text-3xs font-mono uppercase tracking-wide text-inkMuted">
          Snap
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-[10px] text-ink font-mono"
            value={grid}
            onChange={(event) => setGrid(event.target.value as QuantizeGrid)}
            title="Grid the pointer snaps to when adding, moving and resizing notes"
          >
            {SNAP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        {selectedNote ? (
          <span className="flex items-center gap-1.5 text-2xs font-mono text-ink">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: noteColor(selectedNote.pitch) }}
            />
            {midiToNoteName(selectedNote.pitch)}
            <span className="text-inkMuted">
              beat {selectedNote.startTime.toFixed(2)} · {selectedNote.duration.toFixed(2)}b · vel{" "}
              {selectedNote.velocity ?? 96}
            </span>
            <button
              type="button"
              className="ml-1 border border-edge rounded px-1.5 py-0.5 text-[10px] text-inkMuted hover:text-danger hover:border-danger/60"
              onClick={deleteSelected}
              title="Delete the selected note (or press Delete)"
            >
              ✕ Delete
            </button>
          </span>
        ) : (
          <span className="text-2xs font-mono text-inkMuted/60">tap to add · drag to move · drag an edge to resize</span>
        )}

        <span className="flex-1" />
        {onUndo && (
          <button
            type="button"
            className="border border-edge rounded px-1.5 py-0.5 text-[10px] font-mono text-inkMuted enabled:hover:text-ink disabled:opacity-40"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo the last edit (same history as the header's Undo)"
          >
            ↶ Undo
          </button>
        )}
      </div>

      {/* Transpose — octave, then the key's scale degrees ("move the line to
          the vi"). Both are whole-line moves and one undo step each. */}
      {local.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap pb-1.5">
          <span className="text-3xs font-mono uppercase tracking-wide text-inkMuted">Octave</span>
          <button
            type="button"
            className="border border-edge rounded px-1.5 py-0.5 text-[10px] font-mono text-inkMuted enabled:hover:text-ink disabled:opacity-30"
            onClick={() => moveOctave(-1)}
            disabled={!canShiftOctave(local, -1)}
            title="Move the whole line down an octave"
          >
            −
          </button>
          <button
            type="button"
            className="border border-edge rounded px-1.5 py-0.5 text-[10px] font-mono text-inkMuted enabled:hover:text-ink disabled:opacity-30"
            onClick={() => moveOctave(1)}
            disabled={!canShiftOctave(local, 1)}
            title="Move the whole line up an octave"
          >
            +
          </button>
          {pitchSpan && (
            <span className="text-[9px] font-mono text-inkMuted/60">
              {midiToNoteName(pitchSpan.low)}–{midiToNoteName(pitchSpan.high)}
            </span>
          )}

          {key && degreeLabels.length > 0 && (
            <>
              <span className="ml-2 text-3xs font-mono uppercase tracking-wide text-inkMuted">Sits on</span>
              {degreeLabels.map(({ index, numeral }) => (
                <button
                  key={index}
                  type="button"
                  className={`min-w-[22px] rounded border px-1 py-0.5 text-[10px] font-mono ${
                    anchor === index
                      ? "border-accent/70 bg-accent/15 text-accent"
                      : "border-edge text-inkMuted hover:text-ink"
                  }`}
                  onClick={() => moveToDegree(index)}
                  disabled={anchor === index}
                  title={`Move the line to ${numeral} — diatonic, stays in ${keyName} ${scale}`}
                >
                  {numeral}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Bar ruler. */}
      <div className="flex">
        <div style={{ width: GUTTER_W }} className="shrink-0" />
        <div className="relative flex-1 border-l border-edge/60" style={{ height: RULER_H }}>
          {Array.from({ length: bars }, (_, bar) =>
            bar * perBar >= sectionBeats ? null : (
              <span
                key={bar}
                className="absolute top-0.5 text-[9px] font-mono text-inkMuted/70"
                style={{ left: bar * barPx + 3 }}
              >
                {bar + 1}
              </span>
            ),
          )}
        </div>
      </div>

      {/* Pitch gutter + grid — one scroller so the labels stay aligned. */}
      <div
        className="flex border border-edge rounded overflow-y-auto overflow-x-hidden bg-[#1d1d1d]"
        style={{ maxHeight }}
      >
        <div style={{ width: GUTTER_W }} className="shrink-0">
          {rows.map((row) => (
            <div
              key={row.pitch}
              className={`flex items-center justify-end pr-1.5 font-mono text-[9px] ${
                row.pc === 0 ? "text-accent/80" : row.black ? "text-inkMuted/50" : "text-ink/80"
              }`}
              style={{ height: rowH }}
            >
              {row.pc === 0 || rowH >= 12 ? midiToNoteName(row.pitch) : ""}
            </div>
          ))}
        </div>

        <div
          ref={contentRef}
          className="relative flex-1 bg-panelAlt/60 touch-none"
          style={{ height: contentHeight }}
          onPointerDown={handleSurfaceDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {/* Rows: black keys and out-of-scale tones read darker, so the
              scale tones a line wants to land on stand out. */}
          {rows.map((row, index) => (
            <div
              key={row.pitch}
              className={`absolute inset-x-0 ${
                row.black ? "bg-black/25" : "bg-white/[0.02]"
              } ${row.inScale ? "" : "bg-black/10"}`}
              style={{ top: index * rowH, height: rowH }}
            />
          ))}

          {/* Beat and bar lines. */}
          {Array.from({ length: Math.ceil(sectionBeats) }, (_, beat) => (
            <div
              key={beat}
              className={`absolute inset-y-0 w-px ${beat % perBar === 0 ? "bg-white/30" : "bg-white/10"}`}
              style={{ left: beat * pxPerBeat }}
            />
          ))}

          {local.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-2xs font-mono text-inkMuted/50 pointer-events-none">
              Tap the grid to draw a note — or auto-fill from the corpus
            </p>
          )}

          {/* Notes. */}
          {local.map((note, index) => {
            const noteWidth = Math.max(6, note.duration * pxPerBeat);
            const velocity = note.velocity ?? 96;
            return (
              <div
                key={index}
                role="button"
                tabIndex={-1}
                aria-label={`Melody note ${midiToNoteName(note.pitch)} at beat ${note.startTime}`}
                className={`absolute z-10 rounded-[2px] cursor-grab active:cursor-grabbing ${
                  index === selected ? "ring-1 ring-ink shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" : ""
                }`}
                style={{
                  left: note.startTime * pxPerBeat,
                  width: noteWidth,
                  top: (range.max - note.pitch) * rowH,
                  height: Math.max(4, rowH - 1),
                  backgroundColor: noteColor(note.pitch),
                  opacity: 0.55 + (velocity / MAX_VELOCITY) * 0.45,
                }}
                title={`${midiToNoteName(note.pitch)} · beat ${note.startTime.toFixed(2)} · ${note.duration.toFixed(2)} beats · velocity ${velocity}`}
                onPointerDown={(event) => handleNoteDown(event, index)}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-l-[2px] cursor-col-resize"
                  style={{ width: Math.min(EDGE_PX, noteWidth / 3) }}
                />
                <span
                  className="absolute inset-y-0 right-0 rounded-r-[2px] cursor-col-resize"
                  style={{ width: Math.min(EDGE_PX, noteWidth / 3) }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Velocity lane — drag up/down over a note's onset to set its velocity. */}
      <div className="flex">
        <div
          style={{ width: GUTTER_W }}
          className="shrink-0 pr-1.5 text-right text-[8px] font-mono uppercase text-inkMuted/60 self-center"
        >
          vel
        </div>
        <div
          ref={laneRef}
          className="relative flex-1 border-l border-edge/60 bg-panelAlt/40 touch-none cursor-ns-resize"
          style={{ height: LANE_H }}
          onPointerDown={handleLaneDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          title="Drag up or down over a note to set its velocity"
        >
          {local.map((note, index) => (
            <div
              key={index}
              className="absolute bottom-1 rounded-t-[1px] pointer-events-none"
              style={{
                left: note.startTime * pxPerBeat,
                width: Math.max(3, Math.min(6, note.duration * pxPerBeat)),
                height: Math.max(
                  2,
                  (((note.velocity ?? 96) - MIN_VELOCITY) / (MAX_VELOCITY - MIN_VELOCITY)) * (LANE_H - 8),
                ),
                backgroundColor: noteColor(note.pitch),
                opacity: index === selected ? 1 : 0.75,
              }}
            />
          ))}
          <span className="absolute bottom-0.5 right-1 text-[8px] font-mono text-inkMuted/40 pointer-events-none">
            drag up/down = velocity
          </span>
        </div>
      </div>
    </div>
  );
}
