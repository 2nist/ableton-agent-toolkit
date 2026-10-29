import { usePalette } from "../../../theme/palette";

/** One chord's slot in the lane — already projected, so the chip sits exactly
 *  under the box the floor drew for it. */
export interface EffectChip {
  /** Unique per chip — a chord that loops into a second pass has two chips. */
  key: string;
  chordId: string;
  /** Left and right edge in px, from the same projection the boxes use. */
  x0: number;
  x1: number;
  /** `undefined` = a plain block chord (no effect). */
  style?: "strum" | "pulse" | "arp";
  /** The chord's Roman numeral, so a chip is identifiable when narrow. */
  roman: string;
}

export interface EffectsLaneProps {
  chips: readonly EffectChip[];
  width: number;
  height: number;
  /** The effect cycle: none → strum → pulse → arp → none. */
  onCycle: (chordId: string) => void;
}

/**
 * The per-chord performance lane — DAW-automation shaped, sitting under the
 * chord boxes on the same time axis.
 *
 * This is where `chord.performance` is edited. It used to live in a lane
 * inside `ProgressionEditor`, which the Harmony page only showed behind
 * Compose → "Harmonic rhythm" and only when a persisted flag happened to be
 * on, so the effect was effectively unreachable from the surface people
 * actually write on. The schema's own note on `ChordPerformanceEffect` says
 * it belongs "in a per-step lane … rather than buried in a dropdown", so this
 * is the lane it was describing.
 */
export default function EffectsLane({
  chips,
  width,
  height,
  onCycle,
}: EffectsLaneProps) {
  const P = usePalette();
  // The lane fills the band the floor gives it, minus a hairline margin — a
  // chip taller than the band is clipped by the viewBox and stops being a
  // usable click target.
  const rowY = 2;
  const laneH = Math.max(12, height - rowY - 4);

  /** A style's own colour. "No effect" is the absence of one, drawn as a
   *  hollow slot, so the eye lands on what was chosen rather than on the gaps. */
  const fillFor = (style: EffectChip["style"]): string => {
    if (style === "strum") return P.select;
    if (style === "pulse") return P.track;
    if (style === "arp") return P.cream;
    return "transparent";
  };

  return (
    <svg
      width={Math.max(1, width)}
      height={height}
      viewBox={`0 0 ${Math.max(1, width)} ${height}`}
      className="block"
      role="group"
      aria-label="Chord performance effects"
    >
      {chips.map((chip) => {
        const x0 = Math.max(0, Math.min(chip.x0, width));
        const x1 = Math.max(0, Math.min(chip.x1, width));
        const w = Math.max(6, x1 - x0 - 2);
        const label = chip.style ?? "—";
        const empty = !chip.style;
        const description = empty
          ? "no effect — click for strum"
          : `${label} — click to cycle`;
        return (
          <g key={chip.key}>
            {/* The RECT is the control, not the group: an SVG <g> has no layout
                box of its own, so it is neither hoverable nor clickable in a
                real browser (and screen readers skip it). */}
            <rect
              x={x0 + 1}
              y={rowY}
              width={w}
              height={laneH}
              rx={3}
              fill={empty ? P.label : fillFor(chip.style)}
              fillOpacity={empty ? 0.1 : 0.3}
              // Most chords carry no effect, so the empty slot IS the lane's
              // normal state — it has to read as an editable row, not as a
              // blank strip, on both the dark plate and the paper theme.
              stroke={empty ? P.label : fillFor(chip.style)}
              strokeOpacity={empty ? 0.45 : 0.95}
              strokeDasharray={empty ? "3 3" : undefined}
              strokeWidth={1}
              className="cursor-pointer focus:outline-none"
              role="button"
              tabIndex={0}
              aria-label={`${chip.roman}: ${description}`}
              data-chord-id={chip.chordId}
              data-effect={label}
              onClick={() => onCycle(chip.chordId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCycle(chip.chordId);
                }
              }}
            >
              <title>{`${chip.roman} · ${description}`}</title>
            </rect>
            {w > 34 && (
              <text
                x={x0 + 1 + w / 2}
                y={rowY + laneH / 2 + 3.5}
                textAnchor="middle"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize={9}
                fill={empty ? P.label : P.scene}
                fillOpacity={empty ? 0.55 : 0.95}
                pointerEvents="none"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
