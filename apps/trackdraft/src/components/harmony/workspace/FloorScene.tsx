import { useMemo } from "react";
import { MODE_DATA, SCALE_INTERVALS, type ScaleType } from "@music-theory/core";
import type { HarmonyAnalysis } from "../../../lib/harmony/analysis";
import type { DetectedSection } from "../../../lib/harmony/segmentSections";
import type { SceneFace, Vec3 } from "../../../lib/harmony/scene3d";
import type { Palette } from "../../../theme/palette";
import { tensionHeat } from "../../../lib/harmony/tensionHeat";
import {
  BEAT_Z,
  BOX_X,
  FOOT_H,
  LADDER_STEPS,
  RULER_H,
  STEP_W,
  VOICE_Y,
  BASS_DY,
  type FloorFit,
} from "./useFloorFit";
import type { Node } from "./floorTypes";
import type { VoiceMark } from "../../../lib/harmony/voiceLayers";

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
  /** The generated bass and colour voices, when the Voices tab is open in the
   *  front view. Null everywhere else — these are an overlay, not scenery. */
  voices?: { bass: readonly VoiceMark[]; color: readonly VoiceMark[] } | null;
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
  voices,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onContextMenu,
  onWheel,
}: FloorSceneProps) {
  const scaleSteps = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS.ionian;

  /**
   * Where a chord's name goes: the centre of its LARGEST visible face.
   *
   * Not its "front" face. In this camera a box is read off one side panel while
   * the front panel is edge-on — a single vertical line — so anchoring the
   * caption to the front pinned the name to the far edge of its own box. The
   * widest face is, by construction, the one with room to write on.
   */
  const captionAnchors = useMemo(() => {
    const anchors = new Map<
      string,
      { area: number; depth: number; x: number; y: number; top: number }
    >();
    for (const { face, node, isPreview } of faces) {
      // A box's underside matches its lid in area and is drawn first, so an
      // area-only contest would write the caption on the one face you can never
      // read from a camera above the floor.
      if (isPreview || face.kind === "bottom") continue;
      const points = face.points;
      const area = Math.abs(
        points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length];
          return sum + point.x * next.y - next.x * point.y;
        }, 0) / 2,
      );
      const key = `${node.chord.id}-${node.start}`;
      const seen = anchors.get(key);
      // Largest readable face wins; on a tie the one nearest the camera, which
      // is the one drawn last and the one the eye lands on.
      if (
        seen &&
        (seen.area > area + 1 ||
          (seen.area > area - 1 && seen.depth >= face.depth))
      )
        continue;
      anchors.set(key, {
        area,
        depth: face.depth,
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        top: Math.min(...points.map((point) => point.y)),
      });
    }
    return anchors;
  }, [faces]);
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
          x1={0}
          y1={RULER_H}
          x2={width}
          y2={RULER_H}
          stroke={P.handDrawn ? P.grid : "#fff"}
          strokeOpacity={P.handDrawn ? 0.3 : 0.07}
          strokeWidth={1}
        />
        {Array.from({ length: fit.gridBars + 1 }, (_, index) => {
          const point = project({
            x: 0,
            y: 0,
            z: index * beatsPerBar * BEAT_Z,
          });
          const next = project({
            x: 0,
            y: 0,
            z: (index + 1) * beatsPerBar * BEAT_Z,
          });
          const barNumber = windowFirstBar + index + 1;
          const swept =
            barRange !== null &&
            barNumber - 1 >= barRange.from &&
            barNumber - 1 <= barRange.to;
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
        const top = project({
          x: (LADDER_STEPS - 1) * STEP_W,
          y: 0,
          z: segment.startBeat * BEAT_Z,
        });
        const foot = project({ x: 0, y: 0, z: segment.startBeat * BEAT_Z });
        return (
          <g key={`split-${segment.startBeat}`} pointerEvents="none">
            <line
              x1={top.x}
              y1={top.y}
              x2={foot.x}
              y2={foot.y}
              stroke={P.track}
              strokeOpacity={0.85}
              strokeDasharray="3 3"
            />
            <text
              x={foot.x + 4}
              y={height - FOOT_H - 8}
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={10}
              fontWeight={600}
              fill={P.track}
            >
              {segment.repeats > 1
                ? `${segment.label} ×${segment.repeats}`
                : segment.label}
            </text>
          </g>
        );
      })}

      {/* Where the written section stops and the drop room starts. */}
      {fit.gridBars * beatsPerBar > cycleBeats + 0.01 &&
        (() => {
          const end = project({ x: 0, y: 0, z: cycleBeats * BEAT_Z });
          const foot = project({
            x: (LADDER_STEPS - 1) * STEP_W,
            y: 0,
            z: cycleBeats * BEAT_Z,
          });
          return (
            <line
              x1={end.x}
              y1={end.y}
              x2={foot.x}
              y2={foot.y}
              stroke={P.label}
              strokeOpacity={0.4}
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          );
        })()}

      {Array.from({ length: LADDER_STEPS }, (_, step) => {
        const a = project({ x: step * STEP_W, y: 0, z: 0 });
        const b = project({
          x: step * STEP_W,
          y: 0,
          z: fit.gridBars * beatsPerBar * BEAT_Z,
        });
        // The seven scale steps are the destinations: same rule the boxes sit
        // on, brighter. The five between them are reachable but quiet.
        const diatonic = scaleSteps.includes(step);
        const tonic = step === 0;
        return (
          <line
            key={`step-${step}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={tonic ? P.track : P.grid}
            strokeOpacity={tonic ? 0.7 : diatonic ? 0.5 : 0.07}
            strokeWidth={tonic ? 1.8 : diatonic ? 1.3 : 0.6}
            strokeDasharray={diatonic ? undefined : "1 5"}
          />
        );
      })}

      {Array.from(
        { length: Math.round(fit.gridBars * beatsPerBar) + 1 },
        (_, index) => {
          const beat = windowStart + index;
          const a = project({ x: 0, y: 0, z: index * BEAT_Z });
          const b = project({
            x: (LADDER_STEPS - 1) * STEP_W,
            y: 0,
            z: index * BEAT_Z,
          });
          const isBar = Math.abs(beat % beatsPerBar) < 1e-6;
          return (
            <line
              key={`beat-${beat}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={P.grid}
              strokeOpacity={isBar ? 0.45 : 0.14}
              strokeWidth={isBar ? 1.2 : 0.8}
              strokeDasharray={isBar ? "3 3" : undefined}
            />
          );
        },
      )}

      {rests.map((rest) => {
        const z0 = zOf(rest.start);
        const z1 = zOf(rest.start + rest.beats);
        const corners = [
          project({ x: -BOX_X / 2, y: 0, z: z0 }),
          project({ x: (LADDER_STEPS - 1) * STEP_W + BOX_X / 2, y: 0, z: z0 }),
          project({ x: (LADDER_STEPS - 1) * STEP_W + BOX_X / 2, y: 0, z: z1 }),
          project({ x: -BOX_X / 2, y: 0, z: z1 }),
        ];
        const mid = project({
          x: 5.5 * STEP_W,
          y: 0,
          z: zOf(rest.start + rest.beats / 2),
        });
        return (
          <g
            key={`rest-${rest.start}`}
            data-rest={rest.start}
            style={{ cursor: "cell" }}
          >
            <polygon
              points={corners
                .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                .join(" ")}
              fill={P.well}
              fillOpacity={0.4}
              stroke={P.grid}
              strokeOpacity={0.4}
              strokeDasharray="2 4"
            />
            <text
              x={mid.x}
              y={mid.y}
              textAnchor="middle"
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={8}
              fill={P.label}
              opacity={0.5}
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
            x={point.x}
            y={point.y}
            textAnchor="middle"
            fontFamily="'IBM Plex Mono', monospace"
            fontSize={9}
            fill={P.label}
            opacity={0.8}
          >
            {degrees[degree] ?? "I"}
          </text>
        );
      })}

      <polyline
        points={path}
        fill="none"
        stroke={P.cream}
        strokeWidth={1.6}
        strokeOpacity={0.35}
      />

      {/* THE CHORDS — one 3D box per face, coloured by scale degree, with the
          tension of the chord glowing over its hue. */}
      {faces.map(({ face, node, isPreview }, index) => {
        const hue = P.hues[node.degree] ?? P.hues[0];
        const selected = node.chord.id === selectedChordId;
        const playing = node.chord.id === activeChordId;
        const fill = isPreview ? "#ffffff" : hue.fill;
        // TENSION, drawn on the box itself. 0.5 is a plain diatonic chord and
        // reads as nothing; a chord that adds dissonance glows warmer. This is
        // what replaced the tension strip in the floor's foot — that strip was
        // a flat 0.50 line for 86% of a real song's chords, so it spent 46px
        // saying "nothing happening" while the 14% that mattered was one pixel
        // of movement.
        const tension = analysis.events[node.index]?.tension ?? 0.5;
        const heat = tensionHeat(tension);
        // A later pass is the SAME chord played again — the progression loops to
        // fill the section — so it is drawn as an echo: same hue, dashed rim.
        // Editing it edits that one chord, in both places.
        const echo = (node.pass ?? 0) > 0;
        const points = face.points
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" ");
        return (
          <g key={`${node.chord.id}-${face.kind}-${index}`}>
            <polygon
              points={points}
              fill={fill}
              fillOpacity={
                isPreview
                  ? 0.28
                  : (0.55 + 0.45 * face.shade) * (echo ? 0.62 : 1)
              }
              stroke={
                isPreview
                  ? P.select
                  : playing
                    ? P.select
                    : selected
                      ? P.track
                      : hue.rim
              }
              strokeWidth={selected || playing ? 2 : 1}
              strokeDasharray={isPreview ? "4 3" : echo ? "3 2" : undefined}
              style={{ cursor: "grab" }}
              data-chord-id={isPreview ? undefined : node.chord.id}
              data-face={face.kind}
              data-tension={tension.toFixed(2)}
            >
              <title>
                {analysis.events[node.index]?.roman} · {node.beats} beats ·{" "}
                {face.kind} · tension {tension.toFixed(2)}
                {node.chord.performance
                  ? ` · ${node.chord.performance.style}`
                  : ""}
                {echo ? ` · loop pass ${(node.pass ?? 0) + 1}` : ""}
              </title>
            </polygon>
            {!isPreview && heat > 0.02 && (
              <polygon
                points={points}
                fill={P.track}
                fillOpacity={0.55 * heat}
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}

      {/* The generated voices, drawn where they actually play.
          Bass = thin bars, one per note (the line moves: fifth, approach tone),
          on the same twelve-row pitch axis the chords use. Colour = one ring
          per chord at the root of the bi-tonal chord it generates, with a
          dotted tail because it sustains for the whole chord rather than
          firing once. Both are annotations over the plate — drawn after the
          boxes so the bars stay legible — and never take a pointer event away
          from a chord. */}
      {voices && (
        <g pointerEvents="none" data-voices="1">
          {/* BASS — a rounded bar per generated note, with the note written on
              it. One bar per note rather than per chord: the line moves for
              Root+5th and Walking, and that movement is the whole reason the
              lane exists. The label is only drawn when the bar is long enough
              to hold it (8th-note rhythms give four short bars per chord). */}
          {voices.bass.map((mark, index) => {
            const a = project({
              x: mark.step * STEP_W,
              y: VOICE_Y,
              z: zOf(mark.start),
            });
            const b = project({
              x: mark.step * STEP_W,
              y: VOICE_Y,
              z: zOf(mark.start + mark.duration),
            });
            // A bass note is usually the chord root, so its bar wants the same
            // row the chord box is drawn on — and would then strike through the
            // box's caption. BASS_DY drops the bar just clear of the box, into
            // the gap before the next row, where it still reads as that row.
            a.y += BASS_DY;
            b.y += BASS_DY;
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            return (
              <g key={`bass-${index}`} data-voice="bass">
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={P.cream}
                  strokeWidth={7}
                  strokeOpacity={0.32}
                  strokeLinecap="round"
                >
                  <title>{`bass ${mark.label}`}</title>
                </line>
                {length >= 22 && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 6}
                    textAnchor="middle"
                    fontFamily={P.labelFont}
                    fontSize={8}
                    fill={P.cream}
                    fillOpacity={0.85}
                  >
                    {mark.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* COLOUR — exactly one chip per chord, sitting on the row of the
              bi-tonal chord's own root and naming it. A circle because the
              colour chord is a single object, like a chord symbol; it is
              centred on the chord's span so it reads as belonging to that
              chord rather than firing at its start.

              The chip lands on the COLOUR root's row, which for a shifted
              recipe is a different row from the chord — the vertical gap is
              the shift. It shares its chord's column, so the pairing is by
              time, and the tooltip names the chord it belongs to. */}
          {voices.color.map((mark, index) => {
            const mid = zOf(mark.start + mark.duration / 2);
            const at = project({ x: mark.step * STEP_W, y: VOICE_Y, z: mid });
            // A chip carries the chord symbol it adds (C, Cm, Db). Where the
            // flavour adds nothing, the chord is already written on the box, so
            // repeating its root would just say "Bb" twice — that case is a
            // small hollow ring instead: "no colour here".
            const full = mark.name ?? mark.label;
            const shown = mark.plain ? "" : full.length > 7 ? mark.label : full;
            return (
              <g key={`color-${index}`} data-voice="color">
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={mark.plain ? 6 : 13}
                  fill={P.well}
                  fillOpacity={mark.plain ? 0.5 : 0.92}
                  stroke={P.cream}
                  strokeWidth={1.6}
                  strokeOpacity={mark.plain ? 0.4 : 0.9}
                  strokeDasharray={mark.plain ? "3 2" : undefined}
                >
                  <title>
                    {mark.plain
                      ? `colour ${mark.name} — no shift on this chord, so it adds no note`
                      : `colour ${mark.name} — the "${mark.label}" colour texture`}
                  </title>
                </circle>
                {shown !== "" && (
                  <text
                    x={at.x}
                    y={at.y + 3}
                    textAnchor="middle"
                    fontFamily={P.labelFont}
                    fontSize={shown.length > 5 ? 7.5 : 8.5}
                    fontWeight={600}
                    fill={P.cream}
                    fillOpacity={mark.plain ? 0.55 : 0.95}
                  >
                    {shown}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}

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
              <line
                x1={startA.x}
                y1={startA.y}
                x2={startB.x}
                y2={startB.y}
                stroke={P.track}
                strokeWidth={9}
                strokeOpacity={0.001}
              />
              <line
                x1={startA.x}
                y1={startA.y}
                x2={startB.x}
                y2={startB.y}
                stroke={P.track}
                strokeWidth={2}
                strokeDasharray="2 2"
              />
              <circle cx={startA.x} cy={startA.y} r={7} fill="transparent" />
              <circle
                cx={startA.x}
                cy={startA.y}
                r={2.8}
                fill="none"
                stroke={P.track}
                strokeWidth={1.4}
              />
            </g>
            <g data-resize={node.chord.id} style={{ cursor: "ew-resize" }}>
              <line
                x1={endA.x}
                y1={endA.y}
                x2={endB.x}
                y2={endB.y}
                stroke={P.track}
                strokeWidth={9}
                strokeOpacity={0.001}
              />
              <line
                x1={endA.x}
                y1={endA.y}
                x2={endB.x}
                y2={endB.y}
                stroke={P.track}
                strokeWidth={3}
                strokeLinecap="round"
              />
              <circle cx={endB.x} cy={endB.y} r={3.4} fill={P.track} />
            </g>
          </g>
        );
      })}

      {density.rowPx >= 15 &&
        visibleNodes.map((node) => {
          const anchor = captionAnchors.get(`${node.chord.id}-${node.start}`);
          if (!anchor) return null;
          const event = analysis.events[node.index];
          const name = event?.absoluteName ?? "";
          const roman = event?.roman ?? "";
          const accidental = /^[♭♯]/.test(roman) ? roman[0] : "";
          const degree = accidental ? roman.slice(1) : roman;
          // The name is the thing read at a glance, so it takes the printed
          // face and as much size as the box holds: "Dm" can sit big, "F#sus4"
          // has to come down or it spills past its own chord.
          const nameSize = name.length <= 2 ? 17 : name.length <= 3 ? 14 : 11.5;
          return (
            <g
              key={`label-${node.chord.id}-${node.start}`}
              style={{ pointerEvents: "none" }}
            >
              <text
                x={anchor.x}
                y={anchor.top - 4}
                textAnchor="middle"
                fontFamily={P.penFont}
                fontSize={16}
                fill={P.cream}
                fillOpacity={0.95}
              >
                {/* The handwriting face has no flat or sharp glyph, so the
                    accidental is set in the printed face — which is what an
                    engraved score does anyway — and only the numeral is hand
                    written. Mixing them inside one font would let the browser
                    pick a silent fallback. */}
                {accidental && (
                  <tspan fontFamily={P.labelFont} fontSize={12}>
                    {accidental}
                  </tspan>
                )}
                {degree}
              </text>
              <text
                x={anchor.x}
                y={anchor.y + nameSize * 0.34}
                textAnchor="middle"
                fontFamily={P.labelFont}
                fontSize={nameSize}
                fontWeight={600}
                fill={P.cream}
              >
                {name}
              </text>
            </g>
          );
        })}
    </svg>
  );
}
