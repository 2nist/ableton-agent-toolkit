import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { euclidOnsetSteps, type DrumLaneId } from "@drum/library";
import type { DrumBlockFx } from "../../../types/blueprint";
import { DRUM_LANES, laneColor } from "../laneStyle";
import { usePalette } from "../../../theme/palette";
import { FX_PARAMS, FX_SPECS, type FxParam } from "./fxParams";
import { euclidFromRing, ringHand } from "./selectionMath";
import type { VelocityOp } from "./velocityOps";

/**
 * The big control displays — shared by the docked Selection Workbench and
 * the exploded modal so there is exactly one implementation of each
 * gesture. Both render in a 260-unit viewBox and scale to their container;
 * both keep the "smooth arm, quantized values" rule: the ball follows the
 * RAW pointer while dragging, the values written are musically exact.
 */

const DISP = 260;
const DISP_C = DISP / 2;
const RING_R = 96;
const RING_BASE = 30;
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const useDragLocal = (ref: RefObject<SVGSVGElement | null>) => {
  return (e: ReactPointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    const sx = rect ? DISP / rect.width : 1;
    const sy = rect ? DISP / rect.height : 1;
    return { x: (e.clientX - (rect?.left ?? 0)) * sx, y: (e.clientY - (rect?.top ?? 0)) * sy };
  };
};

export function EuclidRing({ k, n, rotation, lanes, onChange }: {
  k: number;
  n: number;
  rotation: number;
  /** Selected lanes — drained on nested rings, one per drum. */
  lanes: DrumLaneId[];
  onChange: (k: number, rotation: number) => void;
}) {
  const P = usePalette();
  const ref = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const [dragVis, setDragVis] = useState<{ x: number; y: number } | null>(null);
  const local = useDragLocal(ref);

  const apply = (x: number, y: number) => {
    const next = euclidFromRing(x - DISP_C, y - DISP_C, n, RING_R, RING_BASE);
    onChange(next.k, next.rotation);
  };

  const onsets = euclidOnsetSteps({ k, n, rotation });
  const arm = ringHand(k, n, rotation, RING_R, RING_BASE);
  const armX = dragVis ? clamp(dragVis.x, DISP_C - RING_R - 18, DISP_C + RING_R + 18) : DISP_C + arm.x;
  const armY = dragVis ? clamp(dragVis.y, DISP_C - RING_R - 18, DISP_C + RING_R + 18) : DISP_C + arm.y;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${DISP} ${DISP}`}
      className="w-full h-auto block touch-none select-none"
      style={{ cursor: "grab" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not capturable — fine */ }
        dragging.current = true;
        const l = local(e);
        setDragVis(l);
        apply(l.x, l.y);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const l = local(e);
        setDragVis(l);
        apply(l.x, l.y);
      }}
      onPointerUp={() => { dragging.current = false; setDragVis(null); }}
      onPointerCancel={() => { dragging.current = false; setDragVis(null); }}
    >
      {/* step ticks */}
      {Array.from({ length: n }).map((_, s) => {
        const a = -Math.PI / 2 + (s / n) * 2 * Math.PI;
        return (
          <line
            key={`t-${s}`}
            x1={DISP_C + Math.cos(a) * (RING_R + 6)} y1={DISP_C + Math.sin(a) * (RING_R + 6)}
            x2={DISP_C + Math.cos(a) * (RING_R + 12)} y2={DISP_C + Math.sin(a) * (RING_R + 12)}
            stroke={P.track} strokeOpacity={0.3} strokeWidth={1}
          />
        );
      })}
      {/* nested per-lane necklaces — the drums inside each other */}
      {lanes.map((laneKey, i) => {
        const lane = DRUM_LANES.find((l) => l.key === laneKey);
        const rr = RING_R - i * 13;
        if (rr < 20) return null;
        return (
          <g key={laneKey}>
            <circle cx={DISP_C} cy={DISP_C} r={rr} fill="none" stroke={lane ? laneColor(lane, P) : P.track ?? P.voices.snare} strokeOpacity={0.18} strokeWidth={1} />
            {onsets.map((s, oi) => {
              const a = -Math.PI / 2 + (s / n) * 2 * Math.PI;
              return (
                <circle
                  key={`o-${oi}`}
                  cx={DISP_C + Math.cos(a) * rr} cy={DISP_C + Math.sin(a) * rr}
                  r={4} fill={lane ? laneColor(lane, P) : P.track} fillOpacity={0.9}
                />
              );
            })}
          </g>
        );
      })}
      {/* extended drag arm — line + ball out to the display edge */}
      <line x1={DISP_C} y1={DISP_C} x2={armX} y2={armY} stroke={P.track} strokeWidth={1.6} strokeOpacity={0.85} />
      <circle cx={armX} cy={armY} r={7.5} fill={P.track} stroke={P.deep} strokeWidth={2} />
      <circle cx={armX} cy={armY} r={2} fill={P.deep} />
      <circle cx={DISP_C} cy={DISP_C} r={3} fill={P.track} />
    </svg>
  );
}

export function MotionRing({ x, y, onChange }: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const P = usePalette();
  const ref = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  const [dragVis, setDragVis] = useState<{ x: number; y: number } | null>(null);
  const local = useDragLocal(ref);

  const apply = (px: number, py: number) => {
    onChange(clamp((px - DISP_C) / RING_R, -1, 1), clamp(-(py - DISP_C) / RING_R, -1, 1));
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${DISP} ${DISP}`}
      className="w-full h-auto block touch-none select-none"
      style={{ cursor: "grab" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not capturable — fine */ }
        dragging.current = true;
        const l = local(e);
        setDragVis(l);
        apply(l.x, l.y);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const l = local(e);
        setDragVis(l);
        apply(l.x, l.y);
      }}
      onPointerUp={() => { dragging.current = false; setDragVis(null); }}
      onPointerCancel={() => { dragging.current = false; setDragVis(null); }}
    >
      <line x1={DISP_C - RING_R} y1={DISP_C} x2={DISP_C + RING_R} y2={DISP_C} stroke={P.track} strokeOpacity={0.16} strokeWidth={1} />
      <line x1={DISP_C} y1={DISP_C - RING_R} x2={DISP_C} y2={DISP_C + RING_R} stroke={P.track} strokeOpacity={0.16} strokeWidth={1} />
      <circle cx={DISP_C} cy={DISP_C} r={RING_R} fill="none" stroke={P.track} strokeOpacity={0.2} strokeWidth={1} />
      <text x={DISP_C + RING_R - 4} y={DISP_C - RING_R + 14} textAnchor="end" fontSize={8.5} fontFamily={MONO} fill={P.label}>BUILD</text>
      <text x={DISP_C - RING_R + 4} y={DISP_C - RING_R + 14} fontSize={8.5} fontFamily={MONO} fill={P.label}>CRESC</text>
      <text x={DISP_C - RING_R + 4} y={DISP_C + RING_R - 8} fontSize={8.5} fontFamily={MONO} fill={P.label}>THIN</text>
      <text x={DISP_C + RING_R - 4} y={DISP_C + RING_R - 8} textAnchor="end" fontSize={8.5} fontFamily={MONO} fill={P.label}>BREAK</text>
      <line
        x1={DISP_C} y1={DISP_C}
        x2={dragVis ? clamp(dragVis.x, DISP_C - RING_R, DISP_C + RING_R) : DISP_C + x * RING_R}
        y2={dragVis ? clamp(dragVis.y, DISP_C - RING_R, DISP_C + RING_R) : DISP_C - y * RING_R}
        stroke={P.track} strokeWidth={1.6} strokeDasharray="4 3"
      />
      <circle
        cx={dragVis ? clamp(dragVis.x, DISP_C - RING_R, DISP_C + RING_R) : DISP_C + x * RING_R}
        cy={dragVis ? clamp(dragVis.y, DISP_C - RING_R, DISP_C + RING_R) : DISP_C - y * RING_R}
        r={7.5} fill={P.track} stroke={P.deep} strokeWidth={2}
      />
      <circle cx={DISP_C} cy={DISP_C} r={3} fill={P.track} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Range FX — swing / humanize / quantize / velCurve, the per-range family
// (`DrumBlockFx`). Same units the compiler bakes; the write path lives in
// selectionMath's `fxBlocksFor` so both surfaces stay identical.
// ---------------------------------------------------------------------------

export function FxPanel({ values, onChange }: {
  /** The selection's fx — engine units, rest fields absent. */
  values: DrumBlockFx;
  onChange: (fx: DrumBlockFx) => void;
}) {
  const anyActive = FX_PARAMS.some((p) => values[p]);
  const set = (id: FxParam, v: number) => {
    const next: DrumBlockFx = { ...values };
    if (v === FX_SPECS[id].rest) delete next[id];
    else next[id] = v;
    onChange(next);
  };
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Range FX</span>
        <span className="flex-1" />
        {anyActive && (
          <button
            onClick={() => onChange({})}
            className="font-mono text-2xs text-inkMuted hover:text-ink border border-edge rounded px-1.5 py-0.5"
          >
            ⟲ clear
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {FX_PARAMS.map((id) => (
          <FxRow key={id} id={id} value={values[id] ?? FX_SPECS[id].rest} onChange={(v) => set(id, v)} />
        ))}
      </div>
      <div className="font-mono text-2xs text-inkMuted mt-2">
        Bakes at plan time (quantize → swing → humanize → velCurve) — preview ≡ .mid ≡ live-out ≡ Ableton.
      </div>
      <div className="font-mono text-2xs text-inkMuted/70 mt-0.5">
        Per-step: drag the value boxes under the lanes.
      </div>
    </div>
  );
}

function FxRow({ id, value, onChange }: { id: FxParam; value: number; onChange: (v: number) => void }) {
  const P = usePalette();
  const spec = FX_SPECS[id];
  const track = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const active = value !== spec.rest;
  const applyAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    onChange(spec.fromFrac(clamp((clientX - rect.left) / rect.width, 0, 1)));
  };
  return (
    <div className="flex items-center gap-2" title={spec.hint}>
      <span className={`font-mono text-2xs w-[62px] shrink-0 ${active ? "text-track" : "text-inkMuted"}`}>
        {spec.label.toUpperCase()}
      </span>
      <div
        ref={track}
        className="relative flex-1 h-3.5 rounded-sm bg-deep/50 border border-edge cursor-ew-resize touch-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* not capturable — fine */ }
          dragging.current = true;
          applyAt(e.clientX);
        }}
        onPointerMove={(e) => { if (dragging.current) applyAt(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${spec.toFrac(value) * 100}%`,
            background: active ? P.track : P.grid,
            opacity: active ? 0.9 : 0.5,
          }}
        />
        {spec.min < 0 && <div className="absolute inset-y-0 left-1/2 w-px bg-ink/25" />}
      </div>
      <span className={`font-mono text-2xs w-[64px] shrink-0 text-right ${active ? "text-track" : "text-inkMuted/70"}`}>
        {spec.format(value)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Velocity patterns — the one-shot selection shaping family (ramp / accents
// every N / alternate / humanize / scale). The factors live in velocityOps.ts
// and the write path in DrumBlocksView, so both surfaces trigger the exact
// same bake; every op lands in the draft as editable dots.
// ---------------------------------------------------------------------------

export function VelocityPanel({ onOp }: { onOp: (op: VelocityOp) => void }) {
  const [every, setEvery] = useState(4);
  const [target, setTarget] = useState(100);
  const btn = "font-mono text-2xs rounded px-1.5 py-0.5 border border-edge text-inkMuted hover:text-ink";
  const active = "border-track text-track bg-track/10";
  return (
    <div className="px-3 py-2.5">
      <div className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Velocity patterns</div>
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs w-[62px] shrink-0 text-inkMuted">RAMP</span>
          <button onClick={() => onOp({ kind: "ramp", dir: "up" })} className={btn} title="Fade the selection from soft to loud">↑ rise</button>
          <button onClick={() => onOp({ kind: "ramp", dir: "down" })} className={btn} title="Fade the selection from loud to soft">↓ fall</button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-mono text-2xs w-[62px] shrink-0 text-inkMuted">ACCENTS</span>
          {[2, 3, 4, 6, 8].map((n) => (
            <button
              key={n}
              onClick={() => { setEvery(n); onOp({ kind: "accents", every: n }); }}
              className={`${btn} ${every === n ? active : ""}`}
              title={`Accent every ${n}th step, duck the rest`}
            >
              every {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs w-[62px] shrink-0 text-inkMuted">SHAPE</span>
          <button onClick={() => onOp({ kind: "alternate" })} className={btn} title="Accent even steps, duck odd — a steady ride feel">alternate</button>
          <button onClick={() => onOp({ kind: "humanize" })} className={btn} title="Seeded ±12% velocity jitter — same dice every time">humanize</button>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-2xs w-[62px] shrink-0 text-inkMuted">SCALE TO</span>
          <button onClick={() => setTarget((t) => Math.max(20, t - 5))} className={btn}>−</button>
          <span className="font-mono text-2xs text-ink w-7 text-center tabular-nums">{target}</span>
          <button onClick={() => setTarget((t) => Math.min(127, t + 5))} className={btn}>+</button>
          <button onClick={() => onOp({ kind: "scale", target })} className={btn} title="Scale the selection so its loudest hit lands on this value">apply</button>
        </div>
      </div>
      <div className="font-mono text-2xs text-inkMuted mt-2">
        One-shot shaping of the selection — bakes editable dots (preview ≡ export), Apply to keep.
      </div>
    </div>
  );
}
