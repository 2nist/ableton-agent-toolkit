/** A compact tension readout for the Compose and Study desks.
 *
 *  Pure SVG over the analysis's `curve` — the same values the Study table
 *  prints, so the drawing and the numbers can't disagree. No interaction:
 *  this is a reading, not a control. */
export default function TensionCurve({
  values,
  labels,
  positions,
  width = 640,
  height = 64,
}: {
  values: number[];
  labels: string[];
  /** Where each point sits along the strip, 0–1. Omit for even spacing. */
  positions?: number[];
  /** Drawing width in px. Pass the real box width so a position of 0.5 lands
   *  on the middle of the strip instead of a letterboxed 640-unit chart. */
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;

  const padX = 14;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;

  const points = values.map((value, index) => ({
    x:
      positions?.[index] !== undefined
        ? padX + Math.max(0, Math.min(1, positions[index] ?? 0)) * innerW
        : padX + (values.length > 1 ? index * step : innerW / 2),
    y: padY + (1 - Math.max(0, Math.min(1, value))) * innerH,
    value,
    label: labels[index] ?? "",
  }));

  const path = points
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full text-inkMuted"
      style={{ height }}
      role="img"
      aria-label="Tension across the progression"
    >
      <line
        x1={padX}
        y1={height - padY}
        x2={width - padX}
        y2={height - padY}
        stroke="currentColor"
        strokeOpacity="0.35"
      />
      <line
        x1={padX}
        y1={padY}
        x2={width - padX}
        y2={padY}
        stroke="currentColor"
        strokeOpacity="0.18"
        strokeDasharray="3 3"
      />
      <polyline
        points={path}
        fill="none"
        className="text-accent"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((point, index) => (
        // Index in the key: at ALL two chords can print the same numeral at
        // the same rounded x, and React then drops one of them.
        <g key={`${index}-${point.label}`}>
          <circle
            cx={point.x}
            cy={point.y}
            r={3}
            fill="currentColor"
            className={point.value > 0.6 ? "text-danger" : "text-accent"}
          >
            <title>{`${point.label} · tension ${point.value.toFixed(2)}`}</title>
          </circle>
          <text
            x={point.x}
            y={height - 1}
            textAnchor="middle"
            fontSize="7.5"
            fill="currentColor"
            fontFamily="'IBM Plex Mono', monospace"
          >
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
