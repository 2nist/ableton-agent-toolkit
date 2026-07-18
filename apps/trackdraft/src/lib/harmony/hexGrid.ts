/** Axial hex-grid math for the static Tonnetz-style Harmony Wheel.
 *  The degree(q,r) formula and the general "hex cell = scale degree"
 *  idea are reimplemented from HarmonicHoneycomb.tsx (an orphaned
 *  component from a defunct app, kept only as a design reference per
 *  the plan) — this is a fresh implementation, not extracted code, and
 *  renders a static relatedness map rather than a dynamic walk. */

export interface HexCell {
  q: number;
  r: number;
  degreeIndex: number; // 0-6, index into a mode's `degrees` array
}

function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

function degreeAt(q: number, r: number): number {
  return (((3 * q + r) % 7) + 7) % 7;
}

/** One representative hex cell per diatonic degree (0-6), each the
 *  closest-to-origin cell mapping to that degree — avoids rendering the
 *  same degree repeated across the infinite tiling. */
export function getDiatonicHexCells(range = 3): HexCell[] {
  const best = new Map<number, HexCell>();

  for (let q = -range; q <= range; q++) {
    for (let r = -range; r <= range; r++) {
      const degreeIndex = degreeAt(q, r);
      const dist = hexDistance(q, r);
      const existing = best.get(degreeIndex);
      if (!existing || dist < hexDistance(existing.q, existing.r)) {
        best.set(degreeIndex, { q, r, degreeIndex });
      }
    }
  }

  return Array.from(best.values()).sort((a, b) => a.degreeIndex - b.degreeIndex);
}

/** Pointy-top axial -> pixel conversion. */
export function hexToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r);
  const y = size * (1.5 * r);
  return { x, y };
}

/** SVG polygon points for a pointy-top hex of the given size, centered
 *  at (0,0) in local coordinates (caller translates). */
export function hexPoints(size: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    points.push(`${size * Math.cos(angle)},${size * Math.sin(angle)}`);
  }
  return points.join(" ");
}
