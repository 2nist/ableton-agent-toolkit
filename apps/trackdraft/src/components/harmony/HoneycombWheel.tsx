import { useMemo, useCallback, useState } from "react";
import { pitchClass } from "@music-theory/core";
import type { ScaleType, ChordQuality, NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordFromDegree, chordsToHoneycombText, chordDisplayName } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer } from "../../lib/harmony/audioPreview";
import {
  parseProgression,
  buildWalk,
  collapseRepeatsForLoopView,
  detectLoop,
  getRevealedCells,
  getWalkPathD,
  hexToPixel,
  hexPoints,
  HUES,
  ROMAN_UP,
  MODE_TO_SCALE_KEY,
  SCALE_INTERVALS,
  diatonicChordAt,
  degreeAt,
  DIRS,
  type RevealedCell,
} from "../../lib/harmony/honeycombWalk";

type HoneycombViewMode = "linear" | "loop";

const S = 34;

interface HoneycombWheelProps {
  keyName: NoteName;
  scale: ScaleType;
  chords: Chord[];
  beatsPerChord: number;
  selectedChordId: string | null;
  onSelectChord: (id: string | null) => void;
  onChangeChords: (chords: Chord[]) => void;
  /** Open the shared chord editor anchored at the click, when a placed cell is
   *  clicked. The linear progression row opens the same editor the same way —
   *  the hex is just a second surface onto one editing panel. */
  onEditChord?: (id: string, anchor: { x: number; y: number }) => void;
}

export default function HoneycombWheel({
  keyName,
  scale,
  chords,
  beatsPerChord,
  selectedChordId,
  onSelectChord,
  onChangeChords,
  onEditChord,
}: HoneycombWheelProps) {
  const keyPc = pitchClass(keyName);
  const scaleKey = MODE_TO_SCALE_KEY[scale as keyof typeof MODE_TO_SCALE_KEY] ?? "major";
  const intervals = SCALE_INTERVALS[scaleKey];
  const diatonicByDegree = useMemo(
    () => Array.from({ length: 7 }, (_, i) => diatonicChordAt(intervals, i)),
    [intervals],
  );

  const honeycombText = useMemo(() => chordsToHoneycombText(chords), [chords]);
  const { steps } = useMemo(() => parseProgression(honeycombText), [honeycombText]);
  const walk = useMemo(() => buildWalk(steps), [steps]);

  // "linear" is the straight-line walk above (one hex per chord, only a
  // literal back-and-forth reuses a hex). "loop" collapses a detected
  // repeating vamp onto a single lap for a compact view — same step
  // order/count, just reused coordinates. Rendering and click-hit-testing
  // below key off `displayWalk`; `walk` stays the source of truth for
  // indexing into `chords`/`steps` (both arrays share its length/order).
  const [viewMode, setViewMode] = useState<HoneycombViewMode>("linear");
  const displayWalk = useMemo(
    () => (viewMode === "loop" ? collapseRepeatsForLoopView(walk, steps) : walk),
    [viewMode, walk, steps],
  );

  // The "current"/"choice" anchor is always the true end of the
  // progression, independent of whichever chord is selected for editing —
  // selecting an earlier chord to inspect must never relocate where a
  // click-to-add lands (see honeycomb design spec: cell position vs.
  // sequence step are decoupled).
  const endStep = displayWalk.length ? displayWalk.length - 1 : 0;

  const revealed = useMemo(() => {
    const cells = getRevealedCells(displayWalk, endStep, "full");
    // A brand-new section has an empty walk, so getRevealedCells returns
    // nothing. Seed a starter ring — the tonic at the origin plus its six
    // diatonic neighbours — so every scale degree is an addable choice cell
    // right away, rather than a single dead-end cell with nothing to click.
    if (displayWalk.length === 0) {
      return [
        { q: 0, r: 0, d: 0, type: "choice" as const },
        ...DIRS.map(([a, b]) => ({ q: a, r: b, d: degreeAt(a, b), type: "choice" as const })),
      ];
    }
    return cells;
  }, [displayWalk, endStep]);

  // Separately, which walk step (if any) corresponds to the chord picked
  // for editing — used only for a "selected" highlight, never for choice-
  // cell placement.
  const selectedStep = useMemo(() => {
    if (!selectedChordId) return -1;
    const idx = chords.findIndex((c) => c.id === selectedChordId);
    return idx >= 0 && idx < displayWalk.length ? idx : -1;
  }, [chords, selectedChordId, displayWalk.length]);

  // Step-order badges, one per unique cell — a repeating progression (e.g.
  // I-IV-I-IV) revisits the same cell many times, and stacking one opaque
  // badge per visit at dead-center used to completely bury the roman
  // numeral/chord name under whichever visit drew last. Grouped by
  // position and shown as "first-visit×count" in a corner instead, so the
  // main label always stays legible.
  const walkBadges = useMemo(() => {
    const byCell = new Map<string, { q: number; r: number; indices: number[] }>();
    displayWalk.forEach((p, i) => {
      const key = `${p.q},${p.r}`;
      const entry = byCell.get(key);
      if (entry) entry.indices.push(i + 1);
      else byCell.set(key, { q: p.q, r: p.r, indices: [i + 1] });
    });
    return Array.from(byCell.values());
  }, [displayWalk]);

  const loop = useMemo(() => detectLoop(steps, displayWalk), [steps, displayWalk]);
  const loopVec = loop?.translated
    ? { x: loop.dq * S * Math.sqrt(3), y: loop.dr * S * 1.5 }
    : null;

  const pathD = useMemo(
    () => getWalkPathD(displayWalk, endStep, "full", S),
    [displayWalk, endStep],
  );

  // SVG bounds — guard against empty (no chords) section
  const svgDims = useMemo(() => {
    const allPts: { x: number; y: number }[] = [];
    if (revealed.length > 0) {
      allPts.push(...revealed.map((c) => hexToPixel(c.q, c.r, S)));
    }
    if (displayWalk.length > 0) {
      allPts.push(...displayWalk.map((p) => hexToPixel(p.q, p.r, S)));
      if (loopVec) {
        const first = hexToPixel(displayWalk[0].q, displayWalk[0].r, S);
        allPts.push({ x: first.x + loopVec.x, y: first.y + loopVec.y });
      }
    }
    if (allPts.length === 0) {
      // Fallback: show origin cell
      allPts.push(hexToPixel(0, 0, S));
    }
    const xs = allPts.map((p) => p.x);
    const ys = allPts.map((p) => p.y);
    const pad = S * 2.5;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    return {
      vb: [minX, minY, Math.max(220, maxX - minX), Math.max(180, maxY - minY)] as const,
      w: Math.max(220, maxX - minX + 16),
      h: Math.max(180, maxY - minY + 16),
    };
  }, [revealed, displayWalk, loopVec]);

  const addChordAtDegree = useCallback((deg: number) => {
    const diatonic = diatonicByDegree[deg].triad;
    const degreeLabel = diatonic.minor
      ? ROMAN_UP[deg].toLowerCase()
      : ROMAN_UP[deg];
    const rootPc = intervals[deg];
    const newChord = chordFromDegree(
      keyPc, keyName, degreeLabel,
      (diatonic.minor ? "min" : "maj") as ChordQuality,
      rootPc, beatsPerChord,
    );
    const updated = [...chords, newChord];
    onChangeChords(updated);
    onSelectChord(newChord.id);
    getPreviewPlayer().playChordObject(newChord, 1);
  }, [chords, keyPc, keyName, intervals, diatonicByDegree, beatsPerChord, onChangeChords, onSelectChord]);

  const selectChordAtCell = useCallback((q: number, r: number, anchor: { x: number; y: number }) => {
    if (!displayWalk.length) return;
    for (let i = displayWalk.length - 1; i >= 0; i--) {
      if (displayWalk[i].q === q && displayWalk[i].r === r) {
        const chord = chords[i];
        if (chord) {
          onSelectChord(chord.id);
          getPreviewPlayer().playChordObject(chord, 1);
          onEditChord?.(chord.id, anchor);
        }
        return;
      }
    }
  }, [displayWalk, chords, onSelectChord, onEditChord]);

  const handleCellClick = useCallback((cell: RevealedCell, e: React.MouseEvent) => {
    if (cell.type === "choice") addChordAtDegree(cell.d);
    else selectChordAtCell(cell.q, cell.r, { x: e.clientX, y: e.clientY });
  }, [addChordAtDegree, selectChordAtCell]);

  const vbStr = `${svgDims.vb[0]} ${svgDims.vb[1]} ${svgDims.vb[2]} ${svgDims.vb[3]}`;

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute", top: 4, right: 4, zIndex: 1,
          display: "flex", gap: 2, fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
        {(["linear", "loop"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              fontSize: 9, padding: "2px 7px", borderRadius: 4, cursor: "pointer",
              border: `1px solid ${viewMode === mode ? "#E8B54A" : "#3A3F4B"}`,
              background: viewMode === mode ? "#3A2F16" : "transparent",
              color: viewMode === mode ? "#F2D9A0" : "#8B94A1",
            }}
            title={
              mode === "linear"
                ? "One hex per chord (only immediate back-and-forth reuses a hex)"
                : "Collapse repeating vamps onto a single lap"
            }
          >
            {mode === "linear" ? "Linear" : "Loop"}
          </button>
        ))}
      </div>
      <svg
        viewBox={vbStr}
        style={{ width: svgDims.w, height: svgDims.h, display: "block" }}
      >
        <defs>
          <filter id="hw-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="hw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#E8B54A" />
          </marker>
        </defs>

        {pathD && (
          <path d={pathD} fill="none" stroke="#F5E7C8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} filter="url(#hw-glow)" style={{ pointerEvents: "none" }} />
        )}

        {loop && loop.translated && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={hexToPixel(displayWalk[0].q, displayWalk[0].r, S).x} y1={hexToPixel(displayWalk[0].q, displayWalk[0].r, S).y}
              x2={hexToPixel(displayWalk[displayWalk.length - 1].q, displayWalk[displayWalk.length - 1].r, S).x} y2={hexToPixel(displayWalk[displayWalk.length - 1].q, displayWalk[displayWalk.length - 1].r, S).y}
              stroke="#E8B54A" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#hw-arrow)" opacity={0.75} />
          </g>
        )}

        {revealed.map((cell) => {
          const { q, r, d, type } = cell;
          const cx = hexToPixel(q, r, S).x;
          const cy = hexToPixel(q, r, S).y;
          const isCurrent = type === "current";
          const isChoice = type === "choice";
          const isSelected = selectedStep >= 0 && displayWalk[selectedStep].q === q && displayWalk[selectedStep].r === r;

          const romanLabel = diatonicByDegree[d].triad.minor ? ROMAN_UP[d].toLowerCase() : ROMAN_UP[d];
          const rootPc = intervals[d];
          const subLabel = chordDisplayName((keyPc + rootPc) % 12, diatonicByDegree[d].triad.minor ? "min" : "maj", keyName);
          const hue = HUES[d];
          const labelSize = romanLabel.length > 3 ? 10 : romanLabel.length > 2 ? 12 : 14;

          return (
            <g key={`${q},${r}`} transform={`translate(${cx}, ${cy})`} style={{ cursor: "pointer" }}
              onClick={(e) => handleCellClick(cell, e)}
              onContextMenu={(e) => { e.preventDefault(); handleCellClick(cell, e); }}
            >
              <polygon points={hexPoints(S - 2)}
                fill={isChoice ? "#12161D" : hue.fill}
                fillOpacity={isChoice ? 0.5 : 1}
                stroke={isCurrent ? hue.rim : isChoice ? hue.rim + "66" : hue.rim + "AA"}
                strokeWidth={isCurrent ? 2.5 : isChoice ? 1.4 : 1.2}
                strokeDasharray={isChoice ? "4 3" : undefined}
                style={isCurrent ? { filter: "url(#hw-glow)" } : undefined}
              />
              {isSelected && (
                <polygon points={hexPoints(S + 2)} fill="none" stroke="#E8B54A" strokeWidth={2} strokeDasharray="3 2" style={{ pointerEvents: "none" }} />
              )}
              <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
                fontFamily="'IBM Plex Mono', monospace" fontSize={labelSize} fontWeight={600}
                fill={isChoice ? "#8B94A1" : hue.ink} style={{ pointerEvents: "none" }}>
                {romanLabel}
              </text>
              <text x={0} y={S * 0.38} textAnchor="middle"
                fontFamily="'IBM Plex Mono', monospace" fontSize={9}
                fill={isChoice ? "#57606D" : hue.rim} style={{ pointerEvents: "none" }}>
                {subLabel}
              </text>
            </g>
          );
        })}

        {walkBadges.map(({ q, r, indices }) => {
          const center = hexToPixel(q, r, S);
          const bx = center.x + S * 0.6;
          const by = center.y - S * 0.6;
          const label = indices.length > 1 ? `${indices[0]}×${indices.length}` : String(indices[0]);
          return (
            <g key={`${q},${r}`} style={{ pointerEvents: "none" }}>
              <circle cx={bx} cy={by} r={9} fill="#0E1116" stroke="#F5E7C8" strokeWidth={1.5} />
              <text x={bx} y={by + 1} textAnchor="middle" dominantBaseline="middle"
                fontFamily="'IBM Plex Mono', monospace" fontSize={8} fontWeight={600} fill="#F5E7C8">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
