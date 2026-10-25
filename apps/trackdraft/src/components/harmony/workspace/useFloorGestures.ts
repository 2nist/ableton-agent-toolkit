import type { Dispatch, RefObject, SetStateAction } from "react";
import { SCALE_INTERVALS, pitchClass, type NoteName, type ScaleType } from "@music-theory/core";
import type { Chord } from "../../../types/blueprint";
import type { HarmonyAnalysis } from "../../../lib/harmony/analysis";
import { degreeRelativeTo } from "../../../lib/harmony/tonic";
import { rootForStep, scaleStepSemitones } from "../../../lib/harmony/analysis";
import {
  moveChordTo,
  resizeChordTo,
  trimChordTo,
  FLOOR_STEP,
  type FloorSlot,
} from "../../../lib/harmony/floorLayout";
import {
  orbit,
  panBy,
  screenAxis,
  unprojectToPlane,
  zoomBy,
  type SceneCamera,
  type Vec3,
} from "../../../lib/harmony/scene3d";
import type { BarsPerView } from "../../drums/blocks/meterGrid";
import { BEAT_Z, LADDER_STEPS, STEP_W } from "./useFloorFit";
import { spellingReadings } from "./floorLabel";
import type { Node, Preview } from "./floorTypes";
import type { FloorPreset } from "./FloorBand";

export type Gesture =
  | { mode: "orbit"; x: number; y: number; moved: boolean; plane: { x: number; y: number } }
  | { mode: "pan"; x: number; y: number }
  | {
      mode: "move";
      id: string;
      x0: number;
      y0: number;
      lock: "x" | "z" | null;
      moved: boolean;
      /** Where the box started on the ladder, to know which way it arrived. */
      fromStep: number;
      step: number;
      start: number;
      origin: number;
      grabZ: number;
    }
  | { mode: "resize"; id: string; start: number; beats: number; moved: boolean }
  | { mode: "trim"; id: string; start: number; end: number; beats: number; moved: boolean };

/** Everything the gesture machine reads off the scene it is drawing on. */
export interface FloorGestureScene {
  svgRef: RefObject<SVGSVGElement>;
  frameRef: RefObject<HTMLDivElement>;
  width: number;
  height: number;
  locked: boolean;
  nodes: Node[];
  slots: FloorSlot[];
  rests: readonly { start: number; beats: number }[];
  chords: Chord[];
  analysis: HarmonyAnalysis;
  keyName: NoteName;
  scale: ScaleType;
  beatsPerChord: number;
  cycleBeats: number;
  renderCamera: SceneCamera;
  origin: { x: number; y: number };
  project: (point: Vec3) => { x: number; y: number };
}

/** Everything a gesture can change. */
export interface FloorGestureHandlers {
  setPreview: Dispatch<SetStateAction<Preview | null>>;
  setReadout: (message: string) => void;
  setMenu: (menu: { id: string; x: number; y: number } | null) => void;
  setRestMenu: (menu: { beat: number; x: number; y: number } | null) => void;
  setCamera: Dispatch<SetStateAction<SceneCamera>>;
  setPreset: (preset: FloorPreset) => void;
  setFirstBar: Dispatch<SetStateAction<number>>;
  onSelectChord: (chordId: string | null) => void;
  onChangeChords: (chords: Chord[]) => void;
  onPreviewChord?: (chord: Chord) => void;
  onPlaceChord: (degree: number, accidental: number, beat: number, span: number, spelling?: "sharp" | "flat") => void;
  onTranspose: (semitones: number, wholeSong: boolean) => void;
}

export interface FloorGestureWindow {
  barsPerView: BarsPerView;
  windowFirstBar: number;
  lastFirstBar: number;
}

const MENU_W = 236;
const MENU_H = 176;

/**
 * THE GESTURE MACHINE for the floor: drag a box (ladder row + time,
 * axis-locked), its edges (length / trim), drag empty floor to orbit,
 * shift-drag to pan, click to place, right-click for the menus.
 *
 * Split out of the component because it is one long chain of "what did the
 * pointer grab, and what does that mean on this camera" — it needs the win
 * projections but nothing about how the plate is painted.
 */
export function useFloorGestures(
  scene: FloorGestureScene,
  handlers: FloorGestureHandlers,
  view: FloorGestureWindow,
  gesture: { current: Gesture | null },
) {
  const {
    svgRef,
    frameRef,
    width,
    height,
    locked,
    nodes,
    slots,
    rests,
    chords,
    analysis,
    keyName,
    scale,
    beatsPerChord,
    cycleBeats,
    renderCamera,
    origin,
  } = scene;
  const {
    setPreview,
    setReadout,
    setMenu,
    setRestMenu,
    setCamera,
    setPreset,
    setFirstBar,
    onSelectChord,
    onChangeChords,
    onPreviewChord,
    onPlaceChord,
    onTranspose,
  } = handlers;
  const { barsPerView, windowFirstBar, lastFirstBar } = view;

  function localPoint(event: React.PointerEvent | React.MouseEvent) {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  function withPitch(chord: Chord, step: number, spelling?: "sharp" | "flat"): Chord {
    const natural = (SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).includes(step % 12);
    return {
      ...chord,
      root: rootForStep(keyName, scale, step, spelling),
      spelling: natural ? undefined : (spelling ?? "flat"),
    };
  }

  /**
   * Which way a landing on a chromatic step is named. Arriving from below
   * means you sharpened the degree you came from (♯III); arriving from above
   * means you flattened the one you landed under (♭IV). A drop straight onto
   * the row keeps whichever reading the key prefers.
   */
  function spellingFor(
    step: number,
    fromStep: number,
    quality: Chord["quality"],
  ): "sharp" | "flat" | undefined {
    if ((SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).includes(step % 12)) return undefined;
    const preferred = step > fromStep ? "sharp" : "flat";
    const readings = spellingReadings(keyName, scale, step, quality);
    if (readings[preferred]) return preferred;
    const other = preferred === "sharp" ? "flat" : "sharp";
    return readings[other] ? other : undefined;
  }

  /** The name a ladder step gets in this key, for the mid-drag readout. */
  function stepLabel(step: number, spelling?: "sharp" | "flat"): string {
    return rootForStep(keyName, scale, step, spelling);
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button === 2) return; // the context menu handles itself
    setMenu(null);
    setRestMenu(null);
    const point = localPoint(event);
    const target = event.target as Element | null;
    const resizeId = target?.closest?.("[data-resize]")?.getAttribute("data-resize") ?? null;
    const trimId = target?.closest?.("[data-trim]")?.getAttribute("data-trim") ?? null;
    const chordId =
      target?.closest?.("[data-chord-id]")?.getAttribute("data-chord-id") ?? resizeId ?? trimId ?? null;

    if (!chordId) {
      gesture.current = event.shiftKey
        ? { mode: "pan", x: event.clientX, y: event.clientY }
        : { mode: "orbit", x: event.clientX, y: event.clientY, moved: false, plane: point };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    onSelectChord(chordId);
    const node = nodes.find((candidate) => candidate.chord.id === chordId);
    if (!node) return;

    if (trimId) {
      gesture.current = { mode: "trim", id: chordId, start: node.start, end: node.start + node.beats, beats: node.beats, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (resizeId) {
      gesture.current = { mode: "resize", id: chordId, start: node.start, beats: node.beats, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const plane = unprojectToPlane(point.x, point.y, node.center.y - node.size.y / 2, renderCamera, origin);
    gesture.current = {
      mode: "move",
      id: chordId,
      x0: point.x,
      y0: point.y,
      lock: null,
      moved: false,
      fromStep: node.step,
      step: node.step,
      start: node.start,
      origin: node.start,
      grabZ: plane ? plane.z / BEAT_Z - node.start : node.beats / 2,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!active) return;
    const point = localPoint(event);

    if (active.mode === "orbit") {
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
      active.x = event.clientX;
      active.y = event.clientY;
      if (locked) return; // the front view is a drawing surface, not a camera
      setCamera((current) => orbit(current, dx, dy));
      setPreset("threeQuarter");
      return;
    }
    if (active.mode === "pan") {
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      active.x = event.clientX;
      active.y = event.clientY;
      setCamera((current) => panBy(current, dx, dy));
      return;
    }
    const node = nodes.find((candidate) => candidate.chord.id === active.id);
    if (!node) return;
    const laneY = node.center.y - node.size.y / 2;

    if (active.mode === "trim") {
      const plane = unprojectToPlane(point.x, point.y, laneY, renderCamera, origin);
      if (!plane) return;
      const start = Math.max(0, Math.min(active.end - FLOOR_STEP, Math.round((plane.z / BEAT_Z) / FLOOR_STEP) * FLOOR_STEP));
      active.start = start;
      active.beats = active.end - start;
      active.moved = true;
      setPreview({ id: active.id, start, beats: active.beats });
      setReadout(`trim to ${active.beats}b — the rest in front is yours to fill`);
      return;
    }

    if (active.mode === "resize") {
      const plane = unprojectToPlane(point.x, point.y, laneY, renderCamera, origin);
      if (!plane) return;
      const end = Math.round((plane.z / BEAT_Z) / FLOOR_STEP) * FLOOR_STEP;
      const beats = Math.max(FLOOR_STEP, end - active.start);
      active.beats = beats;
      active.moved = true;
      setPreview({ id: active.id, beats });
      setReadout(`${beats} beats${beats + active.start > cycleBeats ? " · extends the cycle" : ""}`);
      return;
    }

    const dx = point.x - active.x0;
    const dy = point.y - active.y0;
    if (!active.moved && Math.hypot(dx, dy) < 4) return;
    active.moved = true;

    if (!active.lock) {
      const axisX = screenAxis("x", node.center, renderCamera, origin);
      const axisZ = screenAxis("z", node.center, renderCamera, origin);
      active.lock = Math.abs(dx * axisX.x + dy * axisX.y) >= Math.abs(dx * axisZ.x + dy * axisZ.y) ? "x" : "z";
    }

    const plane = unprojectToPlane(point.x, point.y, laneY, renderCamera, origin);
    if (!plane) return;
    const step = Math.max(0, Math.min(LADDER_STEPS - 1, Math.round(plane.x / STEP_W)));
    const start = Math.max(0, Math.round((plane.z / BEAT_Z - active.grabZ) / FLOOR_STEP) * FLOOR_STEP);

    active.step = active.lock === "z" ? node.step : step;
    active.start = active.lock === "x" ? node.start : start;
    const spelling = spellingFor(active.step, active.fromStep, node.chord.quality);
    setPreview({ id: active.id, step: active.step, spelling, start: active.start });
    setReadout(
      `${stepLabel(active.step, spelling)} · beat ${active.start + 1} · ${node.beats}b`,
    );
  }

  function onPointerUp() {
    const active = gesture.current;
    gesture.current = null;
    if (!active) return;

    if (active.mode === "orbit") {
      if (active.moved) return;
      // THE gesture: click a spot on the floor and a chord of that degree
      // appears at that beat. The ladder IS the keyboard — no palette.
      const plane = unprojectToPlane(active.plane.x, active.plane.y, 0, renderCamera, origin);
      if (!plane) {
        onSelectChord(null);
        return;
      }
      const exact = plane.x / STEP_W;
      const step = Math.max(0, Math.min(LADDER_STEPS - 1, Math.round(exact)));
      // Left half of a chromatic row reads as the sharp of the row below,
      // right half as the flat of the row above — the same grammar as a drag.
      // Quality only changes the case and the suffix of a numeral, never the
      // accidentals, so "maj" is enough to ask "is this name usable?".
      const preferred = exact < step ? "sharp" : "flat";
      const readings = spellingReadings(keyName, scale, step, "maj");
      const spelling =
        (SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian).includes(step % 12)
          ? undefined
          : readings[preferred]
            ? preferred
            : readings[preferred === "sharp" ? "flat" : "sharp"]
              ? (preferred === "sharp" ? "flat" : "sharp")
              : undefined;
      const beat = Math.max(0, Math.round((plane.z / BEAT_Z) / FLOOR_STEP) * FLOOR_STEP);
      const band = rests.find((rest) => beat >= rest.start - 0.001 && beat < rest.start + rest.beats);
      // Inside a rest the new chord fills the silence it landed in; on open
      // floor it takes its usual length.
      const span = band ? Math.max(FLOOR_STEP, band.start + band.beats - beat) : beatsPerChord;
      const reading = degreeRelativeTo(
        (pitchClass(keyName) + step) % 12,
        pitchClass(keyName),
        scale,
        spelling,
      );
      onPlaceChord(reading.deg, reading.acc, beat, span, spelling);
      setReadout(`added ${stepLabel(step, spelling)} at beat ${beat + 1}`);
      return;
    }
    if (active.mode === "pan") return;
    const node = nodes.find((candidate) => candidate.chord.id === active.id);
    if (!node || !active.moved) {
      setPreview(null);
      return;
    }

    if (active.mode === "trim") {
      onChangeChords(trimChordTo(chords, active.id, active.start));
      setReadout(`trimmed to ${active.beats}b`);
    } else if (active.mode === "resize") {
      onChangeChords(resizeChordTo(chords, active.id, active.start + active.beats));
      setReadout(`length ${active.beats} beats`);
    } else {
      // Only re-pitch when the row actually changed: re-deriving the same step
      // re-spells the chord through the key, and ♭VI in D comes back as A#.
      const spelling = spellingFor(active.step, active.fromStep, node.chord.quality);
      const rooted = chords.map((chord) =>
        chord.id === active.id && active.step !== node.step ? withPitch(chord, active.step, spelling) : chord,
      );
      // A drop lands *on* another chord's span → the two trade places.
      const victim = slots.find(
        (slot) => slot.chord.id !== active.id && active.start >= slot.start && active.start < slot.end - 0.001,
      );
      onChangeChords(moveChordTo(rooted, active.id, active.start));
      onPreviewChord?.(rooted.find((chord) => chord.id === active.id) ?? node.chord);
      setReadout(
        victim
          ? `swapped with ${analysis.events[victim.index]?.roman ?? "that chord"} · both keep their length`
          : `placed at beat ${active.start + 1}`,
      );
    }
    setPreview(null);
  }

  function onContextMenu(event: React.MouseEvent<SVGSVGElement>) {
    event.preventDefault();
    const target = event.target as Element | null;
    const restAt = target?.closest?.("[data-rest]")?.getAttribute("data-rest") ?? null;
    if (restAt !== null) {
      const host = frameRef.current;
      const hostRect = host?.getBoundingClientRect();
      const restRect = (target as Element).getBoundingClientRect();
      setMenu(null);
      setRestMenu({
        beat: Number(restAt),
        x: hostRect ? Math.max(4, restRect.left - hostRect.left) : restRect.left,
        y: hostRect ? restRect.bottom - hostRect.top + (host?.scrollTop ?? 0) + 4 : restRect.bottom + 4,
      });
      return;
    }
    setRestMenu(null);
    const chordId = target?.closest?.("[data-chord-id]")?.getAttribute("data-chord-id") ?? null;
    if (!chordId) {
      setMenu(null);
      return;
    }
    const host = frameRef.current;
    const hostRect = host?.getBoundingClientRect();
    const boxRect = (target as Element).getBoundingClientRect();
    onSelectChord(chordId);
    const left = hostRect
      ? Math.max(4, Math.min(boxRect.left - hostRect.left + boxRect.width / 2 - MENU_W / 2, (host?.clientWidth ?? width) - MENU_W - 4))
      : boxRect.left;
    const below = hostRect ? boxRect.bottom - hostRect.top + (host?.scrollTop ?? 0) + 6 : boxRect.bottom + 6;
    const visibleBottom = (host?.scrollTop ?? 0) + (host?.clientHeight ?? height);
    const top = below + MENU_H <= visibleBottom ? below : Math.max(4, below - boxRect.height - MENU_H - 12);
    setMenu({ id: chordId, x: left, y: top });
  }

  /** Shift-wheel walks the bars; a plain wheel tilts the camera. */
  function onWheel(event: React.WheelEvent<SVGSVGElement>) {
    if (event.shiftKey && barsPerView !== "all") {
      setFirstBar(Math.max(0, Math.min(lastFirstBar, windowFirstBar + (event.deltaY > 0 ? 1 : -1))));
      return;
    }
    setCamera((current) => zoomBy(current, event.deltaY > 0 ? 0.94 : 1.06));
  }

  /**
   * The tonic drag listens on `window` rather than relying on pointer capture:
   * thumbing the key up and down is a small, precise gesture that must not be
   * lost the moment the pointer leaves a 100px chip.
   */
  function onTonicPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    setTonicSteps: (steps: number) => void,
  ) {
    if (event.button === 2) return;
    event.preventDefault();
    const y0 = event.clientY;
    let steps = 0;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.round((y0 - moveEvent.clientY) / 26);
      if (next === steps) return;
      steps = next;
      setTonicSteps(next);
      const semitones = scaleStepSemitones(scale, next);
      setReadout(
        next === 0
          ? "tonic unchanged"
          : `${semitones} semitones${moveEvent.altKey ? " · this section" : " · whole song"}`,
      );
    };
    const up = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const semitones = scaleStepSemitones(scale, steps);
      setTonicSteps(0);
      if (semitones === 0) {
        setReadout("tonic unchanged");
        return;
      }
      onTranspose(semitones, !upEvent.altKey);
      setReadout(`transposed ${semitones} semitones${upEvent.altKey ? " (this section)" : ""}`);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return { onPointerDown, onPointerMove, onPointerUp, onContextMenu, onWheel, onTonicPointerDown };
}
