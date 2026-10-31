import { useEffect, useRef, useState } from "react";
import type { DrumBlockFx } from "../../../types/blueprint";
import { usePalette, withAlpha } from "../../../theme/palette";
import { DRUM_LANES, laneColor } from "../laneStyle";
import { asStepParam, PARAM_SPECS, STEP_PARAMS, type StepParam } from "./stepParams";
import { FX_PARAMS, FX_SPECS, type FxParam } from "./fxParams";

/**
 * The frozen left gutter: a surface name and TWO chips.
 *
 *   KICK
 *   S [ VEL ]        ← STEP chip: what a vertical drag on a BAR edits
 *   L [ SWG 31% ]    ← LANE chip: the lane's FX; drag the chip itself
 *
 * Two chips, two jobs, no shared state. The old single chip had to mean
 * "velocity", "which step parameter a drag edits" and "which FX the lane
 * carries" at once, which is why it read as one disjointed control.
 *
 * Both chips commit ONCE, on release — a drag never writes the draft store
 * per pixel.
 */

export interface LaneGutterProps {
  height: number;
  width: number;
  top: number;
  rowH: number;
  /** Current step-parameter choice per lane. */
  stepSel: Record<string, StepParam>;
  /** Current lane-FX choice per lane (null = nothing chosen yet). */
  fxSel: Record<string, FxParam | null>;
  /** Current FX values per lane (rest when absent). */
  fxValues: Record<string, DrumBlockFx | undefined>;
  /** Lanes inside the current selection (their names are highlighted). */
  selectedLanes: Set<string>;
  /** Click on a lane NAME selects that lane (shift extends). */
  onLaneClick: (laneKey: string) => void;
  /** In-flight FX value while a lane chip is being dragged. */
  fxPreview: { laneKey: string; id: FxParam; value: number } | null;
  onStepSel: (laneKey: string, param: StepParam) => void;
  onFxSel: (laneKey: string, id: FxParam) => void;
  /** Commit an FX value for a lane (called once, on release). */
  onFxCommit: (laneKey: string, next: DrumBlockFx) => void;
  /** Live preview callback while dragging (no store write). */
  onFxPreview: (preview: { laneKey: string; id: FxParam; value: number } | null) => void;
  /** Lanes that will not sound (muted, or not soloed while a solo is up). */
  silentLanes: Set<string>;
  /** Raw mute / solo membership, for the M and S toggles' lit state. */
  mutedLanes: Set<string>;
  soloedLanes: Set<string>;
  onMute: (laneKey: string) => void;
  onSolo: (laneKey: string) => void;
  /** Per-lane MIDI CC assignments (`section.drumLaneCc`). */
  ccs: Record<string, { cc: number; from: number; to: number } | undefined>;
  /** Write (or clear, with null) a lane's controller. */
  onCcSet: (laneKey: string, spec: { cc: number; from: number; to: number } | null) => void;
}

const CHIP_W = 62;
const CHIP_X = 14;
const CHIP_H = 12;

export default function LaneGutter(props: LaneGutterProps) {
  const {
    height, width, top, rowH, stepSel, fxSel, fxValues, fxPreview,
    selectedLanes, onLaneClick, onStepSel, onFxSel, onFxCommit, onFxPreview,
    silentLanes, mutedLanes, soloedLanes, onMute, onSolo, ccs, onCcSet,
  } = props;
  const P = usePalette();
  const [menu, setMenu] = useState<{ laneKey: string; kind: "step" | "fx" | "cc" } | null>(null);
  const drag = useRef<{ laneKey: string; id: FxParam; startFrac: number; y0: number; moved: boolean; value: number } | null>(null);
  /** Set when a chip scrub moved — the click that follows must not open the menu. */
  const movedRef = useRef(false);

  useEffect(() => {
    const clear = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      onFxPreview(null);
      // commit once, on release
      if (d.moved) {
        const spec = FX_SPECS[d.id];
        const fx: DrumBlockFx = { ...(fxValues[d.laneKey] ?? {}) };
        if (d.value === spec.rest) delete fx[d.id];
        else fx[d.id] = d.value;
        onFxCommit(d.laneKey, fx);
      }
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  });

  const fxValueOf = (laneKey: string, id: FxParam): number => {
    if (fxPreview && fxPreview.laneKey === laneKey && fxPreview.id === id) return fxPreview.value;
    return fxValues[laneKey]?.[id] ?? FX_SPECS[id].rest;
  };

  return (
    <div className="sticky left-0 top-0 z-10" style={{ width, height, marginTop: -height }}>
      <div className="relative h-full w-full bg-deep">
        <svg width={width} height={height} className="block">
          {DRUM_LANES.map((lane, li) => {
            const color = laneColor(lane, P);
            const laneTop = top + li * rowH;
            const stepParam = asStepParam(stepSel[lane.key]);
            const fxId = fxSel[lane.key] ?? null;
            const fxOn = fxId ? fxValueOf(lane.key, fxId) !== FX_SPECS[fxId].rest : false;
            const anyFx = FX_PARAMS.some((id) => {
              const v = fxValues[lane.key]?.[id];
              return v !== undefined && v !== FX_SPECS[id].rest;
            });
            const fxFrac = fxId ? Math.max(0, Math.min(1, FX_SPECS[fxId].toFrac(fxValueOf(lane.key, fxId)))) : 0;
            return (
              <g key={lane.key}>
                {/* the lane NAME is the selection target — click to select the
                    whole lane, shift-click to add */}
                <rect
                  x={0} y={laneTop + 1} width={width - 2} height={15}
                  fill={selectedLanes.has(lane.key) ? withAlpha(P.track, 0.12) : "transparent"}
                  style={{ cursor: "pointer" }}
                  onClick={() => onLaneClick(lane.key)}
                />
                {/* M / S — the lane's mixer state. Muting (or soloing another
                    lane) removes this lane from the preview, the .mid and the
                    Ableton clips, so the toggle is the same decision the
                    exporter makes, not a view filter. */}
                {(["mute", "solo"] as const).map((kind, i) => {
                  const on = kind === "mute" ? mutedLanes.has(lane.key) : soloedLanes.has(lane.key);
                  const x = 1 + i * 13;
                  return (
                    <g
                      key={kind}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (kind === "mute") onMute(lane.key);
                        else onSolo(lane.key);
                      }}
                    >
                      <title>
                        {kind === "mute"
                          ? `${on ? "Unmute" : "Mute"} ${lane.label} — muted lanes leave the canvas, the .mid and the Ableton clips`
                          : `${on ? "Unsolo" : "Solo"} ${lane.label} — while any lane is soloed only soloed lanes sound`}
                      </title>
                      <rect
                        x={x} y={laneTop + 2} width={11} height={10} rx={2}
                        fill={on ? (kind === "mute" ? "rgba(180,84,74,0.22)" : withAlpha(P.track, 0.22)) : "transparent"}
                        stroke={on ? (kind === "mute" ? P.voices.snare : P.track) : P.grid}
                        strokeOpacity={on ? 1 : 0.7}
                      />
                      <text
                        x={x + 5.5} y={laneTop + 9.4} textAnchor="middle"
                        fontSize={6.5} fontWeight={700} fontFamily="'IBM Plex Mono', monospace"
                        fill={on ? (kind === "mute" ? P.voices.snare : P.track) : P.label}
                        fillOpacity={on ? 1 : 0.6}
                        pointerEvents="none"
                      >
                        {kind === "mute" ? "M" : "S"}
                      </text>
                    </g>
                  );
                })}
                {/* CC — the lane's controller automation (hat openness,
                    filter, expression). Lit when the lane has one; the panel
                    edits the number and the ramp. */}
                <g
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu(menu?.laneKey === lane.key && menu.kind === "cc" ? null : { laneKey: lane.key, kind: "cc" });
                  }}
                >
                  <title>
                    {ccs[lane.key]
                      ? `CC${ccs[lane.key]!.cc} · ${ccs[lane.key]!.from}→${ccs[lane.key]!.to} — click to edit ${lane.label}'s controller`
                      : `Assign a MIDI CC to ${lane.label} (hat openness, filter, expression…)`}
                  </title>
                  <rect
                    x={27} y={laneTop + 2} width={20} height={10} rx={2}
                    fill={ccs[lane.key] ? "rgba(143,211,255,0.20)" : "transparent"}
                    stroke={ccs[lane.key] ? P.select : P.grid}
                    strokeOpacity={ccs[lane.key] ? 1 : 0.7}
                  />
                  <text
                    x={37} y={laneTop + 9.4} textAnchor="middle"
                    fontSize={6.5} fontWeight={700} fontFamily="'IBM Plex Mono', monospace"
                    fill={ccs[lane.key] ? P.select : P.label}
                    fillOpacity={ccs[lane.key] ? 1 : 0.55}
                    pointerEvents="none"
                  >
                    CC
                  </text>
                </g>
                <text
                  x={width - 12} y={laneTop + 13} textAnchor="end"
                  fontSize={P.handDrawn ? 13 : 12} fontWeight={600}
                  letterSpacing={P.handDrawn ? "0.06em" : undefined}
                  fontFamily={P.labelFont} fill={color}
                  fillOpacity={silentLanes.has(lane.key) ? 0.35 : 1}
                  pointerEvents="none"
                >
                  {lane.label}
                </text>

                {/* STEP chip */}
                <g
                  style={{ cursor: "pointer" }}
                  onClick={() => setMenu(menu?.laneKey === lane.key && menu.kind === "step" ? null : { laneKey: lane.key, kind: "step" })}
                >
                  <text x={4} y={laneTop + 25} fontSize={6.5} fontFamily="'IBM Plex Mono', monospace" fill={P.label} fillOpacity={0.55}>S</text>
                  <rect
                    x={CHIP_X} y={laneTop + 18} width={CHIP_W} height={CHIP_H} rx={3}
                    fill={P.deep}
                    stroke={stepParam !== "vel" ? P.track : P.grid}
                    strokeOpacity={stepParam !== "vel" ? 0.85 : 1}
                  />
                  <text
                    x={CHIP_X + CHIP_W / 2} y={laneTop + 26.5} textAnchor="middle"
                    fontSize={7.5} fontWeight={600} fontFamily="'IBM Plex Mono', monospace"
                    fill={stepParam !== "vel" ? P.track : P.voices.snare} pointerEvents="none"
                  >
                    {PARAM_SPECS[stepParam].short}
                  </text>
                </g>

                {/* LANE chip */}
                <g
                  style={{ cursor: fxId ? "ns-resize" : "pointer" }}
                  onClick={() => {
                    if (movedRef.current) { movedRef.current = false; return; }
                    setMenu(menu?.laneKey === lane.key && menu.kind === "fx" ? null : { laneKey: lane.key, kind: "fx" });
                  }}
                  onPointerDown={(e) => {
                    if (!fxId || e.button !== 0) return;
                    e.stopPropagation();
                    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* fine */ }
                    movedRef.current = false;
                    drag.current = {
                      laneKey: lane.key, id: fxId,
                      startFrac: Math.max(0, Math.min(1, FX_SPECS[fxId].toFrac(fxValueOf(lane.key, fxId)))),
                      y0: e.clientY, moved: false, value: fxValueOf(lane.key, fxId),
                    };
                  }}
                  onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d || d.laneKey !== lane.key) return;
                    if ((e.buttons & 1) === 0) { drag.current = null; return; }
                    const dy = e.clientY - d.y0;
                    if (Math.abs(dy) < 2) return;
                    d.moved = true;
                    movedRef.current = true;
                    const spec = FX_SPECS[d.id];
                    d.value = spec.fromFrac(Math.max(0, Math.min(1, d.startFrac - dy / 70)));
                    onFxPreview({ laneKey: lane.key, id: d.id, value: d.value });
                  }}
                >
                  <text x={4} y={laneTop + 39} fontSize={6.5} fontFamily="'IBM Plex Mono', monospace" fill={P.label} fillOpacity={0.55}>L</text>
                  <rect
                    x={CHIP_X} y={laneTop + 32} width={CHIP_W} height={CHIP_H} rx={3}
                    fill={P.deep}
                    stroke={fxOn ? P.track : P.grid}
                    strokeOpacity={fxOn ? 0.85 : 1}
                  />
                  {fxId && fxFrac > 0 && (
                    <rect
                      x={CHIP_X + 1} y={laneTop + 33} width={(CHIP_W - 2) * fxFrac} height={CHIP_H - 2} rx={2}
                      fill={P.track} opacity={0.18} pointerEvents="none"
                    />
                  )}
                  <text
                    x={CHIP_X + CHIP_W / 2} y={laneTop + 40.5} textAnchor="middle"
                    fontSize={6.8} fontWeight={600} fontFamily="'IBM Plex Mono', monospace"
                    fill={fxOn ? P.track : P.voices.snare} pointerEvents="none"
                  >
                    {fxId ? `${FX_SHORT[fxId]}${fxOn ? ` ${FX_SPECS[fxId].format(fxValueOf(lane.key, fxId))}` : ""}` : "FX"}
                  </text>
                  {anyFx && !fxOn && <circle cx={CHIP_X + CHIP_W - 3} cy={laneTop + 34.5} r={1.5} fill={P.track} pointerEvents="none" />}
                </g>
              </g>
            );
          })}
          {P.handDrawn && (
            <line x1={width - 1} y1={top - 6} x2={width - 1} y2={height - 6} stroke={P.grid} strokeOpacity={0.45} strokeWidth={1} />
          )}
        </svg>

        {menu && menu.kind === "cc" && (() => {
          const li = DRUM_LANES.findIndex((l) => l.key === menu.laneKey);
          if (li < 0) return null;
          const laneTop = top + li * rowH;
          const spec = ccs[menu.laneKey] ?? { cc: 74, from: 0, to: 127 };
          const set = (next: { cc: number; from: number; to: number }) => onCcSet(menu.laneKey, next);
          return (
            <>
              <div className="fixed inset-0 z-20" onPointerDown={() => setMenu(null)} />
              <div
                className="absolute z-30 flex flex-col gap-1 rounded border p-1.5"
                style={{ left: width + 2, top: laneTop, width: 170, background: P.deep, borderColor: P.grid }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="font-mono uppercase" style={{ fontSize: 6.5, letterSpacing: "0.14em", color: P.label, opacity: 0.6 }}>
                  midi cc · this lane
                </span>
                <label className="flex items-center gap-1.5">
                  <span className="font-mono" style={{ fontSize: 8, color: P.label }}>CC#</span>
                  <input
                    type="number" min={0} max={127} value={spec.cc}
                    onChange={(e) => set({ ...spec, cc: Math.max(0, Math.min(127, Number(e.target.value) || 0)) })}
                    className="rounded-sm border px-1"
                    style={{ width: 46, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", background: "transparent", color: P.label, borderColor: P.grid }}
                    title="Controller number — 4 hat openness · 7 volume · 11 expression · 74 cutoff"
                  />
                  <span className="font-mono" style={{ fontSize: 7, color: P.label, opacity: 0.55 }}>
                    {CC_NAMES[spec.cc] ?? ""}
                  </span>
                </label>
                {(["from", "to"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <span className="font-mono" style={{ fontSize: 8, color: P.label, width: 26 }}>{k.toUpperCase()}</span>
                    <input
                      type="range" min={0} max={127} value={spec[k]}
                      onChange={(e) => set({ ...spec, [k]: Number(e.target.value) })}
                      className="flex-1" style={{ accentColor: P.select, height: 10 }}
                      title={k === "from" ? "Value at the section start" : "Value at the section end (same as FROM = a static setting)"}
                    />
                    <span className="font-mono tabular-nums" style={{ fontSize: 9, color: P.select, width: 22, textAlign: "right" }}>{spec[k]}</span>
                  </label>
                ))}
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { onCcSet(menu.laneKey, spec); setMenu(null); }}
                    className="font-mono rounded-sm border px-1.5"
                    style={{ fontSize: 8, borderColor: P.select, color: P.select }}
                  >
                    SET
                  </button>
                  <button
                    type="button"
                    onClick={() => { onCcSet(menu.laneKey, null); setMenu(null); }}
                    className="font-mono rounded-sm border px-1.5"
                    style={{ fontSize: 8, borderColor: P.grid, color: P.label }}
                  >
                    CLEAR
                  </button>
                </span>
              </div>
            </>
          );
        })()}

        {menu && menu.kind !== "cc" && (() => {
          const li = DRUM_LANES.findIndex((l) => l.key === menu.laneKey);
          if (li < 0) return null;
          const isStep = menu.kind === "step";
          const rows = isStep ? STEP_PARAMS.length : FX_PARAMS.length;
          const menuH = rows * 16 + 22;
          const laneTop = top + li * rowH;
          const menuY = laneTop + 18 + menuH <= height - 6 ? laneTop + 18 : Math.max(2, laneTop - menuH - 2);
          return (
            <>
              <div className="fixed inset-0 z-20" onPointerDown={() => setMenu(null)} />
              <div
                className="absolute z-30 flex flex-col rounded border p-0.5"
                style={{ left: width + 2, top: menuY, width: 118, background: P.deep, borderColor: P.grid }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="px-1.5 pb-0.5 font-mono uppercase" style={{ fontSize: 6.5, letterSpacing: "0.14em", color: P.label, opacity: 0.6 }}>
                  {isStep ? "step · drag a bar" : "lane fx · drag the chip"}
                </span>
                {(isStep ? STEP_PARAMS : FX_PARAMS).map((id) => {
                  const active = isStep ? asStepParam(stepSel[menu.laneKey]) === id : fxSel[menu.laneKey] === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        if (isStep) onStepSel(menu.laneKey, id as StepParam);
                        else onFxSel(menu.laneKey, id as FxParam);
                        setMenu(null);
                      }}
                      className="block w-full rounded-sm px-1.5 text-left"
                      style={{
                        height: 15, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
                        color: active ? P.track : P.label,
                        background: active ? withAlpha(P.track, 0.14) : "transparent",
                      }}
                    >
                      {isStep ? PARAM_SPECS[id as StepParam].label : FX_SPECS[id as FxParam].label}
                    </button>
                  );
                })}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

const FX_SHORT: Record<FxParam, string> = { swing: "SWG", humanize: "HUM", quantize: "QNT", velCurve: "CRV" };

/** The controllers worth naming — everything else is just a number. */
const CC_NAMES: Record<number, string> = {
  1: "mod",
  4: "foot/hat",
  7: "volume",
  10: "pan",
  11: "expression",
  64: "sustain",
  71: "resonance",
  74: "cutoff",
};
