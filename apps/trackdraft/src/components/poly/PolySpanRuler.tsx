import { useMemo } from "react";
import { useRoleStyle } from "../../lib/roleColors";
import {
  visibleWorldRect,
  type PolyCamera,
  type PolyViewport,
} from "../../lib/poly/camera";
import type { PolyLayout, PolyNode } from "../../lib/poly/layout";

interface Props {
  layout: PolyLayout;
  camera: PolyCamera;
  viewport: PolyViewport;
  focusedId: string | null;
  /** Node keys parked on the shelf — drawn dashed, because they are still part
   *  of the song but not part of the picture. */
  parkedKeys?: readonly string[];
  onFocus: (index: number) => void;
}

export interface RulerTick {
  index: number;
  key: string;
  name: string;
  role: PolyNode["role"];
  /** Share of the song, 0..1. */
  left: number;
  width: number;
  focused: boolean;
  /** Which pass of the section this tick is (1-based) — a repeated section
   *  gets one tick per pass, and two ticks must not share a name. */
  pass: number;
  /** On the shelf: still plays there, not drawn on the canvas. */
  parked: boolean;
}

/**
 * Every tick, laid out across the whole song rather than across the viewport.
 *
 * A long arrangement cannot be navigated by panning: at the standard 50% one
 * section fills the window, so the other thirty-nine are somewhere off-screen
 * with no sense of direction. This is the orientation cue the plan promised —
 * the song as a strip, the window as a bracket, the focused span as a lit
 * tick — and it is the same projection the camera uses, not a second one.
 */
export function rulerTicks(
  layout: PolyLayout,
  focusedId: string | null,
  parkedKeys: readonly string[] = [],
): RulerTick[] {
  const bounds = layout.bounds;
  const total = bounds.w > 0 ? bounds.w : 1;
  const parked = new Set(parkedKeys);
  return layout.nodes.map((node, index) => ({
    index,
    key: node.key,
    name: node.name,
    role: node.role,
    left: Math.max(0, Math.min(1, (node.x - bounds.x) / total)),
    width: Math.max(0, Math.min(1, node.w / total)),
    focused: node.sectionId === focusedId,
    pass: node.occurrenceIndex + 1,
    parked: parked.has(node.key),
  }));
}

/** Where the viewport sits on the strip, clamped to it. */
export function viewportBracket(
  layout: PolyLayout,
  camera: PolyCamera,
  viewport: PolyViewport,
): { left: number; width: number } {
  if (viewport.width <= 0) return { left: 0, width: 1 };
  const bounds = layout.bounds;
  const total = bounds.w > 0 ? bounds.w : 1;
  const visible = visibleWorldRect(camera, viewport);
  const from = Math.max(0, Math.min(1, (visible.x - bounds.x) / total));
  const to = Math.max(
    0,
    Math.min(1, (visible.x + visible.w - bounds.x) / total),
  );
  // Keep the bracket inside the strip even when the window is narrower than
  // the minimum a click target needs.
  const width = Math.max(0.004, to - from);
  return { left: from, width: Math.min(1 - from, width) };
}

/** The ruler is chrome over the top of the canvas, so the camera treats it as
 *  an inset: content must sit below it, not under it. */
export const POLY_RULER_H = 14;

export default function PolySpanRuler({
  layout,
  camera,
  viewport,
  focusedId,
  parkedKeys,
  onFocus,
}: Props) {
  const roleStyle = useRoleStyle();
  const ticks = useMemo(
    () => rulerTicks(layout, focusedId, parkedKeys ?? []),
    [layout, focusedId, parkedKeys],
  );
  const bracket = viewportBracket(layout, camera, viewport);

  if (ticks.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Section ruler — the whole song, click a section to go there"
      className="absolute left-0 right-0 top-0 pointer-events-none border-b border-edge/60 bg-canvas/60"
      style={{ height: POLY_RULER_H }}
    >
      <div className="relative h-full w-full">
        {ticks.map((tick) => {
          const role = roleStyle(tick.role);
          return (
            <button
              key={tick.key}
              type="button"
              aria-label={`Go to ${tick.name}${tick.pass > 1 ? `, pass ${tick.pass}` : ""}`}
              aria-current={tick.focused ? "true" : undefined}
              data-parked={tick.parked ? "true" : undefined}
              title={`${tick.name} · #${tick.index + 1}${tick.parked ? " · on the shelf" : ""}`}
              onClick={() => onFocus(tick.index)}
              className="absolute top-0 bottom-0 rounded-[2px] border-0"
              style={{
                left: `${tick.left * 100}%`,
                width: `max(3px, ${tick.width * 100}%)`,
                padding: 0,
                background: tick.parked ? "transparent" : role.bg,
                border: tick.parked
                  ? `1px dashed ${role.bg}`
                  : "0 solid transparent",
                opacity: tick.focused ? 1 : tick.parked ? 0.55 : 0.3,
                top: 2,
                bottom: 3,
                boxShadow: tick.focused
                  ? "inset 0 0 0 1.5px rgb(var(--c-accent))"
                  : undefined,
                cursor: "pointer",
                pointerEvents: "auto",
              }}
            />
          );
        })}
        {/* The window on the song — the same bracket the minimap draws, but
            always visible, at any canvas width. */}
        <div
          aria-hidden
          className="absolute top-0 bottom-0 rounded-[2px] pointer-events-none"
          style={{
            left: `${bracket.left * 100}%`,
            width: `${bracket.width * 100}%`,
            border: "1px solid rgb(var(--c-ink) / 0.55)",
            background: "rgb(var(--c-ink) / 0.06)",
          }}
        />
      </div>
    </div>
  );
}
