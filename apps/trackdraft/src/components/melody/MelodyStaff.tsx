/**
 * MelodyStaff — draws a captured monophonic melody as standard musical
 * notation on a treble staff (canvas). This is the "make it translate"
 * view: instead of the colored timing blocks, you read the line as real
 * notation — staff lines, treble clef, note heads with stems and flags,
 * ledger lines for notes off the staff, and accidentals for non-scale
 * tones.
 *
 * The pure layout math lives in `lib/melody/notation.ts` (diatonic staff
 * positions, note-head values, ledger/accidental rules) and is unit-tested
 * there; this component only draws.
 */

import { useEffect, useRef } from "react";
import type { MelodyNote } from "../../types/blueprint";
import type { NoteName, ScaleType } from "@music-theory/core";
import {
  staffSteps,
  ledgerLinesBelow,
  ledgerLinesAbove,
  noteHeadType,
  accidentalFor,
  type NoteHeadType,
} from "../../lib/melody/notation";

/** Theme colors (ABLETON_DARK via tailwind.config.js) — canvas can't use
 *  Tailwind classes, so these are the resolved hex values. */
const INK = "#FFFFFF";
const INK_DIM = "rgba(255,255,255,0.4)";
const PANEL_ALT = "#5C5C5C";
/** Vertical distance between adjacent staff lines (E-G-B-D-F). */
const LINE_SPACING = 9;
/** Horizontal slot for the treble clef at the staff's left. */
const CLEF_X = 22;
/** Stem length in line-spacings. */
const STEM_LEN = 3.5 * LINE_SPACING;

interface Props {
  notes: MelodyNote[];
  /** Beat span of the section — maps x to real time, like the piano roll,
   *  so a sparse take shows rests rather than stretched notes. */
  sectionBeats: number;
  /** The song/section key (renamed from `key` — that's a reserved React
   *  prop and would arrive undefined). */
  songKey: NoteName;
  scale: ScaleType;
  height?: number;
}

/** The melody as notation, sized to its container. Redraws only when the
 *  notes/timing/key/scale change (not on every parent re-render). */
export default function MelodyStaff({ notes, sectionBeats, songKey, scale, height = 120 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const notesRef = useRef(notes);
  const sectionBeatsRef = useRef(sectionBeats);
  const keyRef = useRef(songKey);
  const scaleRef = useRef(scale);
  const heightRef = useRef(height);
  notesRef.current = notes;
  sectionBeatsRef.current = sectionBeats;
  keyRef.current = songKey;
  scaleRef.current = scale;
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
      drawStaff(ctx, cssWidth, cssHeight, notesRef.current, sectionBeatsRef.current, keyRef.current, scaleRef.current);
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

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawStaff(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  notes: MelodyNote[],
  sectionBeats: number,
  songKey: NoteName,
  scale: ScaleType,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PANEL_ALT;
  ctx.fillRect(0, 0, width, height);

  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime);
  const stepsArr = sorted.map((n) => staffSteps(n.pitch));
  const minSteps = stepsArr.length ? Math.min(...stepsArr) : 0;
  const maxSteps = stepsArr.length ? Math.max(...stepsArr) : 8;

  // Place the staff so extreme ledger lines fit; center it when everything
  // is inside the five lines.
  const half = LINE_SPACING / 2;
  const topMargin = 16;
  const bottomMargin = 16;
  let bottomLineY: number;
  if (minSteps >= 0 && maxSteps <= 8) {
    bottomLineY = height / 2 + 2 * LINE_SPACING;
  } else {
    const minY = topMargin + 4 * LINE_SPACING + Math.max(0, maxSteps - 8) * half;
    const maxY = height - bottomMargin + Math.min(0, minSteps) * half;
    bottomLineY = minY > maxY ? minY : Math.max(minY, Math.min(maxY, height / 2 + 2 * LINE_SPACING));
  }

  // Staff lines (top F5 → bottom E4).
  ctx.strokeStyle = INK_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const y = bottomLineY - i * LINE_SPACING;
    ctx.moveTo(CLEF_X, y);
    ctx.lineTo(width - 8, y);
  }
  ctx.stroke();

  // Treble clef, centered on the G line (second from bottom).
  drawTrebleClef(ctx, 14, bottomLineY - LINE_SPACING, LINE_SPACING);

  // Time-accurate layout: notes sit at their real beat positions across the
  // section (same time axis as the piano roll), and the empty space becomes
  // rests — no more stretching a sparse take to fill the line. A minimum
  // gap between heads only steps in when real positions would collide.
  const leftX = CLEF_X + 12;
  const rightX = width - 8;
  const usable = rightX - leftX;
  const stepBeats = sectionBeats > 0 ? sectionBeats : 1;
  const timeX = (beat: number) => leftX + (Math.max(0, Math.min(stepBeats, beat)) / stepBeats) * usable;

  // Rests fill every gap — before the first note, between notes, after the
  // last note — as whole rests per full 4-beat bar plus a partial rest.
  for (const rest of restsForSong(sorted, sectionBeats)) {
    drawRest(ctx, timeX(rest.time), rest.type, bottomLineY);
  }

  let lastX = -Infinity;
  const laid = sorted.map((n) => {
    const accidental = accidentalFor(n.pitch, songKey, scale);
    const minAdvance = LINE_SPACING * 1.5 + (accidental ? LINE_SPACING * 1.1 : 0);
    const x = Math.max(timeX(n.startTime), lastX + minAdvance);
    lastX = x;
    return { note: n, x, accidental };
  });

  for (const { note, x, accidental } of laid) {
    const steps = staffSteps(note.pitch);
    const y = bottomLineY - steps * half;
    const type = noteHeadType(note.duration);

    // Ledger lines first (behind the note).
    for (const s of ledgerLinesBelow(steps)) drawLedger(ctx, bottomLineY - s * half, x);
    for (const s of ledgerLinesAbove(steps)) drawLedger(ctx, bottomLineY - s * half, x);

    // Accidental before the head.
    if (accidental) drawAccidental(ctx, x, y, accidental);

    drawNote(ctx, x, y, type, steps < 4);
  }
}

/** Rests for a monophonic line's gaps — before the first note, between
 *  notes, and after the last note — one whole rest per full 4-beat bar,
 *  then a partial rest (half/quarter/…) for the remainder. Times are in
 *  beats from the section start. Gaps under a 16th are ignored (too small
 *  to read as a separate rest). */
function restsForSong(notes: MelodyNote[], sectionBeats: number): { time: number; type: NoteHeadType }[] {
  const rests: { time: number; type: NoteHeadType }[] = [];
  let cursor = 0;
  const pushGap = (start: number, beats: number) => {
    if (beats < 0.24) return;
    let t = start;
    let rem = beats;
    while (rem >= 4 - 0.001) {
      rests.push({ time: t, type: "whole" });
      t += 4;
      rem -= 4;
    }
    if (rem >= 0.24) rests.push({ time: t, type: noteHeadType(rem) });
  };
  for (const n of notes) {
    if (n.startTime - cursor >= 0.24) pushGap(cursor, n.startTime - cursor);
    cursor = Math.max(cursor, n.startTime + n.duration);
  }
  if (sectionBeats - cursor >= 0.24) pushGap(cursor, sectionBeats - cursor);
  return rests;
}

/** Draw a rest symbol at beat-time position `x`. Whole/half are the classic
 *  hanging/sitting bars; quarter/eighth/16th are drawn glyphs. Rests sit
 *  around the 3rd space (the standard rest register). */
function drawRest(ctx: CanvasRenderingContext2D, x: number, type: NoteHeadType, bottomLineY: number): void {
  const s = LINE_SPACING;
  switch (type) {
    case "whole": {
      // Hangs down from the 4th line (D5).
      ctx.fillStyle = INK;
      ctx.fillRect(x - s * 0.65, bottomLineY - 3 * s, s * 1.3, s * 0.55);
      break;
    }
    case "half": {
      // Sits on the 3rd line (B4, middle line).
      ctx.fillStyle = INK;
      ctx.fillRect(x - s * 0.65, bottomLineY - 2 * s - s * 0.55, s * 1.3, s * 0.55);
      break;
    }
    case "quarter":
      drawQuarterRest(ctx, x, bottomLineY - 2.5 * s);
      break;
    case "eighth":
      drawHookRest(ctx, x, bottomLineY - 2.5 * s, 1);
      break;
    case "sixteenth":
      drawHookRest(ctx, x, bottomLineY - 2.5 * s, 2);
      break;
  }
}

/** A drawn quarter-rest squiggle — diagonal slash with a top curl and a
 *  bottom hook, centered on `y` (the 3rd space). */
function drawQuarterRest(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const s = LINE_SPACING;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, s * 0.14);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + s * 0.42, y - s * 0.95);
  ctx.lineTo(x - s * 0.42, y + s * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.42, y - s * 0.95);
  ctx.quadraticCurveTo(x - s * 0.12, y - s * 0.5, x - s * 0.08, y - s * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, y + s * 0.3);
  ctx.quadraticCurveTo(x - s * 0.72, y + s * 0.72, x - s * 0.32, y + s * 0.82);
  ctx.quadraticCurveTo(x + s * 0.1, y + s * 0.9, x + s * 0.28, y + s * 0.58);
  ctx.stroke();
}

/** A drawn eighth/sixteenth rest — a dot on the 3rd space, a stem rising
 *  up-right, and one or two flags hooking down-left. */
function drawHookRest(ctx: CanvasRenderingContext2D, x: number, y: number, flags: number): void {
  const s = LINE_SPACING;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, s * 0.14);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x - s * 0.18, y + s * 0.12, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - s * 0.05, y + s * 0.05);
  ctx.lineTo(x + s * 0.4, y - s * 0.9);
  ctx.stroke();
  for (let f = 0; f < flags; f++) {
    const fy = y - s * 0.9 + f * s * 0.55;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.4, fy);
    ctx.quadraticCurveTo(x + s * 0.75, fy + s * 0.35, x + s * 0.55, fy + s * 0.95);
    ctx.quadraticCurveTo(x + s * 0.3, fy + s * 0.55, x + s * 0.25, fy + s * 0.3);
    ctx.fill();
  }
}

function drawLedger(ctx: CanvasRenderingContext2D, y: number, x: number): void {
  const w = LINE_SPACING * 1.5;
  ctx.strokeStyle = INK_DIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x + w / 2, y);
  ctx.stroke();
}

function drawAccidental(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  accidental: "sharp" | "flat" | "natural",
): void {
  const glyph = accidental === "sharp" ? "♯" : accidental === "flat" ? "♭" : "♮";
  ctx.fillStyle = INK;
  ctx.font = `${Math.round(LINE_SPACING * 1.5)}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, x - LINE_SPACING * 0.95, y + LINE_SPACING * 0.05);
}

function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, type: NoteHeadType, stemUp: boolean): void {
  const headW = LINE_SPACING * 1.15;
  const headH = LINE_SPACING * 0.82;

  // Stem (all but whole notes).
  const hasStem = type !== "whole";
  if (hasStem) {
    const stemX = stemUp ? x + headW / 2 : x - headW / 2;
    const tip = stemUp ? y - STEM_LEN : y + STEM_LEN;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(stemX, y);
    ctx.lineTo(stemX, tip);
    ctx.stroke();

    // Flags for eighth and shorter.
    if (type === "eighth" || type === "sixteenth") {
      drawFlag(ctx, stemX, tip, stemUp);
      if (type === "sixteenth") drawFlag(ctx, stemX, stemUp ? tip + LINE_SPACING * 0.95 : tip - LINE_SPACING * 0.95, stemUp);
    }
  }

  // Head (open for whole/half).
  ctx.beginPath();
  ctx.ellipse(x, y, headW / 2, headH / 2, -0.22, 0, Math.PI * 2);
  if (type === "whole" || type === "half") {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  } else {
    ctx.fillStyle = INK;
    ctx.fill();
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, stemUp: boolean): void {
  ctx.fillStyle = INK;
  ctx.beginPath();
  if (stemUp) {
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + LINE_SPACING * 0.55, y + LINE_SPACING * 0.1, x + LINE_SPACING * 0.6, y + LINE_SPACING * 1.15);
    ctx.lineTo(x + LINE_SPACING * 0.28, y + LINE_SPACING * 1.0);
    ctx.quadraticCurveTo(x + LINE_SPACING * 0.2, y + LINE_SPACING * 0.45, x, y);
  } else {
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - LINE_SPACING * 0.55, y - LINE_SPACING * 0.1, x - LINE_SPACING * 0.6, y - LINE_SPACING * 1.15);
    ctx.lineTo(x - LINE_SPACING * 0.28, y - LINE_SPACING * 1.0);
    ctx.quadraticCurveTo(x - LINE_SPACING * 0.2, y - LINE_SPACING * 0.45, x, y);
  }
  ctx.fill();
}

/** A hand-drawn treble clef, stroked, wrapped around the G line (the staff
 *  line the clef's spiral centers on). `s` = line spacing. The shape is a
 *  single continuous curve: bottom hook → spiral up the left → top hook →
 *  the two right-hand curls. */
function drawTrebleClef(ctx: CanvasRenderingContext2D, gx: number, gy: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.3, s * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(gx - 0.1 * s, gy + 2.8 * s);
  ctx.bezierCurveTo(gx - 1.5 * s, gy + 2.6 * s, gx - 1.45 * s, gy + 0.95 * s, gx - 0.05 * s, gy + 0.45 * s);
  ctx.bezierCurveTo(gx + 0.95 * s, gy + 0.1 * s, gx + 1.2 * s, gy - 0.95 * s, gx + 0.55 * s, gy - 1.5 * s);
  ctx.bezierCurveTo(gx + 0.1 * s, gy - 1.9 * s, gx - 0.5 * s, gy - 1.8 * s, gx - 0.6 * s, gy - 1.1 * s);
  ctx.bezierCurveTo(gx - 0.7 * s, gy - 0.3 * s, gx - 0.05 * s, gy + 0.25 * s, gx + 0.55 * s, gy + 0.5 * s);
  ctx.bezierCurveTo(gx + 1.0 * s, gy + 0.7 * s, gx + 1.15 * s, gy + 1.15 * s, gx + 0.8 * s, gy + 1.35 * s);
  ctx.bezierCurveTo(gx + 0.45 * s, gy + 1.55 * s, gx + 0.1 * s, gy + 1.3 * s, gx + 0.3 * s, gy + 1.05 * s);
  ctx.stroke();
  ctx.restore();
}
