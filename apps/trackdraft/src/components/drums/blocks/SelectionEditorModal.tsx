import { useCallback, useEffect, useMemo, useState } from "react";
import type { DrumLaneId } from "@drum/library";
import type { SectionSpan } from "../../../lib/arrangement";
import { beatsPerBarOf } from "../../../lib/timeline/beatMap";
import type { BlueprintSection } from "../../../types/blueprint";
import type { LaneHits } from "../../../lib/timeline/drumLaneHits";
import { DRUM_LANES } from "../laneStyle";
import { EuclidRing, MotionRing } from "./SelectionDisplays";
import { euclidBlocksFor, motionBlockFor, motionLabelFor, upsertBlocks } from "./selectionMath";

/**
 * The exploded selection editor — the docked pad opened into a workbench.
 *
 * Grid (left): the selection in context — two bars either side, all six
 * lanes, section + neighbouring-section labels, global bar numbers, and a
 * uniform velocity box under every step of the selected lanes.
 *
 * Controls (right): mode chips for the control families. EUCLID and
 * MOTION are live: the euclid display is a big ring whose drag arm runs
 * from the center all the way out to the display edge (angle = rotation,
 * distance = density) with each selected lane's necklace NESTED inside
 * the previous one; the motion display is the transition gesture ring.
 * VELOCITY / STEP FX are the next control families and get their cards
 * here so the layout is already planned.
 *
 * Every edit goes through the same draft store as the main view (the
 * `onWrite` prop), so ● preview / Apply / Revert behave identically —
 * and Apply/Cancel CLOSE the editor + selection, per the whole point of
 * the modal being a session.
 */

const GRID_W = 800;
const RULER_H = 30;
const ROW_H = 52;
const GRID_X0 = 58;
const GRID_PAD_R = 18;

interface SelectionEditorModalProps {
  span: SectionSpan;
  /** Draft-aware section. */
  section: BlueprintSection;
  range: { startBeat: number; endBeat: number; laneKeys: string[] };
  hits: LaneHits;
  /** All song spans — neighbour labels for the context edges. */
  spans: SectionSpan[];
  /** The main view's current step grid (keeps boxes aligned with edits). */
  stepBeats: number;
  /** Write into the draft (same path as the main view). */
  onWrite: (mutate: (sec: BlueprintSection) => BlueprintSection) => void;
  hasDraft: boolean;
  onApply: () => void;
  onCancel: () => void;
  onClose: () => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const AMBER = "#E8B54A";

type Mode = "euclid" | "motion" | "velocity" | "fx";

export default function SelectionEditorModal(props: SelectionEditorModalProps) {
  const { span, section, range, hits, spans, stepBeats, onWrite, hasDraft, onApply, onCancel, onClose } = props;

  const [panel, setPanel] = useState<Mode>("euclid");

  // ---- geometry ---------------------------------------------------------------

  const bpb = beatsPerBarOf(span);
  const lanes = range.laneKeys as DrumLaneId[];
  const laneIdxs = lanes
    .map((k) => DRUM_LANES.findIndex((l) => l.key === k))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  const loLane = laneIdxs[0] ?? 0;
  const hiLane = laneIdxs[laneIdxs.length - 1] ?? 0;

  const ctxBeats = 2 * bpb;
  const viewStart = Math.max(0, range.startBeat - ctxBeats);
  const viewEnd = Math.min(span.durationBeats, range.endBeat + ctxBeats);
  const viewLen = Math.max(0.25, viewEnd - viewStart);
  const pxPerBeat = (GRID_W - GRID_X0 - GRID_PAD_R) / viewLen;
  const xOf = (beat: number) => GRID_X0 + (beat - viewStart) * pxPerBeat;

  // Grid step: the main view's step when it still reads at this width,
  // else the beat — the boxes must stay legible at exploded size.
  const gridStep = useMemo(() => {
    let s = stepBeats;
    while (pxPerBeat * s < 11 && s < 1) s *= 2;
    return s;
  }, [stepBeats, pxPerBeat]);
  const stepCount = Math.max(1, Math.ceil(span.durationBeats / gridStep - 1e-9));
  const stepSpacing = pxPerBeat * gridStep;
  const cellR = clamp(stepSpacing / 2 - 2, 3.5, 13);
  const tol = Math.max(0.02, gridStep * 0.35);

  const hitAtFor = useCallback(
    (laneKey: DrumLaneId) => {
      const laneHits = hits.get(laneKey) ?? [];
      const map = new Map<number, { velocity: number }>();
      for (const h of laneHits) {
        const idx = Math.round(h.beat / gridStep);
        if (idx < 0 || idx >= stepCount || Math.abs(h.beat - idx * gridStep) > tol) continue;
        const prev = map.get(idx);
        if (!prev || h.velocity > prev.velocity) map.set(idx, { velocity: h.velocity });
      }
      return map;
    },
    [hits, gridStep, stepCount, tol],
  );

  const selX1 = xOf(range.startBeat);
  const selX2 = xOf(range.endBeat);
  const rowTop = (li: number) => RULER_H + li * ROW_H;

  const prevSpan = useMemo(() => {
    const i = spans.findIndex((s) => s.section.id === span.section.id && s.occurrenceIndex === span.occurrenceIndex);
    return { prev: i > 0 ? spans[i - 1] : null, next: i >= 0 && i < spans.length - 1 ? spans[i + 1] : null };
  }, [spans, span]);

  const barOf = (beat: number) => span.startBar + Math.floor(beat / bpb);
  const nBeats = Math.max(1, Math.round(range.endBeat - range.startBeat));

  // ---- euclid + motion state ---------------------------------------------------

  const firstLane = lanes[0];
  const existingEuclid = useMemo(
    () => (section.drumBlocks ?? []).find(
      (b) => b.mode === "euclid" && b.lane === firstLane &&
        Math.abs(b.startBeat - range.startBeat) < 1e-6 && Math.abs(b.endBeat - range.endBeat) < 1e-6,
    ) ?? null,
    [section.drumBlocks, firstLane, range.startBeat, range.endBeat],
  );
  const existingMotion = useMemo(
    () => (section.drumBlocks ?? []).find(
      (b) => b.mode === "motion" && b.lane === firstLane &&
        Math.abs(b.startBeat - range.startBeat) < 1e-6 && Math.abs(b.endBeat - range.endBeat) < 1e-6,
    ) ?? null,
    [section.drumBlocks, firstLane, range.startBeat, range.endBeat],
  );

  const [euclid, setEuclid] = useState(() => ({
    k: existingEuclid?.euclid?.k ?? Math.max(1, Math.round(nBeats / 2)),
    rotation: existingEuclid?.euclid?.rotation ?? 0,
  }));
  const [motion, setMotion] = useState(() => ({
    x: existingMotion?.motion?.x ?? 0,
    y: existingMotion?.motion?.y ?? 0,
  }));

  const writeEuclid = useCallback((k: number, rotation: number) => {
    setEuclid({ k, rotation });
    onWrite((sec) => ({
      ...sec,
      drumBlocks: upsertBlocks(sec.drumBlocks, euclidBlocksFor(lanes, range.startBeat, range.endBeat, k, nBeats, rotation)),
    }));
  }, [lanes, range.startBeat, range.endBeat, nBeats, onWrite]);

  const writeMotion = useCallback((x: number, y: number) => {
    setMotion({ x, y });
    onWrite((sec) => ({
      ...sec,
      drumBlocks: upsertBlocks(sec.drumBlocks, [motionBlockFor(lanes[0], range.startBeat, range.endBeat, x, y)]),
    }));
  }, [lanes, range.startBeat, range.endBeat, onWrite]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---- render ------------------------------------------------------------------

  const motionReadout = motionLabelFor(motion);

  const chips: { id: Mode; label: string; live: boolean }[] = [
    { id: "euclid", label: "Euclid", live: true },
    { id: "motion", label: "Motion", live: true },
    { id: "velocity", label: "Velocity", live: false },
    { id: "fx", label: "Step FX", live: false },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex flex-col bg-[#0c0e12] border border-edge rounded-lg shadow-2xl w-[min(1180px,94vw)] h-[min(680px,92vh)]">
        {/* header */}
        <div className="flex items-center gap-3 px-4 h-10 border-b border-edge shrink-0">
          <span className="font-mono text-xs uppercase tracking-wider text-[#E8B54A]">Selection editor</span>
          <span className="font-mono text-xs text-ink">{section.name}</span>
          <span className="font-mono text-2xs text-inkMuted">
            bars {barOf(range.startBeat)}–{barOf(Math.max(range.startBeat, range.endBeat - 1e-6))} ·
            beats {range.startBeat}–{range.endBeat} of {span.durationBeats} ·
            {range.startBeat > 0 ? ` ${range.startBeat} before` : ""}{range.endBeat < span.durationBeats ? ` ${span.durationBeats - range.endBeat} after` : ""}
          </span>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="font-mono text-xs text-inkMuted hover:text-ink border border-edge rounded px-2 py-1"
          >
            ✕ Close
          </button>
        </div>

        {/* body — grid left / controls right; stacked on narrow viewports */}
        <div className="flex flex-1 min-h-0 flex-col lg:flex-row overflow-auto">
          {/* exploded grid */}
          <div className="w-full lg:flex-1 lg:min-w-0 p-3 shrink-0">
            <svg viewBox={`0 0 ${GRID_W} 400`} className="w-full h-auto block">
              {/* grid background */}
              <rect x={0} y={0} width={GRID_W} height={400} fill="#08090c" />

              {/* bar lines + numbers (global bar convention) */}
              {Array.from({ length: span.bars + 1 }).map((_, bi) => {
                const beat = bi * bpb;
                if (beat < viewStart - 1e-9 || beat > viewEnd + 1e-9) return null;
                const x = xOf(beat);
                return (
                  <g key={`bar-${bi}`}>
                    <line x1={x} y1={RULER_H - 6} x2={x} y2={400 - 46} stroke="#FFFFFF" strokeOpacity={0.12} strokeWidth={1} />
                    <text x={x + 3} y={RULER_H - 11} fontSize={9} fontFamily={MONO} fill="#8B94A1">
                      {span.startBar + bi}
                    </text>
                  </g>
                );
              })}
              {/* beat ticks */}
              {Array.from({ length: Math.ceil(span.durationBeats) + 1 }).map((_, bi) => {
                if (bi % bpb === 0) return null;
                const x = xOf(bi);
                if (bi < viewStart - 1e-9 || bi > viewEnd + 1e-9) return null;
                return <line key={`bt-${bi}`} x1={x} y1={RULER_H - 10} x2={x} y2={RULER_H - 6} stroke="#FFFFFF" strokeOpacity={0.18} strokeWidth={1} />;
              })}

              {/* section + neighbour labels for context */}
              <text x={GRID_X0} y={14} fontSize={11} fontWeight={600} fontFamily={MONO} fill={AMBER}>
                {section.name.toUpperCase()}
              </text>
              {prevSpan.prev && (
                <text x={GRID_X0 - 4} y={RULER_H + 318} fontSize={9.5} fontFamily={MONO} fill="#6E7684" textAnchor="start">
                  ◀ {prevSpan.prev.section.name}
                </text>
              )}
              {prevSpan.next && (
                <text x={GRID_W - GRID_PAD_R} y={RULER_H + 318} fontSize={9.5} fontFamily={MONO} fill="#6E7684" textAnchor="end">
                  {prevSpan.next.section.name} ▶
                </text>
              )}
              {viewStart > 0 && (
                <text x={GRID_X0 + 4} y={RULER_H - 11} fontSize={8} fontFamily={MONO} fill="#5A6270">…</text>
              )}

              {/* selection band */}
              <rect
                x={selX1} y={rowTop(loLane)} width={Math.max(2, selX2 - selX1)} height={(hiLane - loLane + 1) * ROW_H}
                fill="rgba(232,181,74,0.06)" stroke={AMBER} strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="5 4"
              />

              {/* lanes */}
              {DRUM_LANES.map((lane, li) => {
                const selected = lanes.includes(lane.key as DrumLaneId);
                const top = rowTop(li);
                const cy = top + 4 + cellR;
                const boxTop = top + 4 + 2 * cellR + 4;
                const boxBottom = top + ROW_H - 5;
                const boxH = boxBottom - boxTop;
                const boxW = Math.min(stepSpacing - 3, 34);
                const laneHitAt = hitAtFor(lane.key as DrumLaneId);
                return (
                  <g key={lane.key} opacity={selected ? 1 : 0.4}>
                    <line x1={0} y1={top} x2={GRID_W} y2={top} stroke="#FFFFFF" strokeOpacity={0.06} strokeWidth={1} />
                    <text
                      x={GRID_X0 - 8} y={cy + 4} textAnchor="end" fontSize={11} fontWeight={600}
                      fontFamily={MONO} fill={selected ? lane.color : "#59606D"}
                    >
                      {lane.label}
                    </text>
                    {Array.from({ length: stepCount }).map((_, q) => {
                      const beat = q * gridStep;
                      if (beat < viewStart - 1e-9 || beat > viewEnd + 1e-9) return null;
                      const x = xOf(beat);
                      const hit = laneHitAt.get(q);
                      const inSel = beat >= range.startBeat - 1e-9 && beat < range.endBeat - 1e-9;
                      const barStart = Math.abs(beat / bpb - Math.round(beat / bpb)) < 1e-6;
                      return (
                        <g key={`c-${q}`}>
                          <circle
                            cx={x} cy={cy} r={cellR}
                            fill={hit ? lane.color : "#0b0e13"}
                            fillOpacity={hit ? (inSel ? 0.18 : 0.1) : 1}
                            stroke="#FFFFFF"
                            strokeOpacity={hit ? 0.7 : barStart ? 0.5 : 0.3}
                            strokeWidth={barStart ? 2.4 : 2}
                          />
                          {selected && boxW >= 8 && boxH >= 9 && (
                            <>
                              <rect
                                x={x - boxW / 2} y={boxTop} width={boxW} height={boxH} rx={2.5}
                                fill={hit ? lane.color : "#0b0e13"} fillOpacity={hit ? 0.14 : 0.6}
                                stroke={hit ? lane.color : "#2E3540"} strokeOpacity={hit ? 0.55 : 1} strokeWidth={1}
                              />
                              {hit && boxW >= 13 && (
                                <text
                                  x={x} y={boxTop + boxH / 2 + Math.min(10, Math.max(6.5, boxW * 0.42)) * 0.36}
                                  textAnchor="middle" fontSize={Math.min(10, Math.max(6.5, boxW * 0.42))}
                                  fontFamily={MONO} fill="#E9EDF3" fillOpacity={0.9}
                                >
                                  {Math.round(hit.velocity)}
                                </text>
                              )}
                            </>
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}

              {/* selection captions */}
              <text x={(selX1 + selX2) / 2} y={rowTop(hiLane) + (hiLane - loLane + 1) * ROW_H + 16} textAnchor="middle" fontSize={10} fontFamily={MONO} fill={AMBER}>
                {lanes.length} lane{lanes.length > 1 ? "s" : ""} · {nBeats} beats · drag the ring to set the rhythm
              </text>
            </svg>
          </div>

          {/* controls */}
          <div className="w-full lg:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-edge p-3 flex flex-col gap-2">
            {/* mode chips */}
            <div className="flex flex-wrap gap-1">
              {chips.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPanel(c.id)}
                  className={`font-mono text-2xs rounded px-2 py-1 border ${
                    panel === c.id
                      ? "border-[#E8B54A] text-[#E8B54A] bg-[#E8B54A]/10"
                      : c.live
                        ? "border-edge text-inkMuted hover:text-ink"
                        : "border-edge text-inkMuted/60"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* the control display — the shared ring components (identical
                to the docked workbench's) */}
            {(panel === "euclid" || panel === "motion") && (
              <div className="border border-edge rounded bg-black/40">
                <div className="p-2">
                  {panel === "euclid" ? (
                    <EuclidRing k={euclid.k} n={nBeats} rotation={euclid.rotation} lanes={lanes} onChange={writeEuclid} />
                  ) : (
                    <MotionRing x={motion.x} y={motion.y} onChange={writeMotion} />
                  )}
                </div>
                <div className="px-3 py-2 border-t border-edge">
                  <div className="font-mono text-sm text-[#E8B54A]">
                    {panel === "euclid"
                      ? `${euclid.k}/${nBeats} · ↻${euclid.rotation} · ${Math.round((euclid.k / nBeats) * 100)}%`
                      : motionReadout ?? "DRAG TO GESTURE"}
                  </div>
                  <div className="font-mono text-2xs text-inkMuted mt-0.5">
                    {panel === "euclid"
                      ? "angle = rotation · distance = density · nested rings = selected lanes"
                      : "↗ build · ↖ crescendo · ↓ break · ↙ thin"}
                  </div>
                </div>
              </div>
            )}

            {/* selected lanes */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {lanes.map((k) => {
                const lane = DRUM_LANES.find((l) => l.key === k);
                return (
                  <span key={k} className="flex items-center gap-1 font-mono text-2xs border border-edge rounded px-1.5 py-0.5 text-inkMuted">
                    <span className="w-2 h-2 rounded-full" style={{ background: lane?.color }} />
                    {lane?.label}
                  </span>
                );
              })}
              {lanes.length > 1 && (
                <span className="font-mono text-2xs text-inkMuted">interleaved — one rhythm across the set</span>
              )}
            </div>

            {/* planned control families */}
            {panel === "velocity" && (
              <PlaceholderCard
                title="Velocity patterns"
                lines={[
                  "v1: the step boxes under the grid show + drag each step's velocity.",
                  "Next: shape the whole selection — ramps, accents, alternating, humanize.",
                ]}
              />
            )}
            {panel === "fx" && (
              <PlaceholderCard
                title="Step FX"
                lines={[
                  "Per-step effects that bake into the export today:",
                  "nudge · gate · probability · ratchet · flam",
                  "Controls land here once the selection surface settles.",
                ]}
              />
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center gap-2 px-4 h-12 border-t border-edge shrink-0">
          {hasDraft ? (
            <span className="font-mono text-2xs text-[#E8B54A]">● preview — edits staged</span>
          ) : (
            <span className="font-mono text-2xs text-inkMuted">no edits yet — drag the ring to stage one</span>
          )}
          <span className="flex-1" />
          <span className="font-mono text-2xs text-inkMuted mr-2">Esc closes · Apply/Cancel also close the selection</span>
          <button
            onClick={onApply}
            className="font-mono text-xs rounded px-3 py-1.5 border border-accent text-accent bg-accent/10 hover:bg-accent/20"
          >
            ✓ Apply
          </button>
          <button
            onClick={onCancel}
            className="font-mono text-xs rounded px-3 py-1.5 border border-edge text-inkMuted hover:text-ink"
          >
            ✕ Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaceholderCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="border border-edge rounded p-2.5">
      <div className="font-mono text-2xs uppercase tracking-wider text-inkMuted">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className="font-mono text-2xs text-inkMuted/80 mt-1">{l}</div>
      ))}
    </div>
  );
}
