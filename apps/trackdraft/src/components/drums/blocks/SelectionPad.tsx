import { euclidOnsetSteps } from "@drum/library";
import { usePalette } from "../../../theme/palette";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * The selection's XY pad — docked to the RIGHT of the selection rect (never
 * covering the pattern being edited, per the v3 design), in one cluster
 * with the mode buttons and the readout. Purely presentational: the parent
 * owns the drag state machine (pointer capture over the pad circle) and
 * writes the resulting `euclid {k,n,rotation}` / `motion {x,y}` into the
 * draft section's `drumBlocks`.
 *
 * Euclid mode: X = rotation (the handle swings around the ring as it
 * turns), Y = hits (distance from center = k/n). The ring shows every step
 * as a faint tick and the k onsets as dots coloured per selected lane —
 * the Euclidean necklace as a live reference, instead of a static glyph
 * on the timeline.
 *
 * Motion mode: the same pad becomes the transition gesture — ↗ build,
 * ↖ crescendo, ↓ break, ↙ thin (matching `motionModelFor` in
 * `@drum/library`).
 */

export const PAD_PANEL_W = 200;
export const PAD_PANEL_H = 86;

/** The whole cluster is drawn at design coordinates and scaled up here —
 *  a sequencer pad you have to squint at isn't a pad. Callers clamp panel
 *  position against the SCALED footprint (W × S, H × S). */
export const PAD_SCALE = 1.2;

export interface SelectionPadProps {
  /** Panel top-left corner (svg coords). */
  panelX: number;
  panelY: number;
  /** Selection's right edge — the connector line starts here. */
  connectorFromX: number;
  mode: "euclid" | "motion";
  euclid: { k: number; n: number; rotation: number };
  motion: { x: number; y: number };
  motionLabel: string | null;
  /** Necklace onset colours, one per selected lane (cycles). */
  laneColors: string[];
  /** Mesh: opacity + pointer feedback for the Apply/Cancel pair. */
  hasDraft: boolean;
  onApply: () => void;
  onCancel: () => void;
  onMode: (mode: "euclid" | "motion") => void;
  /** Open the exploded selection editor (the ⤢ chip on the readout). */
  onExpand: () => void;
  onPadPointerDown: (e: ReactPointerEvent) => void;
  onPadPointerMove: (e: ReactPointerEvent) => void;
  onPadPointerUp: (e: ReactPointerEvent) => void;
}

const MONO = "'IBM Plex Mono', ui-monospace, Menlo, monospace";

export default function SelectionPad({
  panelX, panelY, connectorFromX, mode, euclid, motion, motionLabel, laneColors,
  hasDraft, onApply, onCancel, onMode, onExpand, onPadPointerDown, onPadPointerMove, onPadPointerUp,
}: SelectionPadProps) {
  const P = usePalette();
  const cx = panelX + 36;
  const cy = panelY + 32;
  const R = 26;
  const n = Math.max(1, Math.floor(euclid.n));
  const onsets = euclidOnsetSteps(euclid);

  return (
    <g>
      {/* connector tying the pad to the selection's right edge — decorative:
          it overlaps the selection's right resize handle, so it must never
          swallow pointer events */}
      <line x1={connectorFromX} y1={cy} x2={panelX} y2={cy} stroke={P.track} strokeWidth={1.2} strokeOpacity={0.6} pointerEvents="none" />
      <polygon points={`${connectorFromX + 2},${cy - 4} ${connectorFromX - 2},${cy} ${connectorFromX + 2},${cy + 4}`} fill={P.track} fillOpacity={0.8} pointerEvents="none" />

      {/* everything but the connector lives in one scaled group — panel,
          chips, necklace and hit targets all grow together */}
      <g transform={`translate(${panelX} ${panelY}) scale(${PAD_SCALE}) translate(${-panelX} ${-panelY})`}>
      {/* panel — background only; everything interactive sits on top */}
      <rect x={panelX} y={panelY} width={PAD_PANEL_W} height={PAD_PANEL_H} rx={6} fill="rgba(11,13,17,0.9)" stroke={P.track} strokeOpacity={0.4} strokeWidth={1} pointerEvents="none" />

      {/* mode buttons — part of the same cluster */}
      {(["euclid", "motion"] as const).map((m, i) => (
        <g key={m} onClick={() => onMode(m)} onPointerDown={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
          <rect
            x={panelX + 78} y={panelY + 10 + i * 24} width={64} height={16} rx={3}
            fill={mode === m ? "rgba(232,181,74,0.14)" : P.deep}
            stroke={mode === m ? P.track : P.grid} strokeWidth={1}
          />
          <text
            x={panelX + 110} y={panelY + 21 + i * 24} textAnchor="middle" fontSize={8.5} fontWeight={600}
            fill={mode === m ? P.track : P.label} fontFamily={MONO}
          >
            {m === "euclid" ? "Euclid" : "Motion"}
          </text>
        </g>
      ))}

      {/* pad face — decorative only; the transparent r=34 circle below is the
          real drag target */}
      <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={R} fill={P.deep} fillOpacity={0.97} stroke={P.track} strokeWidth={1.3} />
      <line x1={cx - 30} y1={cy} x2={cx + 30} y2={cy} stroke={P.track} strokeOpacity={0.16} strokeWidth={1} />
      <line x1={cx} y1={cy - 30} x2={cx} y2={cy + 30} stroke={P.track} strokeOpacity={0.16} strokeWidth={1} />

      {mode === "euclid" ? (
        <>
          {/* rotation axis arrows */}
          <polygon points={`${cx + 30},${cy} ${cx + 25},${cy - 3} ${cx + 25},${cy + 3}`} fill={P.track} fillOpacity={0.3} />
          <polygon points={`${cx - 30},${cy} ${cx - 25},${cy - 3} ${cx - 25},${cy + 3}`} fill={P.track} fillOpacity={0.3} />
          <polygon points={`${cx},${cy - 30} ${cx - 3},${cy - 25} ${cx + 3},${cy - 25}`} fill={P.track} fillOpacity={0.3} />
          <polygon points={`${cx},${cy + 30} ${cx - 3},${cy + 25} ${cx + 3},${cy + 25}`} fill={P.track} fillOpacity={0.3} />
          {/* step ticks + the k onsets (necklace as live reference) */}
          {Array.from({ length: n }).map((_, s) => {
            if (n > 24 && s % 2 !== 0) return null;
            const a = -Math.PI / 2 + (s / n) * 2 * Math.PI;
            return (
              <line
                key={`t-${s}`}
                x1={cx + Math.cos(a) * 19} y1={cy + Math.sin(a) * 19}
                x2={cx + Math.cos(a) * 23} y2={cy + Math.sin(a) * 23}
                stroke={P.track} strokeOpacity={0.25} strokeWidth={0.8}
              />
            );
          })}
          {onsets.map((s, i) => {
            const a = -Math.PI / 2 + (s / n) * 2 * Math.PI;
            const color = laneColors[i % Math.max(1, laneColors.length)] ?? P.track;
            return <circle key={`o-${i}`} cx={cx + Math.cos(a) * 21} cy={cy + Math.sin(a) * 21} r={2.5} fill={color} />;
          })}
          {/* handle: angle = rotation, distance = density */}
          {(() => {
            const a = -Math.PI / 2 + (euclid.rotation / n) * 2 * Math.PI;
            const dist = 8 + (euclid.k / n) * 14;
            const hx = cx + Math.cos(a) * dist;
            const hy = cy + Math.sin(a) * dist;
            return (
              <>
                <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={P.track} strokeOpacity={0.5} strokeWidth={1} />
                <circle cx={hx} cy={hy} r={6} fill={P.track} stroke={P.deep} strokeWidth={2} />
                <circle cx={hx} cy={hy} r={1.8} fill={P.deep} />
              </>
            );
          })()}
        </>
      ) : (
        <>
          {/* quadrant legend */}
          <text x={cx + 32} y={cy - 18} textAnchor="start" fontSize={7} fontFamily={MONO} fill={P.label}>BUILD</text>
          <text x={cx - 32} y={cy - 18} textAnchor="end" fontSize={7} fontFamily={MONO} fill={P.label}>CRESC</text>
          <text x={cx - 32} y={cy + 36} textAnchor="end" fontSize={7} fontFamily={MONO} fill={P.label}>THIN</text>
          <text x={cx + 32} y={cy + 36} textAnchor="start" fontSize={7} fontFamily={MONO} fill={P.label}>BREAK</text>
          {/* vector */}
          <line
            x1={cx} y1={cy}
            x2={cx + motion.x * 20} y2={cy - motion.y * 20}
            stroke={P.track} strokeWidth={1.4} strokeDasharray="3 3"
          />
          <circle cx={cx + motion.x * 20} cy={cy - motion.y * 20} r={5.5} fill={P.track} />
        </>
      )}

      {/* readout */}
      <rect x={panelX + 6} y={panelY + 64} width={PAD_PANEL_W - 12} height={15} rx={7} fill={P.deep} stroke={P.track} strokeOpacity={0.5} />
      <text x={panelX + PAD_PANEL_W / 2} y={panelY + 74} textAnchor="middle" fontSize={8.5} fontWeight={600} fill={P.track} fontFamily={MONO}>
        {mode === "euclid"
          ? `${euclid.k}/${n} · ↻${euclid.rotation} · ${Math.round((euclid.k / n) * 100)}%`
          : motionLabel ?? "DRAG TO GESTURE"}
      </text>
      </g>

      {/* ⤢ expand — the readout's right end opens the exploded editor */}
      <g onClick={onExpand} onPointerDown={(e) => e.stopPropagation()} style={{ cursor: "pointer" }}>
        <rect
          x={panelX + 164} y={panelY + 64} width={28} height={15} rx={7}
          fill={P.deep} stroke={P.track} strokeOpacity={0.7} strokeWidth={1}
        />
        <text
          x={panelX + 178} y={panelY + 75} textAnchor="middle" fontSize={11} fontWeight={600}
          fill={P.track} fontFamily={MONO}
        >
          ⤢
        </text>
      </g>

      {/* selection tools — Apply / Cancel live WITH the pad cluster. They
          only EXIST once the selection has staged a draft: dimmed dead
          buttons read as broken. With no draft, a caption explains when
          they'll appear instead. */}
      {hasDraft ? (
        ([
          { label: "✓ Apply", x: panelX + 2, primary: true, action: onApply },
          { label: "✕ Cancel", x: panelX + 102, primary: false, action: onCancel },
        ]).map((b) => (
          <g
            key={b.label}
            onClick={b.action}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={b.x} y={panelY + PAD_PANEL_H + 4} width={96} height={16} rx={3}
              fill={b.primary ? "rgba(255,165,0,0.12)" : P.deep}
              stroke={b.primary ? P.track : P.grid} strokeWidth={1}
            />
            <text
              x={b.x + 48} y={panelY + PAD_PANEL_H + 15} textAnchor="middle" fontSize={8.5} fontWeight={600}
              fontFamily={MONO} fill={b.primary ? P.track : P.label}
            >
              {b.label}
            </text>
          </g>
        ))
      ) : (
        <text
          x={panelX + PAD_PANEL_W / 2} y={panelY + PAD_PANEL_H + 15}
          textAnchor="middle" fontSize={8.5} fontFamily={MONO} fill={P.grid}
        >
          drag the pad or edit cells — Apply appears here
        </text>
      )}

      {/* the interactive face — drawn last so the whole pad is one drag target */}
      <circle
        cx={cx} cy={cy} r={34} fill="transparent" style={{ cursor: "grab" }}
        onPointerDown={onPadPointerDown}
        onPointerMove={onPadPointerMove}
        onPointerUp={onPadPointerUp}
        onPointerCancel={onPadPointerUp}
      />
      </g>
    </g>
  );
}
