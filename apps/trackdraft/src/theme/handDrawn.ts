import type { CSSProperties } from "react";

/** Deterministic "drawn by hand" jitter for a repeated grid cell.
 *
 *  Every value comes from a hash of the cell's index, never from
 *  `Math.random()`: a cell that re-randomised on each render would shimmer
 *  while the transport runs, and one that re-measured would re-rasterise. This
 *  is pure arithmetic on an integer, so the same cell looks the same in every
 *  frame, every theme switch, and every remount.
 *
 *  The trick is entirely in cheap compositor-friendly properties — corner
 *  radii, a sub-degree rotation, a 1–3% scale, and a second offset outline
 *  drawn with `::before`. No filters: `filter` on an animated cell costs a
 *  re-rasterisation per repaint. */
export function handCell(seed: number): CSSProperties {
  const h = (seed: number, salt: number) => {
    let x = Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
    x ^= x >>> 13;
    x = Math.imul(x, 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  };
  const pick = (salt: number, lo: number, hi: number) => lo + (h(seed, salt) % (hi - lo + 1));
  /* The amplitudes are the prototype's, not the timid ones that were here
     first: 1–3px radii on a 12px cell and a ±0.66° lean averaged out to
     "nothing happened" at 1× zoom, which is how a whole hand-drawn layer
     ended up invisible. 1–4px, ±1.32° and 0.95–1.03 are what read as drawn. */
  return {
    "--r1": `${pick(0, 1, 4)}px`,
    "--r2": `${pick(1, 1, 4)}px`,
    "--r3": `${pick(2, 1, 4)}px`,
    "--r4": `${pick(3, 1, 4)}px`,
    "--s1": `${pick(4, 1, 4)}px`,
    "--s2": `${pick(5, 1, 4)}px`,
    "--s3": `${pick(6, 1, 4)}px`,
    "--s4": `${pick(7, 1, 4)}px`,
    "--lean": `${((pick(8, 0, 6) - 3) * 0.44).toFixed(2)}deg`,
    "--grow": (0.952 + pick(9, 0, 9) * 0.008).toFixed(3),
  } as CSSProperties;
}

/** Corner-radius wobble for an SVG cell: `rx`/`ry` can't be set per corner, so
 *  the shape is an ELLIPSE whose two axes disagree by up to ~9% and which leans
 *  up to ±1.2°. A single jittered radius (the old version, ±0.45px) was
 *  indistinguishable from a circle at sequencer sizes. */
export function handRadius(seed: number, base: number): { rx: number; ry: number; rotate: number } {
  const h = (Math.imul(seed + 1, 0x9e3779b1) >>> 8) % 1000;
  const wobble = (bits: number) => 1 + ((((h >>> bits) % 5) - 2) * 0.045);
  return {
    rx: Math.max(0.5, base * wobble(0)),
    ry: Math.max(0.5, base * wobble(8)),
    rotate: (((h >>> 4) % 7) - 3) * 0.4,
  };
}
