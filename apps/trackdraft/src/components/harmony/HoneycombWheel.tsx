import { useMemo, useCallback, useRef, useState } from "react";
import { pitchClass } from "@music-theory/core";
import type { ScaleType, ChordQuality, NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { chordFromDegree, chordsToHoneycombText, chordDisplayName } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer } from "../../lib/harmony/audioPreview";
import {
  parseProgression,
  buildWalk,
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
  type RevealedCell,
} from "../../lib/harmony/honeycombWalk";

const S = 34;

interface HoneycombWheelProps {
  keyName: NoteName;
  scale: ScaleType;
  chords: Chord[];
  beatsPerChord: number;
  selectedChordId: string | null;
  onSelectChord: (id: string | null) => void;
  onChangeChords: (chords: Chord[]) => void;
}

export default function HoneycombWheel({
  keyName,
  scale,
  chords,
  beatsPerChord,
  selectedChordId,
  onSelectChord,
  onChangeChords,
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

  // The "current"/"choice" anchor is always the true end of the
  // progression, independent of whichever chord is selected for editing —
  // selecting an earlier chord to inspect must never relocate where a
  // click-to-add lands (see honeycomb design spec: cell position vs.
  // sequence step are decoupled).
  const endStep = walk.length ? walk.length - 1 : 0;

  const revealed = useMemo(() => {
    const cells = getRevealedCells(walk, endStep, "full");
    // A brand-new section has an empty walk, so getRevealedCells returns
    // nothing to render — the hex would show up completely blank with no
    // way to start a progression. Seed the origin as a choice cell so
    // there's always something clickable.
    if (walk.length === 0) {
      return [{ q: 0, r: 0, d: 0, type: "choice" as const }];
    }
    return cells;
  }, [walk, endStep]);

  // Separately, which walk step (if any) corresponds to the chord picked
  // for editing — used only for a "selected" highlight, never for choice-
  // cell placement.
  const selectedStep = useMemo(() => {
    if (!selectedChordId) return -1;
    const idx = chords.findIndex((c) => c.id === selectedChordId);
    return idx >= 0 && idx < walk.length ? idx : -1;
  }, [chords, selectedChordId, walk.length]);

  const loop = useMemo(() => detectLoop(steps, walk), [steps, walk]);
  const loopVec = loop?.translated
    ? { x: loop.dq * S * Math.sqrt(3), y: loop.dr * S * 1.5 }
    : null;

  const pathD = useMemo(() => getWalkPathD(walk, endStep, "full", S), [walk, endStep]);

  // SVG bounds — guard against empty (no chords) section
  const svgDims = useMemo(() => {
    const allPts: { x: number; y: number }[] = [];
    if (revealed.length > 0) {
      allPts.push(...revealed.map((c) => hexToPixel(c.q, c.r, S)));
    }
    if (walk.length > 0) {
      allPts.push(...walk.map((p) => hexToPixel(p.q, p.r, S)));
      if (loopVec) {
        const first = hexToPixel(walk[0].q, walk[0].r, S);
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
  }, [revealed, walk, loopVec]);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    const k = svgDims.vb[2] / 500;
    setPan((p) => ({ x: p.x + dx * k, y: p.y + dy * k }));
    dragRef.current = { x: e.clientX, y: e.clientY };
  }, [svgDims.vb]);
  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

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

  const selectChordAtCell = useCallback((q: number, r: number) => {
    if (!walk.length) return;
    for (let i = walk.length - 1; i >= 0; i--) {
      if (walk[i].q === q && walk[i].r === r) {
        const chord = chords[i];
        if (chord) {
          onSelectChord(chord.id);
          getPreviewPlayer().playChordObject(chord, 1);
        }
        return;
      }
    }
  }, [walk, chords, onSelectChord]);

  const handleCellClick = useCallback((cell: RevealedCell) => {
    if (cell.type === "choice") addChordAtDegree(cell.d);
    else selectChordAtCell(cell.q, cell.r);
  }, [addChordAtDegree, selectChordAtCell]);

  const vbStr = `${svgDims.vb[0] + pan.x} ${svgDims.vb[1] + pan.y} ${svgDims.vb[2]} ${svgDims.vb[3]}`;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={vbStr}
        style={{ width: svgDims.w, height: svgDims.h, display: "block", cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
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
            <line x1={hexToPixel(walk[0].q, walk[0].r, S).x} y1={hexToPixel(walk[0].q, walk[0].r, S).y}
              x2={hexToPixel(walk[walk.length - 1].q, walk[walk.length - 1].r, S).x} y2={hexToPixel(walk[walk.length - 1].q, walk[walk.length - 1].r, S).y}
              stroke="#E8B54A" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#hw-arrow)" opacity={0.75} />
          </g>
        )}

        {revealed.map((cell) => {
          const { q, r, d, type } = cell;
          const cx = hexToPixel(q, r, S).x;
          const cy = hexToPixel(q, r, S).y;
          const isCurrent = type === "current";
          const isChoice = type === "choice";
          const isSelected = selectedStep >= 0 && walk[selectedStep].q === q && walk[selectedStep].r === r;

          const romanLabel = diatonicByDegree[d].triad.minor ? ROMAN_UP[d].toLowerCase() : ROMAN_UP[d];
          const rootPc = intervals[d];
          const subLabel = chordDisplayName((keyPc + rootPc) % 12, diatonicByDegree[d].triad.minor ? "min" : "maj", keyName);
          const hue = HUES[d];
          const labelSize = romanLabel.length > 3 ? 10 : romanLabel.length > 2 ? 12 : 14;

          return (
            <g key={`${q},${r}`} transform={`translate(${cx}, ${cy})`} style={{ cursor: "pointer" }}
              onClick={() => handleCellClick(cell)}
              onContextMenu={(e) => { e.preventDefault(); handleCellClick(cell); }}
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

        {walk.map((p, i) =>
          i > 0 && walk[i].q === walk[i - 1].q && walk[i].r === walk[i - 1].r ? null : (
            <g key={i} style={{ pointerEvents: "none" }}>
              <circle cx={hexToPixel(p.q, p.r, S).x} cy={hexToPixel(p.q, p.r, S).y} r={9} fill="#0E1116" stroke="#F5E7C8" strokeWidth={1.5} />
              <text x={hexToPixel(p.q, p.r, S).x} y={hexToPixel(p.q, p.r, S).y + 1} textAnchor="middle" dominantBaseline="middle"
                fontFamily="'IBM Plex Mono', monospace" fontSize={9} fontWeight={600} fill="#F5E7C8">
                {i + 1}
              </text>
            </g>
          ))}
      </svg>
    </div>
  );
}
