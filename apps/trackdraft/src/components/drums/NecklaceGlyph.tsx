/** The canonical Euclidean-rhythm diagram (Toussaint's "rhythm
 *  necklace"): a reference ring at `(cx, cy)` with radius `radius`, and
 *  the given onset fractions (0–1 around the loop) connected in order.
 *  Points sit at their true, unquantized position — this renders real
 *  E-GMD microtiming as-is rather than snapping it to a grid, since the
 *  human wobble away from a tidy shape *is* the feel data.
 *
 *  Absolute-coordinate (not its own viewBox), so it composes directly
 *  into a larger shared canvas (`DrumsView`'s whole-song timeline) as
 *  well as standing alone inside a small per-glyph `<svg>`
 *  (`DrumNecklacePreview`). */
export default function NecklaceGlyph({
  cx,
  cy,
  radius,
  hits,
  color,
  /** The ring's grid resolution — `n` in E(k,n). Draws `steps` small
   *  reference ticks around the ring; the `hits` are the `k` onsets at
   *  their true positions among them. Absent → just the dashed ring
   *  (legacy data / unknown grid). */
  steps,
  /** An opaque disc drawn first, so the glyph reads as a clean badge
   *  sitting on whatever's behind it (a lane line, a section band)
   *  rather than tangled with it. Omit for a plain per-glyph `<svg>`
   *  that has nothing behind it. */
  backdrop,
}: {
  cx: number;
  cy: number;
  radius: number;
  hits: number[];
  color: string;
  steps?: number;
  backdrop?: string;
}) {
  const pt = (frac: number): [number, number] => {
    const a = -Math.PI / 2 + frac * Math.PI * 2;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  };
  const pts = hits.map(pt);

  return (
    <g>
      {backdrop && <circle cx={cx} cy={cy} r={radius + 3} fill={backdrop} />}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#3A3F4B" strokeWidth={1.4} strokeDasharray="2 3" />
      {steps && steps > 0 &&
        Array.from({ length: steps }).map((_, i) => {
          // Cap the grid so dense loops (16+ steps) don't blur into a solid
          // ring — draw at most ~16 evenly-spaced reference ticks.
          if (steps > 16 && i % Math.ceil(steps / 16) !== 0) return null;
          const [gx, gy] = pt(i / steps);
          return <circle key={`grid-${i}`} cx={gx} cy={gy} r={1} fill="#3A3F4B" fillOpacity={0.6} />;
        })}
      {pts.length >= 2 && (
        <path
          d={"M " + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ") + (pts.length >= 3 ? " Z" : "")}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
        />
      )}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2} fill={color} />
      ))}
    </g>
  );
}
