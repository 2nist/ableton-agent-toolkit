import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { usePlayhead } from "../../hooks/usePlayhead";
import { useRoleStyle } from "../../lib/roleColors";
import {
  visibleWorldRect,
  type PolyCamera,
  type PolyViewport,
} from "../../lib/poly/camera";
import type { PolyLayout } from "../../lib/poly/layout";

const BOX_W = 188;
const BOX_H = 108;
const PAD = 10;

interface Props {
  layout: PolyLayout;
  camera: PolyCamera;
  viewport: PolyViewport;
  onCentre: (world: { x: number; y: number }) => void;
}

/**
 * The minimap is the camera's second projection: the same world, 20× smaller,
 * with three things a plain overview omits — the song's bounds (so "outside
 * the arrangement" is visible), the viewport bracket, and the playhead.
 *
 * It is also the fastest way to answer "where did that section go", which is
 * the question an infinite canvas makes people ask.
 */
export default function PolyMinimap({
  layout,
  camera,
  viewport,
  onCentre,
}: Props) {
  const roleStyle = useRoleStyle();
  const tick = usePlayhead();
  const boxRef = useRef<HTMLDivElement | null>(null);

  const map = useMemo(() => {
    const bounds = layout.bounds;
    const usableW = BOX_W - PAD * 2;
    const usableH = BOX_H - PAD * 2;
    const scale = Math.min(
      usableW / Math.max(1, bounds.w),
      usableH / Math.max(1, bounds.h),
    );
    const offsetX = PAD + (usableW - bounds.w * scale) / 2 - bounds.x * scale;
    const offsetY = PAD + (usableH - bounds.h * scale) / 2 - bounds.y * scale;
    return {
      scale,
      toX: (x: number) => offsetX + x * scale,
      toY: (y: number) => offsetY + y * scale,
      toWorldX: (x: number) => (x - offsetX) / scale,
      toWorldY: (y: number) => (y - offsetY) / scale,
    };
  }, [layout.bounds]);

  const visible = visibleWorldRect(camera, viewport);

  function centreFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onCentre({
      x: map.toWorldX(event.clientX - rect.left),
      y: map.toWorldY(event.clientY - rect.top),
    });
  }

  if (layout.nodes.length === 0) return null;

  return (
    <div
      ref={boxRef}
      role="group"
      aria-label="Canvas minimap — click to move the view"
      className="absolute bottom-3 right-3 hidden sm:block rounded border border-edge bg-panel/90 shadow-lg backdrop-blur-sm cursor-crosshair select-none"
      style={{ width: BOX_W, height: BOX_H }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        centreFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          centreFromEvent(event);
      }}
    >
      <div
        className="absolute rounded-sm border border-edge/60"
        style={{
          left: map.toX(layout.bounds.x),
          top: map.toY(layout.bounds.y),
          width: layout.bounds.w * map.scale,
          height: layout.bounds.h * map.scale,
          background: "rgb(var(--c-canvas) / 0.7)",
        }}
      />

      {layout.nodes.map((node) => (
        <div
          key={node.key}
          className="absolute rounded-[1px]"
          style={{
            left: map.toX(node.x),
            top: map.toY(node.y),
            width: Math.max(1, node.w * map.scale),
            height: Math.max(1, node.h * map.scale),
            background: roleStyle(node.role).bg,
            opacity: 0.9,
          }}
        />
      ))}

      <div
        className="absolute border border-accent/80 pointer-events-none"
        style={{
          left: map.toX(visible.x),
          top: map.toY(visible.y),
          width: Math.max(2, visible.w * map.scale),
          height: Math.max(2, visible.h * map.scale),
          background: "rgb(var(--c-accent) / 0.08)",
        }}
      />

      <div
        className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none"
        style={{ left: map.toX(layout.beatToX(tick.beat)) }}
      />

      <div className="absolute left-1.5 top-1 font-mono text-[9px] text-inkMuted pointer-events-none">
        {layout.nodes.length} spans · {Math.round(camera.zoom * 100)}%
      </div>
    </div>
  );
}
