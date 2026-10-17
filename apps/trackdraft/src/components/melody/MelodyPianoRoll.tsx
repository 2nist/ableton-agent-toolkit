/**
 * MelodyPianoRoll — a read-only pitch/time view: notes as horizontal bars
 * across the section's beat span, positioned by pitch (low at the bottom,
 * high at the top), with a mini piano keyboard down the left gutter so each
 * row reads as a key.
 *
 * The Melody tab's editing surface is `MelodyNoteEditor` (pointer/touch note
 * drawing, drag, resize and velocity); this canvas roll survives as the
 * non-interactive preview registered in the design lab.
 *
 * Drawn on a canvas so the grid + keyboard + bars stay crisp at any size;
 * the pure math (pitch rows, note rects) is small enough to live here.
 */

import { useEffect, useRef } from "react";
import type { MelodyNote } from "../../types/blueprint";
import { midiToNoteName } from "../../lib/melody/recorder";

/** Theme colors (ABLETON_DARK) — canvas can't use Tailwind classes. */
const PANEL_ALT = "#5C5C5C";
const GRID_LINE = "rgba(255,255,255,0.1)";
const BAR_LINE = "rgba(255,255,255,0.28)";
const KEY_WHITE = "#C9C9C9";
const KEY_BLACK = "#242424";
const KEY_EDGE = "#1C1C1C";
/** Width of the piano-keyboard gutter (incl. note labels). */
const GUTTER_W = 54;
const TOP_PAD = 10;
const BOTTOM_PAD = 16;
/** Semitones of padding above/below the played range. */
const RANGE_PAD = 2;
/** Minimum vertical span (semitones) so a tiny range still has rows. */
const MIN_RANGE = 12;
/** Pitch classes that are natural keys (no sharp/flat). */
const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

interface Props {
  notes: MelodyNote[];
  sectionBeats: number;
  height?: number;
}

export default function MelodyPianoRoll({ notes, sectionBeats, height = 150 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef(notes);
  const sectionBeatsRef = useRef(sectionBeats);
  const heightRef = useRef(height);
  notesRef.current = notes;
  sectionBeatsRef.current = sectionBeats;
  heightRef.current = height;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      const cssWidth = wrap.clientWidth || 320;
      const dpr = window.devicePixelRatio || 1;
      const cssHeight = heightRef.current;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPianoRoll(ctx, cssWidth, cssHeight, notesRef.current, sectionBeatsRef.current);
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} className="block rounded border border-edge" />
    </div>
  );
}

function drawPianoRoll(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  notes: MelodyNote[],
  sectionBeats: number,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PANEL_ALT;
  ctx.fillRect(0, 0, width, height);

  const pitches = notes.map((n) => n.pitch);
  const lo = pitches.length ? Math.min(...pitches) : 60;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const minPitch = Math.max(0, Math.floor(lo) - RANGE_PAD);
  const maxPitch = Math.min(127, Math.ceil(hi) + RANGE_PAD);
  const range = Math.max(MIN_RANGE, maxPitch - minPitch);

  const mainX = GUTTER_W;
  const mainW = Math.max(1, width - GUTTER_W);
  const mainH = Math.max(1, height - TOP_PAD - BOTTOM_PAD);
  const rowH = mainH / range;
  const stepBeats = sectionBeats > 0 ? sectionBeats : 1;

  const pitchToY = (pitch: number) => TOP_PAD + (1 - (pitch - minPitch) / range) * mainH;

  // --- Vertical grid: one line per beat, brighter every 4 (bar lines). ---
  ctx.lineWidth = 1;
  for (let b = 1; b < Math.floor(stepBeats); b++) {
    const x = mainX + (b / stepBeats) * mainW;
    ctx.strokeStyle = b % 4 === 0 ? BAR_LINE : GRID_LINE;
    ctx.beginPath();
    ctx.moveTo(x, TOP_PAD);
    ctx.lineTo(x, TOP_PAD + mainH);
    ctx.stroke();
  }

  // --- Horizontal grid: one line per semitone row (very dim). ---
  for (let p = minPitch; p <= maxPitch; p++) {
    const y = pitchToY(p);
    ctx.strokeStyle = GRID_LINE;
    ctx.beginPath();
    ctx.moveTo(mainX, y);
    ctx.lineTo(mainX + mainW, y);
    ctx.stroke();
  }

  // --- Beat labels along the bottom axis. ---
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (let b = 0; b <= Math.floor(stepBeats); b += 4) {
    const x = mainX + (b / stepBeats) * mainW;
    ctx.fillText(String(b), x, TOP_PAD + mainH + 2);
  }

  // --- Piano keyboard gutter: white keys for naturals, black for accidentals. ---
  drawKeyboard(ctx, height, minPitch, maxPitch, range, rowH);

  // --- Note bars (time × pitch rectangles). Each bar sits in its pitch's
  // row (top = pitchToY(pitch)), from startBeat to startBeat+duration. ---
  for (const n of notes) {
    const pitch = Math.round(n.pitch);
    let x = mainX + (n.startTime / stepBeats) * mainW;
    let w = Math.max(3, (Math.max(0.25, n.duration) / stepBeats) * mainW);
    if (x < mainX) {
      w -= mainX - x;
      x = mainX;
    }
    const y = pitchToY(pitch);
    const barH = Math.max(2, rowH - 2);
    ctx.fillStyle = `hsl(${(pitch * 17) % 360}, 60%, 55%)`;
    ctx.fillRect(x, y, Math.max(1, w), barH);
  }
}

/** Draws the piano keyboard down the left gutter — white keys for the
 *  natural pitches, shorter black keys offset right for the accidentals,
 *  with note names on the white keys when there's room. */
function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  height: number,
  minPitch: number,
  maxPitch: number,
  range: number,
  rowH: number,
): void {
  const mainH = height - TOP_PAD - BOTTOM_PAD;
  const pitchToY = (pitch: number) => TOP_PAD + (1 - (pitch - minPitch) / range) * mainH;

  // White keys first (under the black keys).
  for (let p = minPitch; p <= maxPitch; p++) {
    const pc = ((p % 12) + 12) % 12;
    if (!NATURAL_PCS.has(pc)) continue;
    const y = pitchToY(p);
    ctx.fillStyle = KEY_WHITE;
    ctx.fillRect(0, y, GUTTER_W, rowH + 1);
    ctx.strokeStyle = KEY_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, y + 0.5, GUTTER_W - 1, rowH);
    // Label when there's room (>= ~7px), else just the octave Cs.
    const labelable = rowH >= 7;
    const isC = pc === 0;
    if (labelable || isC) {
      ctx.fillStyle = "#1C1C1C";
      ctx.font = `${Math.min(10, Math.max(7, Math.round(rowH - 2)))}px ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(midiToNoteName(p), 4, y + rowH / 2 + 0.5);
    }
  }

  // Black keys on top (narrow, offset right, spanning into the gaps).
  for (let p = minPitch; p <= maxPitch; p++) {
    const pc = ((p % 12) + 12) % 12;
    if (NATURAL_PCS.has(pc)) continue;
    const y = pitchToY(p);
    ctx.fillStyle = KEY_BLACK;
    ctx.fillRect(GUTTER_W * 0.52, y - rowH / 2, GUTTER_W * 0.48, rowH);
    ctx.strokeStyle = KEY_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(GUTTER_W * 0.52 + 0.5, y - rowH / 2 + 0.5, GUTTER_W * 0.48 - 1, rowH);
  }
}
