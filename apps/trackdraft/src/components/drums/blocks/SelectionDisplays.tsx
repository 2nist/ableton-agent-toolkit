import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { euclidOnsetSteps, type DrumLaneId } from "@drum/library";
import { DRUM_LANES } from "../laneStyle";
import { euclidFromRing, ringHand } from "./selectionMath";

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
const AMBER = "#E8B54A";
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
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
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
            stroke={AMBER} strokeOpacity={0.3} strokeWidth={1}
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
            <circle cx={DISP_C} cy={DISP_C} r={rr} fill="none" stroke={lane?.color ?? "#8B94A1"} strokeOpacity={0.18} strokeWidth={1} />
            {onsets.map((s, oi) => {
              const a = -Math.PI / 2 + (s / n) * 2 * Math.PI;
              return (
                <circle
                  key={`o-${oi}`}
                  cx={DISP_C + Math.cos(a) * rr} cy={DISP_C + Math.sin(a) * rr}
                  r={4} fill={lane?.color ?? AMBER} fillOpacity={0.9}
                />
              );
            })}
          </g>
        );
      })}
      {/* extended drag arm — line + ball out to the display edge */}
      <line x1={DISP_C} y1={DISP_C} x2={armX} y2={armY} stroke={AMBER} strokeWidth={1.6} strokeOpacity={0.85} />
      <circle cx={armX} cy={armY} r={7.5} fill={AMBER} stroke="#0b0d11" strokeWidth={2} />
      <circle cx={armX} cy={armY} r={2} fill="#0b0d11" />
      <circle cx={DISP_C} cy={DISP_C} r={3} fill={AMBER} />
    </svg>
  );
}

export function MotionRing({ x, y, onChange }: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
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
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
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
      <line x1={DISP_C - RING_R} y1={DISP_C} x2={DISP_C + RING_R} y2={DISP_C} stroke={AMBER} strokeOpacity={0.16} strokeWidth={1} />
      <line x1={DISP_C} y1={DISP_C - RING_R} x2={DISP_C} y2={DISP_C + RING_R} stroke={AMBER} strokeOpacity={0.16} strokeWidth={1} />
      <circle cx={DISP_C} cy={DISP_C} r={RING_R} fill="none" stroke={AMBER} strokeOpacity={0.2} strokeWidth={1} />
      <text x={DISP_C + RING_R - 4} y={DISP_C - RING_R + 14} textAnchor="end" fontSize={8.5} fontFamily={MONO} fill="#cfcfcf">BUILD</text>
      <text x={DISP_C - RING_R + 4} y={DISP_C - RING_R + 14} fontSize={8.5} fontFamily={MONO} fill="#cfcfcf">CRESC</text>
      <text x={DISP_C - RING_R + 4} y={DISP_C + RING_R - 8} fontSize={8.5} fontFamily={MONO} fill="#cfcfcf">THIN</text>
      <text x={DISP_C + RING_R - 4} y={DISP_C + RING_R - 8} textAnchor="end" fontSize={8.5} fontFamily={MONO} fill="#cfcfcf">BREAK</text>
      <line
        x1={DISP_C} y1={DISP_C}
        x2={dragVis ? clamp(dragVis.x, DISP_C - RING_R, DISP_C + RING_R) : DISP_C + x * RING_R}
        y2={dragVis ? clamp(dragVis.y, DISP_C - RING_R, DISP_C + RING_R) : DISP_C - y * RING_R}
        stroke={AMBER} strokeWidth={1.6} strokeDasharray="4 3"
      />
      <circle
        cx={dragVis ? clamp(dragVis.x, DISP_C - RING_R, DISP_C + RING_R) : DISP_C + x * RING_R}
        cy={dragVis ? clamp(dragVis.y, DISP_C - RING_R, DISP_C + RING_R) : DISP_C - y * RING_R}
        r={7.5} fill={AMBER} stroke="#0b0d11" strokeWidth={2}
      />
      <circle cx={DISP_C} cy={DISP_C} r={3} fill={AMBER} />
    </svg>
  );
}
