import { memo, useMemo } from "react";
import type { Palette } from "../../../theme/palette";
import type { DrumLane } from "../laneStyle";
import { PARAM_SPECS, type StepParam } from "./stepParams";

/**
 * One surface lane, drawn as PATH STRINGS.
 *
 * The old row emitted a `<g>` per step with up to four `<rect>`s inside —
 * ~550 rect elements per lane, ~3,345 for the song — and re-rendered all of
 * them on every pointer move. A lane's whole step grid is four paths
 * (stub ticks, hit bars, the pencil's second pass, off-grid dots), so six
 * lanes cost ~30 DOM nodes and React has almost nothing to diff.
 *
 * Everything is in BEAT space × `beatToX`, so the row is independent of
 * which section it belongs to and of the zoom mechanism: a bar of 12/8
 * (6 quarter beats) lays out exactly like a bar of 4/4 (4).
 *
 * The row is memoised on the values that change: its own peak map, the
 * geometry numbers and the current drag preview. A KICK edit cannot
 * re-render HAT/CYM/TOM.
 */

export interface LaneRowProps {
  lane: DrumLane & { color: string };
  /** px per quarter-note beat. */
  beatToX: number;
  /** Section-relative beat grid — derived from the METER, not from zoom. */
  stepBeats: number;
  /** Width of one step cell, in px. */
  stepW: number;
  stepCount: number;
  /** Steps in one bar — a bar line gets a stronger stub. */
  stepsPerBar: number;
  top: number;
  rowH: number;
  /** Peak velocity per step index — includes the in-flight drag preview. */
  peak: ReadonlyMap<number, number>;
  offGrid: readonly { beat: number; velocity: number }[];
  /** Authored step parameters, per step — the marks under/over the cells. */
  marks?: StepMarks;
  P: Palette;
}

/**
 * The step parameters this lane's authored notes carry. A cell's HEIGHT is
 * velocity and nothing else, so without these a gate, a ratchet or a flam is
 * invisible the moment you release the drag — the value is in the song and
 * in the export, but nothing on screen says so.
 */
export interface StepMarks {
  /** ratchet count (only entries > 1) */
  ratchet: ReadonlyMap<number, number>;
  flam: ReadonlySet<number>;
  /** gate as a fraction of the step (only entries ≠ 1) */
  gate: ReadonlyMap<number, number>;
  /** The param the lane's STEP chip is on, and its authored value per step. */
  active: StepParam;
  values: ReadonlyMap<number, number>;
  /** Steps whose VOICE is not the lane's primary — label + index in the
   *  lane's family, so a clap inside PERC or an open hat inside HAT reads. */
  voices: ReadonlyMap<number, { label: string; index: number }>;
}

function LaneRowImpl(props: LaneRowProps) {
  const {
    lane, beatToX, stepBeats, stepW, stepCount, stepsPerBar,
    top, rowH, peak, offGrid, marks, P,
  } = props;
  const w = stepW;
  // every step is an OUTLINED CELL (like the one-bar view), and the hit
  // fills it from the bottom — so the grid reads as a grid, not as squares
  // floating in white space.
  const cellTop = top + 5;
  const cellH = rowH - 12;
  const cellBase = cellTop + cellH;
  // Outlined cells are the one-bar look. When the zoom squeezes a step below
  // ~10px the outlines would turn the lane into a barcode, so the grid falls
  // back to printed ticks and the hits alone carry the rhythm.
  const outlined = w >= 9;

  const paths = useMemo(() => {
    let cells = "";
    let barCells = "";
    let fills = "";
    let second = "";
    let dots = "";
    for (let q = 0; q < stepCount; q++) {
      // A step is an INTERVAL, not a point: its cell starts at the step's own
      // beat and runs to the next one. Drawing it centred would straddle the
      // barline and clip the first cell in half — and the fill would appear
      // to start mid-cell. This is purely visual; the timing is unchanged.
      const left = q * stepBeats * beatToX;
      const onBar = stepsPerBar > 0 && q % stepsPerBar === 0;
      if (outlined) {
        const cell = `M${left.toFixed(2)} ${cellTop}h${w.toFixed(2)}v${cellH}h${(-w).toFixed(2)}Z`;
        if (onBar) barCells += cell;
        else cells += cell;
      }
      const v = peak.get(q) ?? 0;
      if (v <= 0) {
        if (!outlined) {
          cells += `M${left.toFixed(2)} ${cellBase - 1}h${w.toFixed(2)}v2h${(-w).toFixed(2)}Z`;
        }
        continue;
      }
      const h = Math.max(2, (Math.min(127, Math.max(1, v)) / 127) * (cellH - 2));
      fills += `M${left.toFixed(2)} ${(cellBase - h).toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h${(-w).toFixed(2)}Z`;
      second += `M${(left - 0.6).toFixed(2)} ${(cellBase - h - 0.8).toFixed(2)}h${(w + 1.2).toFixed(2)}v${(h + 0.8).toFixed(2)}h${(-w - 1.2).toFixed(2)}Z`;
    }
    for (const d of offGrid) {
      const x = d.beat * beatToX;
      dots += `M${(x - 1).toFixed(2)} ${cellBase - 4}h2v2h-2Z`;
    }
    return { cells, barCells, fills, second, dots };
  }, [beatToX, stepBeats, stepCount, stepsPerBar, peak, w, cellTop, cellH, cellBase, offGrid, outlined]);

  /** Parameter marks: corner ticks on cells that carry a ratchet/flam, a
   *  gate rule under the cell, and — when the STEP chip is on something other
   *  than VEL — that parameter's value as a meter (continuous) or pips
   *  (discrete) in the 7px slack under the cell. Default values draw
   *  nothing, so a mark always means "this cell is not plain". */
  const markPaths = useMemo(() => {
    const spec = PARAM_SPECS[marks?.active ?? "vel"];
    const isVel = (marks?.active ?? "vel") === "vel";
    const isVoice = (marks?.active ?? "vel") === "voice";
    const discrete = spec.kind === "discrete";
    const range = Math.max(1e-9, spec.max - spec.min);
    let ticks = "";
    let meter = "";
    let pips = "";
    if (!marks) return { ticks, meter, pips, badges: [] as { x: number; y: number; label: string }[] };
    for (let q = 0; q < stepCount; q++) {
      const left = q * stepBeats * beatToX;
      const r = marks.ratchet.get(q);
      if (r && r > 1) {
        for (let i = 0; i < Math.min(3, r - 1); i++) {
          const x = left + w - 2.4 - i * 2.6;
          ticks += `M${x.toFixed(2)} ${(cellTop + 1.4).toFixed(2)}v3.6`;
        }
      }
      if (marks.flam.has(q)) {
        ticks += `M${(left + 2).toFixed(2)} ${(cellTop + 5.4).toFixed(2)}L${(left + 5.4).toFixed(2)} ${(cellTop + 1.4).toFixed(2)}`;
      }
      const g = marks.gate.get(q);
      if (g !== undefined) {
        ticks += `M${(left + 0.6).toFixed(2)} ${(cellBase + 2.6).toFixed(2)}h${Math.max(1.2, g * (w - 1.2)).toFixed(2)}`;
      }
      const v = marks.values.get(q);
      if (isVel || isVoice || v === undefined) continue;
      if (Math.abs(v - spec.rest) < 1e-9) continue; // a default value draws nothing
      if (discrete) {
        const count = spec.id === "flam" ? (v >= 0.5 ? 1 : 0) : Math.max(0, Math.round(v));
        for (let i = 0; i < count; i++) {
          pips += `M${(left + 1.2 + i * 3).toFixed(2)} ${(cellBase + 1.4).toFixed(2)}h2v2.2h-2Z`;
        }
      } else {
        const frac = Math.max(0, Math.min(1, (v - spec.min) / range));
        const bw = Math.max(0.9, frac * w);
        meter += `M${left.toFixed(2)} ${(cellBase + 1.4).toFixed(2)}h${bw.toFixed(2)}v2.4h${(-bw).toFixed(2)}Z`;
      }
    }
    const badges: { x: number; y: number; label: string }[] = [];
    for (const [q, v] of marks.voices) {
      if (q < 0 || q >= stepCount) continue;
      badges.push({
        x: q * stepBeats * beatToX + 2,
        y: cellBase - 2.5,
        label: v.label,
      });
    }
    return { ticks, meter, pips, badges };
  }, [marks, beatToX, stepBeats, stepCount, w, cellTop, cellBase]);

  return (
    <>
      {/* the grid itself: every step is a printed cell */}
      {paths.cells && <path d={paths.cells} fill="none" stroke={P.label} strokeOpacity={1} strokeWidth={2} />}
      {paths.barCells && <path d={paths.barCells} fill="none" stroke={P.label} strokeOpacity={1} strokeWidth={2.4} />}
      {paths.second && P.handDrawn && (
        <path d={paths.second} fill="none" stroke={P.label} strokeOpacity={0.22} strokeWidth={1} />
      )}
      {paths.fills && <path d={paths.fills} fill={lane.color} fillOpacity={P.handDrawn ? 0.85 : 0.62} />}
      {paths.fills && P.handDrawn && <path d={paths.fills} fill="url(#pencil-hatch)" fillOpacity={0.5} />}
      {paths.dots && <path d={paths.dots} fill={lane.color} fillOpacity={0.55} />}
      {markPaths.ticks && (
        <path d={markPaths.ticks} fill="none" stroke={lane.color} strokeOpacity={0.9} strokeWidth={1.3} />
      )}
      {markPaths.meter && <path d={markPaths.meter} fill={lane.color} fillOpacity={0.9} />}
      {markPaths.pips && <path d={markPaths.pips} fill={lane.color} fillOpacity={0.9} />}
      {/* A non-default voice is a label, not a level — the only way to read
          "this HAT step is the OPEN hat" without opening anything. */}
      {markPaths.badges.map((b) => (
        <text
          key={`${b.x}-${b.label}`}
          x={b.x}
          y={b.y}
          fontSize={w >= 26 ? 6.5 : 5.5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.2}
          fill={P.deep}
          stroke={lane.color}
          strokeWidth={0.6}
          paintOrder="stroke"
          pointerEvents="none"
        >
          {b.label.slice(0, 3)}
        </text>
      ))}
    </>
  );
}

export default memo(LaneRowImpl);
