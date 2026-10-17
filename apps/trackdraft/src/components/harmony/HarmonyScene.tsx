/**
 * HarmonyScene — the experimental 3D view of a progression.
 *
 * The honeycomb answers "where does this chord sit among its neighbours".
 * This answers "what does the song do over time", with one axis per question:
 *
 *   x = scale degree (I … VII)      → a diatonic run climbs the x axis
 *   y = chromatic alteration (b ♮ #) → borrowed / secondary / modal shifts lift
 *   z = time (step index)            → the sequence always steps deeper
 *
 * Boxes rather than hexes on purpose: this is a space to test the concept, and
 * a rectilinear grid keeps the three axes unambiguous. Drag to orbit, wheel or
 * pinch to zoom, shift-drag (or right-drag) to pan; the Reset button returns to
 * the default three-quarter view.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { pitchClass } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordDisplayName, chordsToHoneycombText } from "../../lib/harmony/chordBuilder";
import {
  HUES,
  ROMAN_UP,
  diatonicChordAt,
  parseProgression,
  SCALE_INTERVALS,
  MODE_TO_SCALE_KEY,
} from "../../lib/harmony/honeycombWalk";
import {
  DEFAULT_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  boxFaces,
  clampCamera,
  orbit,
  panBy,
  projectPoint,
  zoomBy,
  type SceneCamera,
  type SceneFace,
  type Vec3,
} from "../../lib/harmony/scene3d";

const DEG_W = 46;
const ACC_H = 32;
const Z_STEP = 34;
const BOX: Vec3 = { x: 26, y: 12, z: 26 };
const FLOOR_Y = -14;

export interface HarmonySceneProps {
  chords: Chord[];
  keyName: NoteName;
  scale: ScaleType;
  selectedChordId?: string | null;
  onSelectChord?: (chordId: string) => void;
  height?: number;
}

interface Node {
  chord: Chord;
  step: number;
  degree: number;
  accidental: number;
  center: Vec3;
}

function shadeHex(hex: string, shade: number): string {
  const value = parseInt(hex.replace("#", ""), 16);
  const factor = Math.max(0.2, Math.min(1, shade));
  const r = Math.round(((value >> 16) & 255) * factor);
  const g = Math.round(((value >> 8) & 255) * factor);
  const b = Math.round((value & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function HarmonyScene({
  chords,
  keyName,
  scale,
  selectedChordId,
  onSelectChord,
  height = 420,
}: HarmonySceneProps) {
  const [camera, setCamera] = useState<SceneCamera>(DEFAULT_CAMERA);
  const [width, setWidth] = useState(720);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    mode: "orbit" | "pan";
    chordId: string | null;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 720));
    setWidth(el.clientWidth || 720);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scaleKey = MODE_TO_SCALE_KEY[scale as keyof typeof MODE_TO_SCALE_KEY] ?? "major";
  const intervals = SCALE_INTERVALS[scaleKey];

  const nodes = useMemo<Node[]>(() => {
    const { steps } = parseProgression(chordsToHoneycombText(chords));
    return chords.map((chord, index) => {
      const step = steps[index];
      const degree = step?.deg ?? 0;
      const accidental = step?.acc ?? 0;
      return {
        chord,
        step: index,
        degree,
        accidental,
        center: { x: degree * DEG_W, y: accidental * ACC_H, z: index * Z_STEP },
      };
    });
  }, [chords]);

  // Auto-fit once per content/viewport change (never while orbiting, which
  // would rescale the scene under the pointer), then keep the content centred
  // on its own centroid at whatever tilt the user has chosen.
  const fitZoom = useMemo(() => {
    if (nodes.length === 0) return 1;
    const flat = { ...DEFAULT_CAMERA, zoom: 1, panX: 0, panY: 0 };
    const points = nodes.map((node) => projectPoint(node.center, flat, { x: 0, y: 0 }));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const spanX = Math.max(180, Math.max(...xs) - Math.min(...xs) + BOX.x * 2);
    const spanY = Math.max(150, Math.max(...ys) - Math.min(...ys) + BOX.y + BOX.z * 2);
    return Math.max(0.45, Math.min(2.4, Math.min((width - 120) / spanX, (height - 120) / spanY)));
  }, [nodes, width, height]);

  const effectiveZoom = camera.zoom * fitZoom;
  const centroid = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, z: 0 };
    const sum = nodes.reduce(
      (acc, node) => ({ x: acc.x + node.center.x, y: acc.y + node.center.y, z: acc.z + node.center.z }),
      { x: 0, y: 0, z: 0 },
    );
    return { x: sum.x / nodes.length, y: sum.y / nodes.length, z: sum.z / nodes.length };
  }, [nodes]);

  const renderCamera = { ...camera, zoom: effectiveZoom, panX: 0, panY: 0 };
  const centre = projectPoint(centroid, renderCamera, { x: 0, y: 0 });
  const origin = {
    x: width / 2 - centre.x + camera.panX,
    y: height / 2 - centre.y + camera.panY,
  };

  const projected = useMemo(() => {
    const faces: (SceneFace & { node: Node })[] = [];
    for (const node of nodes) {
      for (const face of boxFaces(node.center, BOX, renderCamera, origin)) {
        faces.push({ ...face, node });
      }
    }
    faces.sort((left, right) => left.depth - right.depth);
    return faces;
  }, [nodes, renderCamera, origin.x, origin.y]);

  const path = useMemo(
    () =>
      nodes
        .map((node) => projectPoint(node.center, renderCamera, origin))
        .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
        .join(" "),
    [nodes, renderCamera, origin.x, origin.y],
  );

  const grid = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; strong: boolean }[] = [];
    const lastStep = Math.max(1, nodes.length - 1);
    for (let degree = 0; degree < 7; degree += 1) {
      const a = projectPoint({ x: degree * DEG_W, y: FLOOR_Y, z: 0 }, renderCamera, origin);
      const b = projectPoint({ x: degree * DEG_W, y: FLOOR_Y, z: lastStep * Z_STEP }, renderCamera, origin);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, strong: degree === 0 });
    }
    for (let step = 0; step <= lastStep; step += 1) {
      const a = projectPoint({ x: 0, y: FLOOR_Y, z: step * Z_STEP }, renderCamera, origin);
      const b = projectPoint({ x: 6 * DEG_W, y: FLOOR_Y, z: step * Z_STEP }, renderCamera, origin);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, strong: step === 0 });
    }
    return lines;
  }, [nodes.length, renderCamera, origin.x, origin.y]);

  const degreeTicks = useMemo(
    () =>
      Array.from({ length: 7 }, (_, degree) => {
        const point = projectPoint({ x: degree * DEG_W, y: FLOOR_Y, z: 0 }, renderCamera, origin);
        const diatonic = diatonicChordAt(intervals, degree);
        return {
          degree,
          x: point.x,
          y: point.y + 12,
          label: diatonic.triad.minor ? ROMAN_UP[degree].toLowerCase() : ROMAN_UP[degree],
        };
      }),
    [renderCamera, origin.x, origin.y, intervals],
  );

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const pan = event.shiftKey || event.button === 1 || event.button === 2;
    // Pointer capture retargets the whole gesture to the SVG, so a plain click
    // never reaches the box's own handler — remember what was hit instead and
    // resolve the tap on pointer-up.
    const target = event.target as Element | null;
    const chordId = target?.closest?.("[data-chord-id]")?.getAttribute("data-chord-id") ?? null;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      mode: pan ? "pan" : "orbit",
      chordId,
      moved: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety */
    }
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setCamera((current) => (drag.mode === "pan" ? panBy(current, dx, dy) : orbit(current, dx, dy)));
  }

  function handlePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved && drag.chordId) onSelectChord?.(drag.chordId);
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    setCamera((current) => zoomBy(current, event.deltaY > 0 ? 0.92 : 1.08));
  }

  const selectedNode = nodes.find((node) => node.chord.id === selectedChordId);

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      <div className="absolute left-1 top-1 z-10 flex items-center gap-1">
        <button
          type="button"
          className="rounded border border-edge/70 bg-[#0E1116]/80 px-1.5 text-[11px] leading-4 text-inkMuted hover:text-ink"
          onClick={() => setCamera((current) => zoomBy(current, 1.15))}
          disabled={camera.zoom >= MAX_ZOOM}
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="rounded border border-edge/70 bg-[#0E1116]/80 px-1.5 text-[11px] leading-4 text-inkMuted hover:text-ink"
          onClick={() => setCamera((current) => zoomBy(current, 0.87))}
          disabled={camera.zoom <= MIN_ZOOM}
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="rounded border border-edge/70 bg-[#0E1116]/80 px-1.5 text-[10px] leading-4 text-inkMuted hover:text-ink"
          onClick={() => setCamera(DEFAULT_CAMERA)}
          title="Reset the view (drag orbits · shift-drag pans · wheel zooms)"
        >
          Reset
        </button>
      </div>

      <svg
        width={width}
        height={height}
        className="block touch-none"
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <rect x={0} y={0} width={width} height={height} fill="#0b0e13" />

        {/* Floor grid: degrees across, steps deep. */}
        {grid.map((line, index) => (
          <line
            key={`grid-${index}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#ffffff"
            strokeOpacity={line.strong ? 0.16 : 0.07}
            strokeWidth={1}
          />
        ))}

        {/* The progression's path — drawn first so the boxes occlude it. */}
        {path && (
          <path
            d={path}
            fill="none"
            stroke="#F5E7C8"
            strokeOpacity={0.35}
            strokeWidth={2}
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          />
        )}

        {/* Chord boxes, painter's order, lit by how square-on each face is. */}
        {projected.map((face, index) => {
          const hue = HUES[face.node.degree] ?? HUES[0];
          return (
            <polygon
              key={`face-${face.node.step}-${index}`}
              points={face.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
              fill={shadeHex(hue.fill, face.shade)}
              stroke={shadeHex(hue.rim, face.shade)}
              strokeWidth={0.6}
              strokeOpacity={0.5}
              data-chord-id={face.node.chord.id}
              style={{ cursor: "pointer" }}
            />
          );
        })}

        {/* Labels: billboarded so they stay readable at any tilt. */}
        {nodes.map((node) => {
          const point = projectPoint(node.center, renderCamera, origin);
          const hue = HUES[node.degree] ?? HUES[0];
          const name = chordDisplayName(pitchClass(node.chord.root), node.chord.quality, keyName);
          return (
            <g key={`label-${node.step}`} style={{ pointerEvents: "none" }}>
              <text
                x={point.x}
                y={point.y - 7}
                textAnchor="middle"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize={10}
                fontWeight={600}
                fill="#F5E7C8"
                stroke="#0b0e13"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {node.chord.romanNumeral}
              </text>
              <text
                x={point.x}
                y={point.y + 4}
                textAnchor="middle"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize={7.5}
                fill={hue.rim}
                stroke="#0b0e13"
                strokeWidth={2.5}
                paintOrder="stroke"
              >
                {name}
              </text>
            </g>
          );
        })}

        {selectedNode && (
          <circle
            cx={projectPoint(selectedNode.center, renderCamera, origin).x}
            cy={projectPoint(selectedNode.center, renderCamera, origin).y}
            r={20}
            fill="none"
            stroke="#E8B54A"
            strokeWidth={1.6}
            strokeDasharray="3 3"
            style={{ pointerEvents: "none" }}
          />
        )}

        {/* Axes: degree labels along the near edge, step numbers down the side. */}
        {degreeTicks.map((tick) => (
          <text
            key={`tick-${tick.degree}`}
            x={tick.x}
            y={tick.y}
            textAnchor="middle"
            fontFamily="'IBM Plex Mono', monospace"
            fontSize={9}
            fill="#7A8290"
          >
            {tick.label}
          </text>
        ))}
        {nodes.map((node) => {
          const point = projectPoint({ x: -30, y: FLOOR_Y, z: node.step * Z_STEP }, renderCamera, origin);
          return (
            <text
              key={`step-${node.step}`}
              x={point.x}
              y={point.y + 3}
              textAnchor="end"
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={7}
              fill="#5C646F"
            >
              {node.step + 1}
            </text>
          );
        })}
      </svg>

      {chords.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-2xs font-mono italic text-inkMuted/60 pointer-events-none">
          No chords yet — add a progression to walk it in 3D.
        </p>
      )}
    </div>
  );
}
