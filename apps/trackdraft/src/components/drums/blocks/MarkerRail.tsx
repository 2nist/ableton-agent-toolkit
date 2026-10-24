import type { PointerEvent as ReactPointerEvent } from "react";
import type { Palette } from "../../../theme/palette";
import type { SectionMarkers } from "./transitionMarkers";

export const MARKER_ROW_H = 9;
/** Detour row sits directly under the bar ruler; the transition row under it. */
export const MARKER_BAND_H = MARKER_ROW_H * 2 + 2;

interface Props {
  markers: SectionMarkers;
  beatToX: number;
  /** Band top, in canvas px (the ruler occupies the space above it). */
  top: number;
  P: Palette;
  /** Click = focus that gesture's bars; shift-click = clear it back to auto. */
  onTransition: (e: ReactPointerEvent) => void;
  onDetour: (e: ReactPointerEvent) => void;
}

const MONO = "'IBM Plex Mono', monospace";

/**
 * The marker rail — tier 2's top edge. Handoffs the exporter WILL play are
 * drawn where they land (the section's last bars), and the authored detour
 * window is drawn at its own beat. Both are click targets, so the rail is a
 * control surface rather than an annotation: click focuses the gesture's
 * bars, shift-click clears an authored value back to the automatic plan.
 */
export default function MarkerRail({ markers, beatToX, top, P, onTransition, onDetour }: Props) {
  const { transition, detour } = markers;
  if (!transition && !detour) {
    return (
      <text
        x={4}
        y={top + 12}
        fontSize={7}
        fontFamily={MONO}
        letterSpacing={0.5}
        fill={P.grid}
        opacity={0.7}
        pointerEvents="none"
      >
        clean handoff · no detour
      </text>
    );
  }

  const detourY = top;
  const transY = top + MARKER_ROW_H + 2;

  const detourW = detour ? Math.max(6, (detour.endBeat - detour.startBeat) * beatToX - 1) : 0;
  const detourX = detour ? detour.startBeat * beatToX : 0;
  const detourLabel = detourW >= 54 ? "DETOUR" : detourW >= 26 ? "DET" : "";

  const transW = transition ? Math.max(6, (transition.endBeat - transition.startBeat) * beatToX - 1) : 0;
  const transX = transition ? transition.startBeat * beatToX : 0;
  const transName = transition ? transition.model.toUpperCase() : "";
  const transLabel =
    transW >= 62 ? `${transName}${transition && !transition.manual ? " · AUTO" : ""}` : transW >= 26 ? transName : "";

  const detourStroke = P.select;
  const transStroke = transition?.manual ? P.track : P.grid;

  return (
    <g>
      {detour && (
        <g
          onPointerDown={onDetour}
          style={{ cursor: "pointer" }}
        >
          <title>
            {`Detour — authored, ${Math.round(detour.endBeat - detour.startBeat)} beats. Click to focus its bars, shift-click to remove.`}
          </title>
          <rect
            x={detourX}
            y={detourY}
            width={detourW}
            height={MARKER_ROW_H}
            rx={2}
            fill="rgba(143,211,255,0.16)"
            stroke={detourStroke}
            strokeWidth={1}
          />
          {detourLabel && (
            <text
              x={detourX + detourW / 2}
              y={detourY + MARKER_ROW_H - 2.5}
              textAnchor="middle"
              fontSize={6.5}
              fontFamily={MONO}
              letterSpacing={0.6}
              fill={detourStroke}
              pointerEvents="none"
            >
              {detourLabel}
            </text>
          )}
        </g>
      )}

      {transition && (
        <g
          onPointerDown={onTransition}
          style={{ cursor: "pointer" }}
        >
          <title>
            {`${transName} transition — ${transition.bars} bar${transition.bars === 1 ? "" : "s"} at the section's end, ${transition.manual ? "authored. Click to focus, shift-click to clear back to auto." : "automatic (role plan). Click to focus the bars it owns."}`}
          </title>
          <rect
            x={transX}
            y={transY}
            width={transW}
            height={MARKER_ROW_H}
            rx={2}
            fill={transition.manual ? "rgba(232,181,74,0.16)" : "rgba(86,95,112,0.13)"}
            stroke={transStroke}
            strokeWidth={1}
            strokeDasharray={transition.manual ? undefined : "2 2"}
          />
          {/* the handoff direction: the gesture always points at the next section */}
          <path
            d={`M ${transX + transW - 6} ${transY + 2.2} l 4.2 ${MARKER_ROW_H / 2 - 2.2} l -4.2 ${MARKER_ROW_H / 2 - 2.2} z`}
            fill={transition.manual ? P.track : P.grid}
            opacity={transition.manual ? 0.95 : 0.8}
          />
          {transLabel && (
            <text
              x={transX + 4}
              y={transY + MARKER_ROW_H - 2.5}
              fontSize={6.5}
              fontFamily={MONO}
              letterSpacing={0.6}
              fill={transition.manual ? P.track : P.label}
              pointerEvents="none"
            >
              {transLabel}
            </text>
          )}
        </g>
      )}
    </g>
  );
}
