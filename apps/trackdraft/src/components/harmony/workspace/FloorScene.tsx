import { MODE_DATA, SCALE_INTERVALS, type ScaleType } from "@music-theory/core";
import type { HarmonyAnalysis } from "../../../lib/harmony/analysis";
import type { DetectedSection } from "../../../lib/harmony/segmentSections";
import type { SceneFace, Vec3 } from "../../../lib/harmony/scene3d";
import type { Palette } from "../../../theme/palette";
import { BEAT_Z, BOX_X, LADDER_STEPS, RULER_H, STEP_W, TENSION_H, type FloorFit } from "./useFloorFit";
import type { Node } from "./floorTypes";

export interface FloorSceneProps {
  svgRef: React.RefObject<SVGSVGElement>;
  width: number;
  height: number;
  fit: FloorFit;
  palette: Palette;
  project: (point: Vec3) => { x: number; y: number };
  zOf: (beat: number) => number;
  beatsPerBar: number;
  windowStart: number;
  windowFirstBar: number;
  /** Bars the author has swept on the ruler, as absolute bar indices. */
  barRange: { from: number; to: number } | null;
  onBarPointerDown: (bar: number, event: React.PointerEvent) => void;
  scale: ScaleType;
  rests: readonly { start: number; beats: number }[];
  segments?: readonly DetectedSection[] | null;
  cycleBeats: number;
  density: { rowPx: number; barPx: number };
  rulerStep: number;
  /** The line joining the chord centres, already formatted as an SVG polyline. */
  path: string;
  faces: { face: SceneFace; node: Node; isPreview: boolean }[];
  visibleNodes: Node[];
  selectedChordId: string | null;
  activeChordId: string | null;
  analysis: HarmonyAnalysis;
  onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: () => void;
  onContextMenu: (event: React.MouseEvent<SVGSVGElement>) => void;
  onWheel: (event: React.WheelEvent<SVGSVGElement>) => void;
}

/**
 * The plate itself: grid, bar ruler, rests, chord boxes and their handles.
 * Pure projection — every gesture is owned by the floor, which needs the same
 * camera and origin the drawing used.
 */
export default function FloorScene({
  svgRef,
  width,
  height,
  fit,
  palette: P,
  project,
  zOf,
  beatsPerBar,
  windowStart,
  windowFirstBar,
  barRange,
  onBarPointerDown,
  scale,
  rests,
  segments,
  cycleBeats,
  density,
  rulerStep,
  path,
  faces,
  visibleNodes,
  selectedChordId,
  activeChordId,
  analysis,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onContextMenu,
  onWheel,
}: FloorSceneProps) {
  const scaleSteps = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;
  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="block touch-none select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
    >
      {/* bar ruler — a fixed strip, not part of the projection */}
      <g>
        <rect x={0} y={0} width={width} height={RULER_H} fill={P.deep} />
        <line
          x1={0} y1={RULER_H} x2={width} y2={RULER_H}
          stroke={P.handDrawn ? P.grid : "#fff"}
          strokeOpacity={P.handDrawn ? 0.3 : 0.07}
          strokeWidth={1}
        />
        {Array.from({ length: fit.gridBars + 1 }, (_, index) => {
          const point = project({ x: 0, y: 0, z: index * beatsPerBar * BEAT_Z });
          const next = project({ x: 0, y: 0, z: (index + 1) * beatsPerBar * BEAT_Z });
          const barNumber = windowFirstBar + index + 1;
          const swept =
            barRange !== null && barNumber - 1 >= barRange.from && barNumber - 1 <= barRange.to;
          return (
            <g key={`ruler-${index}`}>
              {index < fit.gridBars && (
                <rect
                  x={point.x}
                  y={0}
                  width={Math.max(0, next.x - point.x)}
                  height={RULER_H}
                  data-ruler-bar={barNumber - 1}
                  fill={swept ? P.track : "transparent"}
                  fillOpacity={swept ? 0.35 : 0}
                  style={{ cursor: "col-resize" }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onBarPointerDown(barNumber - 1, event);
                  }}
                >
                  <title>{`Bar ${barNumber} — drag across bars to select them`}</title>
                </rect>
              )}
              {index <= fit.gridBars && (
                <line
                  x1={point.x}
                  y1={RULER_H - 5}
                  x2={point.x}
                  y2={RULER_H}
                  stroke={P.label}
                  strokeOpacity={index === 0 ? 0.6 : 0.28}
                />
              )}
              {index % rulerStep === 0 && (
                <text
                  x={point.x + 5}
                  y={13}
                  fontSize={9.5}
                  fontFamily="'IBM Plex Mono', monospace"
                  fill={P.label}
                  fillOpacity={0.72}
                  pointerEvents="none"
                >
                  {barNumber}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Proposed section boundaries, while the form drawer is open: the
          split is decided by looking at it, so it has to be on the floor. */}
      {segments?.map((segment) => {
        if (segment.startBeat < 0.001) return null;
        const top = project({ x: (LADDER_STEPS - 1) * STEP_W, y: 0, z: segment.startBeat * BEAT_Z });
        const foot = project({ x: 0, y: 0, z: segment.startBeat * BEAT_Z });
        return (
          <g key={`split-${segment.startBeat}`} pointerEvents="none">
            <line x1={top.x} y1={top.y} x2={foot.x} y2={foot.y} stroke={P.track} strokeOpacity={0.85} strokeDasharray="3 3" />
            <text
              x={foot.x + 4}
              y={height - TENSION_H - 8}
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={10}
              fontWeight={600}
              fill={P.track}
            >
              {segment.repeats > 1 ? `${segment.label} ×${segment.repeats}` : segment.label}
            </text>
          </g>
        );
      })}

      {/* Where the written section stops and the drop room starts. */}
      {fit.gridBars * beatsPerBar > cycleBeats + 0.01 && (() => {
        const end = project({ x: 0, y: 0, z: cycleBeats * BEAT_Z });
        const foot = project({ x: (LADDER_STEPS - 1) * STEP_W, y: 0, z: cycleBeats * BEAT_Z });
        return (
          <line
            x1={end.x} y1={end.y} x2={foot.x} y2={foot.y}
            stroke={P.label} strokeOpacity={0.4} strokeDasharray="4 4" pointerEvents="none"
          />
        );
      })()}

      {Array.from({ length: LADDER_STEPS }, (_, step) => {
        const a = project({ x: step * STEP_W, y: 0, z: 0 });
        const b = project({ x: step * STEP_W, y: 0, z: fit.gridBars * beatsPerBar * BEAT_Z });
        // The seven scale steps are the destinations: same rule the boxes sit
        // on, brighter. The five between them are reachable but quiet.
        const diatonic = scaleSteps.includes(step);
        const tonic = step === 0;
        return (
          <line
            key={`step-${step}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={tonic ? P.track : P.grid}
            strokeOpacity={tonic ? 0.7 : diatonic ? 0.5 : 0.07}
            strokeWidth={tonic ? 1.8 : diatonic ? 1.3 : 0.6}
            strokeDasharray={diatonic ? undefined : "1 5"}
          />
        );
      })}

      {Array.from({ length: Math.round(fit.gridBars * beatsPerBar) + 1 }, (_, index) => {
        const beat = windowStart + index;
        const a = project({ x: 0, y: 0, z: index * BEAT_Z });
        const b = project({ x: (LADDER_STEPS - 1) * STEP_W, y: 0, z: index * BEAT_Z });
        const isBar = Math.abs(beat % beatsPerBar) < 1e-6;
        return (
          <line
            key={`beat-${beat}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={P.grid}
            strokeOpacity={isBar ? 0.45 : 0.14}
            strokeWidth={isBar ? 1.2 : 0.8}
            strokeDasharray={isBar ? "3 3" : undefined}
          />
        );
      })}

      {rests.map((rest) => {
        const z0 = zOf(rest.start);
        const z1 = zOf(rest.start + rest.beats);
        const corners = [
          project({ x: -BOX_X / 2, y: 0, z: z0 }),
          project({ x: (LADDER_STEPS - 1) * STEP_W + BOX_X / 2, y: 0, z: z0 }),
          project({ x: (LADDER_STEPS - 1) * STEP_W + BOX_X / 2, y: 0, z: z1 }),
          project({ x: -BOX_X / 2, y: 0, z: z1 }),
        ];
        const mid = project({ x: 5.5 * STEP_W, y: 0, z: zOf(rest.start + rest.beats / 2) });
        return (
          <g key={`rest-${rest.start}`} data-rest={rest.start} style={{ cursor: "cell" }}>
            <polygon
              points={corners.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
              fill={P.well}
              fillOpacity={0.4}
              stroke={P.grid}
              strokeOpacity={0.4}
              strokeDasharray="2 4"
            />
            <text
              x={mid.x} y={mid.y} textAnchor="middle"
              fontFamily="'IBM Plex Mono', monospace" fontSize={8} fill={P.label} opacity={0.5}
            >
              {`rest ${rest.beats}b`}
            </text>
          </g>
        );
      })}

      {scaleSteps.map((step, degree) => {
        const point = project({ x: step * STEP_W, y: 0, z: -18 });
        if (density.rowPx < 4) return null;
        const degrees = MODE_DATA[scale]?.degrees ?? [];
        return (
          <text
            key={`step-label-${step}`}
            x={point.x} y={point.y} textAnchor="middle"
            fontFamily="'IBM Plex Mono', monospace" fontSize={9} fill={P.label} opacity={0.8}
          >
            {degrees[degree] ?? "I"}
          </text>
        );
      })}

      <polyline points={path} fill="none" stroke={P.cream} strokeWidth={1.6} strokeOpacity={0.35} />

      {faces.map(({ face, node, isPreview }, index) => {
        const hue = P.hues[node.degree] ?? P.hues[0];
        const selected = node.chord.id === selectedChordId;
        const playing = node.chord.id === activeChordId;
        const fill = isPreview ? "#ffffff" : hue.fill;
        return (
          <polygon
            key={`${node.chord.id}-${face.kind}-${index}`}
            points={face.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}
            fill={fill}
            fillOpacity={isPreview ? 0.28 : 0.55 + 0.45 * face.shade}
            stroke={isPreview ? P.select : playing ? P.select : selected ? P.track : hue.rim}
            strokeWidth={selected || playing ? 2 : 1}
            strokeDasharray={isPreview ? "4 3" : undefined}
            style={{ cursor: "grab" }}
            data-chord-id={isPreview ? undefined : node.chord.id}
            data-face={face.kind}
          >
            <title>
              {analysis.events[node.index]?.roman} · {node.beats} beats · {face.kind}
            </title>
          </polygon>
        );
      })}

      {visibleNodes.map((node) => {
        if (node.chord.id !== selectedChordId) return null;
        const top = node.center.y + node.size.y / 2;
        const at = zOf(node.start);
        const end = zOf(node.start + node.beats);
        const startA = project({ x: node.center.x - BOX_X / 2, y: top, z: at });
        const startB = project({ x: node.center.x + BOX_X / 2, y: top, z: at });
        const endA = project({ x: node.center.x - BOX_X / 2, y: top, z: end });
        const endB = project({ x: node.center.x + BOX_X / 2, y: top, z: end });
        return (
          <g key={`handles-${node.chord.id}`}>
            <g data-trim={node.chord.id} style={{ cursor: "ew-resize" }}>
              <line x1={startA.x} y1={startA.y} x2={startB.x} y2={startB.y} stroke={P.track} strokeWidth={9} strokeOpacity={0.001} />
              <line x1={startA.x} y1={startA.y} x2={startB.x} y2={startB.y} stroke={P.track} strokeWidth={2} strokeDasharray="2 2" />
              <circle cx={startA.x} cy={startA.y} r={7} fill="transparent" />
              <circle cx={startA.x} cy={startA.y} r={2.8} fill="none" stroke={P.track} strokeWidth={1.4} />
            </g>
            <g data-resize={node.chord.id} style={{ cursor: "ew-resize" }}>
              <line x1={endA.x} y1={endA.y} x2={endB.x} y2={endB.y} stroke={P.track} strokeWidth={9} strokeOpacity={0.001} />
              <line x1={endA.x} y1={endA.y} x2={endB.x} y2={endB.y} stroke={P.track} strokeWidth={3} strokeLinecap="round" />
              <circle cx={endB.x} cy={endB.y} r={3.4} fill={P.track} />
            </g>
          </g>
        );
      })}

      {density.rowPx >= 15 && visibleNodes.map((node) => {
        const top = project({ x: node.center.x, y: node.center.y + node.size.y / 2 + 0.1, z: node.center.z });
        const event = analysis.events[node.index];
        return (
          <g key={`label-${node.chord.id}`} style={{ pointerEvents: "none" }}>
            <text x={top.x} y={top.y - 10} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize={11} fontWeight={600} fill={P.cream}>
              {event?.roman}
            </text>
            <text x={top.x} y={top.y} textAnchor="middle" fontFamily="'Reenie Beanie', cursive" fontSize={13} fill={P.cream} opacity={0.85}>
              {event?.absoluteName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
