import { useMemo } from "react";
import { pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordDisplayName, chordsToHoneycombText } from "../../lib/harmony/chordBuilder";
import {
  parseProgression,
  buildWalk,
  getWalkPathD,
  hexToPixel,
  hexPoints,
  degreeAt,
} from "../../lib/harmony/honeycombWalk";
import { usePalette } from "../../theme/palette";

/** Read-only harmony hex readout — the Studio console's counterpart to the
 *  Harmony tab's *editable* `HoneycombWheel`. Renders a section's authored
 *  chord walk on the same hex geometry (identical cell coordinates/colors to
 *  the editor wheel, so the two views agree about where I–IV–V live), but:
 *    · no empty "add a chord" choice cells — only the actual progression;
 *    · each cell is labelled with the chord's REAL symbol (its roman numeral
 *      + root-letter quality, e.g. "V7 · G7"), not a diatonic guess, so the
 *      console tells you the truth about an altered/borrowed/extended chord;
 *    · `activeChordId` lights one cell amber as the playhead crosses it.
 *  Pure presentation — nothing here edits the song. */
interface HexReadoutProps {
  chords: Chord[];
  /** Effective key for spelling the chord letters beneath each hex (the
   *  section's own key when it modulates, else the song's). */
  keyName: NoteName;
  /** Id of the authored chord currently sounding (from the transport).
   *  When null/absent nothing is lit. */
  activeChordId?: string | null;
}

const S = 26;

/** Group the walked cells by unique coordinate, remembering the first chord
 *  that occupies each and how many steps visit it (so a repeating vamp
 *  renders once with a ×n badge, like the editor wheel's step badges). */
interface VisitedCell {
  q: number;
  r: number;
  firstChordIndex: number;
  count: number;
  d: number;
}

export default function HexReadout({ chords, keyName, activeChordId }: HexReadoutProps) {
  const palette = usePalette();
  const geometry = useMemo(() => {
    // Reuse the editor wheel's exact parse pipeline so identical chords land
    // on identical cells (same projection, accidentals shifted the same way).
    const text = chordsToHoneycombText(chords);
    const { steps } = parseProgression(text);
    const walk = steps.length > 0 ? buildWalk(steps) : [];

    const byCell = new Map<string, VisitedCell>();
    walk.forEach((p, i) => {
      const key = `${p.q},${p.r}`;
      const existing = byCell.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        byCell.set(key, { q: p.q, r: p.r, firstChordIndex: i, count: 1, d: degreeAt(p.q, p.r) });
      }
    });

    // Which cell (if any) the sounding chord occupies — the walk is 1:1 with
    // the authored `chords` array, so a chord id maps straight to a step.
    const activeIdx =
      activeChordId == null ? -1 : chords.findIndex((c) => c.id === activeChordId);
    const activeCell =
      activeIdx >= 0 && activeIdx < walk.length ? byCell.get(`${walk[activeIdx].q},${walk[activeIdx].r}`) : undefined;

    return { walk, cells: Array.from(byCell.values()), activeCell };
  }, [chords, activeChordId]);

  const dims = useMemo(() => {
    const pts = geometry.cells.map((c) => hexToPixel(c.q, c.r, S));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = S * 2.2;
    const minX = xs.length ? Math.min(...xs) - pad : -pad;
    const minY = ys.length ? Math.min(...ys) - pad : -pad;
    const maxX = xs.length ? Math.max(...xs) + pad : pad;
    const maxY = ys.length ? Math.max(...ys) + pad : pad;
    return {
      vb: [minX, minY, Math.max(150, maxX - minX), Math.max(120, maxY - minY)] as const,
      w: Math.max(150, maxX - minX),
      h: Math.max(120, maxY - minY),
    };
  }, [geometry.cells]);

  const pathD = useMemo(
    () => getWalkPathD(geometry.walk, geometry.walk.length ? geometry.walk.length - 1 : 0, "full", S),
    [geometry.walk],
  );

  if (chords.length === 0 || geometry.cells.length === 0) {
    return <p className="text-2xs text-inkMuted/60 italic font-mono">No chords yet — open Harmony to build one.</p>;
  }

  const vbStr = `${dims.vb[0]} ${dims.vb[1]} ${dims.vb[2]} ${dims.vb[3]}`;

  return (
    <svg
      viewBox={vbStr}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", maxWidth: dims.w, maxHeight: 240, display: "block" }}
      className="mx-auto"
      role="img"
      aria-label="Harmony hex readout"
    >
      <defs>
        <filter id="hx-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke={palette.cream}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
          style={{ pointerEvents: "none" }}
        />
      )}

      {geometry.cells.map((cell) => {
        const { q, r, d, firstChordIndex, count } = cell;
        const cx = hexToPixel(q, r, S).x;
        const cy = hexToPixel(q, r, S).y;
        const chord = chords[firstChordIndex];
        const hue = palette.hues[d] ?? palette.hues[0];
        const isActive = geometry.activeCell?.q === q && geometry.activeCell?.r === r;
        const roman = chord?.romanNumeral ?? "";
        const letter = chord ? chordDisplayName(pitchClass(chord.root), chord.quality, keyName) : "";
        const romanSize = roman.length > 3 ? 9 : roman.length > 2 ? 10 : 11;

        return (
          <g key={`${q},${r}`} transform={`translate(${cx}, ${cy})`}>
            <polygon
              points={hexPoints(S - 2)}
              fill={hue.fill}
              fillOpacity={isActive ? 1 : 0.9}
              stroke={hue.rim}
              strokeOpacity={isActive ? 1 : 0.55}
              strokeWidth={isActive ? 2 : 1.2}
              style={isActive ? { filter: "url(#hx-glow)" } : undefined}
            />
            {isActive && (
              <polygon
                points={hexPoints(S + 3)}
                fill="none"
                stroke={palette.track}
                strokeWidth={1.8}
                style={{ pointerEvents: "none" }}
              />
            )}
            <text
              x={0}
              y={-2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={romanSize}
              fontWeight={600}
              fill={isActive ? palette.cream : hue.ink}
              style={{ pointerEvents: "none" }}
            >
              {roman}
            </text>
            <text
              x={0}
              y={S * 0.34}
              textAnchor="middle"
              fontFamily="'IBM Plex Mono', monospace"
              fontSize={7.5}
              fill={isActive ? palette.hues[0].ink : hue.rim}
              opacity={isActive ? 1 : 0.8}
              style={{ pointerEvents: "none" }}
            >
              {letter}
            </text>
            {count > 1 && (
              <g style={{ pointerEvents: "none" }}>
                <circle cx={S * 0.62} cy={-S * 0.62} r={8} fill={palette.well} stroke={palette.cream} strokeWidth={1.2} />
                <text
                  x={S * 0.62}
                  y={-S * 0.62 + 0.8}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily="'IBM Plex Mono', monospace"
                  fontSize={7}
                  fontWeight={600}
                  fill={palette.cream}
                >
                  ×{count}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

