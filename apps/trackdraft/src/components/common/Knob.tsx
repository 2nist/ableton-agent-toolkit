import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { TRACKDRAFT } from "../../theme/palette";

/**
 * Knob — a Live-style rotary control. The first real T1 primitive
 * (see docs/ui-standardization.md §2): a slider replacement that behaves
 * like the hardware: vertical drag turns it (tracks anywhere on the page
 * once grabbed), shift-drag is fine (4×), double-click returns to the
 * default, arrow keys nudge (shift ×10), Home/End jump to the ends.
 *
 * Colored by `currentColor`, so pass a Tailwind text-* class (text-accent
 * for interactive controls; a voice/palette color where a value belongs
 * to an instrument).
 *
 * `ghost` renders the amber tick on the arc — the ◆ suggest-don't-impose
 * convention, now on a knob: the analysis-derived value sits visibly next
 * to the live one and only lands via an explicit adopt (the caller shows
 * the ◆ button).
 */

const START_DEG = 135;
const SWEEP_DEG = 270;
const R = 14;
const CX = 20;
const CY = 20;

function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Snap increment; omit for a continuous control (rounded to 1e-6). */
  step?: number;
  /** Rendered size in px (the 40-unit viewBox scales). */
  size?: number;
  /** Double-click target. Defaults to the midpoint. */
  defaultValue?: number;
  /** ◆ detected marker, in the same units as `value` — drawn as an amber
   *  tick just outside the arc. */
  ghost?: number;
  disabled?: boolean;
  /** Color the control with any text-* utility (defaults to text-accent). */
  className?: string;
  title?: string;
}

export default function Knob({
  value,
  onChange,
  min = 0,
  max = 1,
  step,
  size = 36,
  defaultValue,
  ghost,
  disabled = false,
  className = "text-accent",
  title,
}: KnobProps) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);

  const range = max - min;
  const quantize = useCallback(
    (v: number): number => {
      const clamped = Math.max(min, Math.min(max, v));
      if (!step) return Math.round(clamped * 1e6) / 1e6;
      const snapped = min + Math.round((clamped - min) / step) * step;
      return Math.round(snapped * 1e6) / 1e6;
    },
    [min, max, step],
  );

  // Latest props for the window-level drag listeners. The listeners outlive
  // renders (the studio re-renders on every value commit, and pointer
  // capture silently drops whenever React swaps a node mid-drag), so the
  // gesture deliberately runs on `window` and reads from this ref.
  const latest = useRef({ onChange, quantize, range, disabled });
  latest.current = { onChange, quantize, range, disabled };

  const t = range === 0 ? 0 : (value - min) / range;
  const angle = START_DEG + SWEEP_DEG * t;

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (disabled) return;
    e.preventDefault();
    drag.current = { startY: e.clientY, startValue: value };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    function move(ev: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      const { onChange: cb, quantize: q, range: r } = latest.current;
      const pxPerRange = ev.shiftKey ? 640 : 160; // full range over 160px; shift = 4× finer
      cb(q(d.startValue + ((d.startY - ev.clientY) / pxPerRange) * r));
    }
    function finish() {
      drag.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }
  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>) {
    if (disabled) return;
    const s = step ?? range / 100;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(quantize(value + (e.shiftKey ? s * 10 : s)));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(quantize(value - (e.shiftKey ? s * 10 : s)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  }

  const [ix1, iy1] = polar(4.5, angle);
  const [ix2, iy2] = polar(12, angle);
  const ghostAngle = ghost != null && range > 0 ? START_DEG + SWEEP_DEG * ((ghost - min) / range) : null;
  const [gx1, gy1] = ghostAngle != null ? polar(14.8, ghostAngle) : [0, 0];
  const [gx2, gy2] = ghostAngle != null ? polar(18.6, ghostAngle) : [0, 0];

  return (
    <svg
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`shrink-0 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-current ${
        disabled ? "opacity-40" : "cursor-ns-resize"
      } ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => !disabled && onChange(quantize(defaultValue ?? min + range / 2))}
    >
      {title && <title>{title}</title>}
      {/* Track */}
      <path
        d={arcPath(R, START_DEG, START_DEG + SWEEP_DEG)}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      {/* Value fill */}
      {t > 0.004 && (
        <path d={arcPath(R, START_DEG, angle)} stroke="currentColor" strokeWidth={3} fill="none" strokeLinecap="round" />
      )}
      {/* Indicator */}
      <line x1={ix1} y1={iy1} x2={ix2} y2={iy2} stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      {/* ◆ detected ghost tick */}
      {ghostAngle != null && (
        <line x1={gx1} y1={gy1} x2={gx2} y2={gy2} stroke={TRACKDRAFT.amber} strokeWidth={1.6} strokeLinecap="round" />
      )}
    </svg>
  );
}
