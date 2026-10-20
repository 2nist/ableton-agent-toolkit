import { useMemo, useCallback, useState } from "react";
import { DEPTH_CELL_SCALE, depthOpacity, projectDepth } from "../../lib/harmony/depthView";
import { pitchClass } from "@music-theory/core";
import type { ScaleType, ChordQuality, NoteName } from "@music-theory/core";
import { resolveFlavor, BI_TONAL_MATRIX, DEFAULT_COLOR_FLAVOR } from "@platform/progression-engine";
import { chordOnsetsForOutline, outlineBeatsPerBar } from "@drum/library";
import type { Chord, MeterOutline, TonicRegion } from "../../types/blueprint";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { chordFromDegree, chordsToHoneycombText, chordDisplayName } from "../../lib/harmony/chordBuilder";
import { degreeRelativeTo, resolveTonicAt } from "../../lib/harmony/tonic";
import { buildRegionWalk, regionOfCell } from "../../lib/harmony/tonicWalk";
import {
  parseProgression,
  collapseRepeatsForLoopView,
  detectLoop,
  walkVariants,
  getRevealedCells,
  visitBeads,
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

const DEFAULT_SCALE = 34;
const MIN_SCALE = 24;
const MAX_SCALE = 56;
const SCALE_KEY = "trackdraft-honeycomb-scale";

function readScale(): number {
  try {
    const raw = Number(localStorage.getItem(SCALE_KEY));
    if (Number.isFinite(raw) && raw >= MIN_SCALE && raw <= MAX_SCALE) return raw;
  } catch {
    /* a corrupt flag is not worth breaking the wheel over */
  }
  return DEFAULT_SCALE;
}

interface HoneycombWheelProps {
  keyName: NoteName;
  scale: ScaleType;
  chords: Chord[];
  beatsPerChord: number;
  selectedChordId: string | null;
  /** Chord sounding at the playhead — highlighted so the map follows playback. */
  activeChordId?: string | null;
  /** Selecting a chord (a new one, or an existing placed one) is now the
   *  only signal needed — its editor lives in the dock, driven by the
   *  shared `harmonySelectionStore`, not a click-anchored popover this
   *  component used to have to open directly. */
  onSelectChord: (id: string | null) => void;
  onChangeChords: (chords: Chord[]) => void;
  /** Active section's bi-tonal color flavor — renders a small badge on each
   *  chord hex showing the color-extension that chord maps to under it. */
  colorFlavor?: string;
  /** The section's resolved harmony outline (harmonyMeterOutline, or the
   *  drum outline when 'follow drums' is on) — when set, a small dial in the
   *  wheel's corner draws one tick per chord-change onset, so the syncopated
   *  grid reads on the wheel itself. */
  harmonyOutline?: MeterOutline | null;
  /** Called when a chord is clicked or added, so the host can audition it
   *  through the selected MIDI port. */
  onPreviewChord?: (chord: Chord) => void;
  /** The section's tonic regions (authored, or inferred by the host). With
   *  more than one, each chord is placed relative to the home in force at
   *  its own beat and the lattice re-roots at the modulation. */
  regions?: TonicRegion[];
}

export default function HoneycombWheel({
  keyName,
  scale,
  chords,
  beatsPerChord,
  selectedChordId,
  activeChordId = null,
  onSelectChord,
  onChangeChords,
  colorFlavor,
  harmonyOutline,
  onPreviewChord,
  regions,
}: HoneycombWheelProps) {
  const [scaleSize, setScaleSize] = useState<number>(() => readScale());
  const S = scaleSize;

  function changeScale(delta: number) {
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scaleSize + delta));
    setScaleSize(next);
    try {
      localStorage.setItem(SCALE_KEY, String(next));
    } catch {
      /* persistence is a nicety */
    }
  }

  const honeycombText = useMemo(() => chordsToHoneycombText(chords), [chords]);
  const parsedSteps = useMemo(() => parseProgression(honeycombText).steps, [honeycombText]);

  /** Which tonic region each chord belongs to, and its degree *in that
   *  region*. The authored roman numeral is relative to one key, so after a
   *  modulation it names the wrong function — the root measured against the
   *  home in force at the chord's own beat is the truthful reading. */
  const regionSteps = useMemo(() => {
    const fallback = { key: keyName, scale };
    const usable = (regions ?? []).slice().sort((a, b) => a.startBeat - b.startBeat);
    let beat = 0;
    const perStep = chords.map((chord) => {
      const startBeat = beat;
      beat += chord.beats;
      if (usable.length === 0) return { region: 0, deg: null as number | null, acc: 0 };
      const home = resolveTonicAt(usable, startBeat, fallback);
      const { deg, acc } = degreeRelativeTo(
        pitchClass(chord.root),
        pitchClass(home.key),
        home.scale,
      );
      return { region: usable.findIndex((region) => region === home), deg, acc };
    });
    return perStep;
  }, [chords, regions, keyName, scale]);

  const steps = useMemo(
    () =>
      parsedSteps.map((step, index) => {
        const derived = regionSteps[index];
        if (!derived || derived.deg == null) return step;
        return { ...step, deg: derived.deg, acc: derived.acc };
      }),
    [parsedSteps, regionSteps],
  );

  /** The walk, re-rooted at every modulation. A single region (the normal
   *  case) is byte-identical to the plain buildWalk. */
  const regionWalk = useMemo(
    () =>
      buildRegionWalk(
        steps.map((step, index) => ({ deg: step.deg, region: regionSteps[index]?.region ?? 0 })),
      ),
    [steps, regionSteps],
  );
  const walk = regionWalk.walk;

  /** One entry per tonic region: its home, its scale, and the diatonic chords
   *  that scale builds. Placeholder cells and "add this chord" choices use the
   *  entry of the region they sit in, so a re-rooted region offers its own
   *  degrees instead of the song key's. */
  const homes = useMemo(() => {
    const usable = (regions ?? []).slice().sort((a, b) => a.startBeat - b.startBeat);
    const list = usable.length > 0 ? usable : [{ key: keyName, scale }];
    return list.map((region) => {
      const regionIntervals =
        SCALE_INTERVALS[MODE_TO_SCALE_KEY[region.scale as keyof typeof MODE_TO_SCALE_KEY] ?? "major"];
      return {
        key: region.key,
        scale: region.scale,
        keyPc: pitchClass(region.key),
        intervals: regionIntervals,
        diatonicByDegree: Array.from({ length: 7 }, (_, i) => diatonicChordAt(regionIntervals, i)),
      };
    });
  }, [regions, keyName, scale]);

  /** Home note per region index — used for the seam labels. */
  const homeOfRegion = useMemo(() => homes.map((home) => home.key), [homes]);

  /** Which region the *next* chord would land in — depth mode's frontier
   *  offers the choices in that home. */
  const nextRegion = regionSteps[walk.length]?.region ?? regionSteps[regionSteps.length - 1]?.region ?? 0;

  /** The home a cell belongs to — the nearest walked step's region. */
  const regionAt = useCallback(
    (q: number, r: number) => regionOfCell({ q, r }, walk, regionWalk.regionOfStep),
    [walk, regionWalk.regionOfStep],
  );

  /** Modulations, in pixels: a dashed translation guide plus the new home.
   *  Only meaningful in the flat views (depth already steps every chord). */
  const modulationSeams = useMemo(
    () =>
      regionWalk.seams.map((seam) => ({
        ...seam,
        fromPx: hexToPixel(seam.from.q, seam.from.r, S),
        toPx: hexToPixel(seam.to.q, seam.to.r, S),
        home: homeOfRegion[seam.region] ?? null,
      })),
    [regionWalk.seams, homeOfRegion, S],
  );

  // "linear" is the straight-line walk above (one hex per chord, only a
  // literal back-and-forth reuses a hex). "loop" collapses a detected
  // repeating vamp onto a single lap for a compact view — same step
  // order/count, just reused coordinates. Rendering and click-hit-testing
  // below key off `displayWalk`; `walk` stays the source of truth for
  // indexing into `chords`/`steps` (both arrays share its length/order).
  // View mode lives in the shared selection store (not local state) so the
  // Linear/Loop toggle in the dock's Tools panel and the wheel stay in sync
  // without HarmonyView re-registering dock content on every toggle.
  const viewMode = useHarmonySelectionStore((s) => s.honeycombMode);
  const displayWalk = useMemo(
    () => (viewMode === "loop" ? collapseRepeatsForLoopView(walk, steps) : walk),
    [viewMode, walk, steps],
  );

  // The "current"/"choice" anchor is always the true end of the
  // progression, independent of whichever chord is selected for editing —
  // selecting an earlier chord to inspect must never relocate where a
  // click-to-add lands (see honeycomb design spec: cell position vs.
  // sequence step are decoupled).
  // Depth (z = time): each step is its own hex at its own depth, so the path
  // is monotone and nothing needs to share a cell. Falls back to the flat
  // lattice when there is no walk yet (an empty section still shows the
  // starter ring, and its choices are the seeded `revealed` cells).
  const isDepth = viewMode === "depth" && walk.length > 0;
  /** Depth mode's own cell size — smaller hexes keep the ribbon readable. */
  const SD = Math.round(S * DEPTH_CELL_SCALE);

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

  const activeStep = useMemo(() => {
    if (!activeChordId) return -1;
    const index = chords.findIndex((chord) => chord.id === activeChordId);
    return index >= 0 && index < displayWalk.length ? index : -1;
  }, [chords, activeChordId, displayWalk.length]);

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

  // Which chords actually landed on each cell: a cell is a DEGREE, a variant
  // is the chord (Em vs E, bVI vs VI). Cells that only ever see one chord
  // come back with a single variant, so the diatonic case is unchanged.
  const variants = useMemo(() => walkVariants(displayWalk, steps), [displayWalk, steps]);

  const depthNodes = useMemo(
    () =>
      isDepth
        ? walk.map((cell, index) => ({
            ...projectDepth(cell.q, cell.r, index, SD),
            index,
            q: cell.q,
            r: cell.r,
          }))
        : [],
    [isDepth, walk, SD],
  );

  const depthPath = useMemo(
    () => (depthNodes.length ? `M ${depthNodes.map((node) => `${node.x} ${node.y}`).join(" L ")}` : ""),
    [depthNodes],
  );

  /** The next chord is chosen from the latest chord's neighbours, one step
   *  deeper — "add" reads as stepping forward. */
  const frontier = useMemo(() => {
    if (!isDepth) return [];
    const last = walk[walk.length - 1];
    return DIRS.map(([a, b]) => {
      const q = last.q + a;
      const r = last.r + b;
      return { ...projectDepth(q, r, walk.length, SD), q, r, d: degreeAt(q, r) };
    });
  }, [isDepth, walk, SD]);

  const loop = useMemo(() => detectLoop(steps, displayWalk), [steps, displayWalk]);
  // The loop's translation vector in pixel space, under the same projection
  // as the cells themselves (hexToPixel handles the pointy-top mapping).
  const loopVec = loop?.translated ? hexToPixel(loop.dq, loop.dr, S) : null;

  // Repeats become beads on a wire — see visitBeads for why a revisit can't
  // just step to another hex of the same degree.
  const visitPlan = useMemo(() => visitBeads(displayWalk, S), [displayWalk, S]);
  const stepPoints = visitPlan.points;

  const pathD = useMemo(() => {
    if (stepPoints.length < 2) return "";
    const points = stepPoints.filter(
      (point, index) =>
        index === 0 ||
        point.x !== stepPoints[index - 1].x ||
        point.y !== stepPoints[index - 1].y,
    );
    if (points.length < 2) return "";
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" ");
  }, [stepPoints]);

  // SVG bounds — guard against empty (no chords) section
  const svgDims = useMemo(() => {
    const allPts: { x: number; y: number }[] = [];
    if (revealed.length > 0) {
      allPts.push(...revealed.map((c) => hexToPixel(c.q, c.r, S)));
    }
    if (isDepth) {
      allPts.push(...depthNodes.map(({ x, y }) => ({ x, y })));
      allPts.push(...frontier.map(({ x, y }) => ({ x, y })));
    } else if (displayWalk.length > 0) {
      allPts.push(...displayWalk.map((p) => hexToPixel(p.q, p.r, S)));
      allPts.push(...stepPoints);
      allPts.push(...modulationSeams.flatMap((seam) => [seam.fromPx, seam.toPx]));
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
    // Depth mode's content already spans the sequence, so it needs far less
    // margin than the flat lattice's ring of choice cells.
    const pad = isDepth ? 26 : S * 2.5;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const maxX = Math.max(...xs) + pad;
    const maxY = Math.max(...ys) + pad;
    return {
      vb: [minX, minY, Math.max(220, maxX - minX), Math.max(180, maxY - minY)] as const,
      w: Math.max(220, maxX - minX + 16),
      h: Math.max(180, maxY - minY + 16),
    };
  }, [revealed, displayWalk, loopVec, S, isDepth, depthNodes, frontier, stepPoints, modulationSeams]);

  const addChordAtDegree = useCallback((deg: number, region = 0) => {
    const home = homes[region] ?? homes[0];
    const diatonic = home.diatonicByDegree[deg].triad;
    const degreeLabel = diatonic.minor
      ? ROMAN_UP[deg].toLowerCase()
      : ROMAN_UP[deg];
    const rootPc = home.intervals[deg];
    const newChord = chordFromDegree(
      home.keyPc, home.key, degreeLabel,
      (diatonic.minor ? "min" : "maj") as ChordQuality,
      rootPc, beatsPerChord,
    );
    const updated = [...chords, newChord];
    onChangeChords(updated);
    onSelectChord(newChord.id);
    onPreviewChord?.(newChord);
  }, [chords, homes, beatsPerChord, onChangeChords, onSelectChord, onPreviewChord]);

  const selectChordAtCell = useCallback((q: number, r: number) => {
    if (!displayWalk.length) return;
    for (let i = displayWalk.length - 1; i >= 0; i--) {
      if (displayWalk[i].q === q && displayWalk[i].r === r) {
        const chord = chords[i];
        if (chord) {
          onSelectChord(chord.id);
          onPreviewChord?.(chord);
        }
        return;
      }
    }
  }, [displayWalk, chords, onSelectChord, onPreviewChord]);

  const handleCellClick = useCallback((cell: RevealedCell) => {
    // A choice cell adds the chord *its own* home would build there, so a
    // click in a re-rooted region writes the new key's chord, not the old one.
    if (cell.type === "choice") addChordAtDegree(cell.d, regionAt(cell.q, cell.r));
    else selectChordAtCell(cell.q, cell.r);
  }, [addChordAtDegree, regionAt, selectChordAtCell]);

  const vbStr = `${svgDims.vb[0]} ${svgDims.vb[1]} ${svgDims.vb[2]} ${svgDims.vb[3]}`;

  // Euclidean-harmony onset dial — one tick per chord-change onset (each 2s/3s
  // cell's start within a bar) drawn in the wheel's top-right corner.
  const dial = useMemo(() => {
    if (!harmonyOutline) return null;
    const bpb = outlineBeatsPerBar(harmonyOutline);
    return { bpb, onsets: chordOnsetsForOutline(harmonyOutline, bpb) };
  }, [harmonyOutline]);
  const dialCenter = dial ? { x: svgDims.vb[2] - 32, y: 30 } : null;

  return (
    <div style={{ position: "relative", minWidth: 0, maxWidth: "100%" }}>
      <div className="absolute left-1 top-1 z-10 flex gap-1">
        <button
          type="button"
          className="rounded border border-edge/70 bg-[#0E1116]/80 px-1.5 text-[11px] leading-4 text-inkMuted hover:text-ink"
          onClick={() => changeScale(-4)}
          disabled={S <= MIN_SCALE}
          title="Zoom the honeycomb out"
        >
          −
        </button>
        <button
          type="button"
          className="rounded border border-edge/70 bg-[#0E1116]/80 px-1.5 text-[11px] leading-4 text-inkMuted hover:text-ink"
          onClick={() => changeScale(6)}
          disabled={S >= MAX_SCALE}
          title="Zoom the honeycomb in — room for stacked variants"
        >
          +
        </button>
      </div>
      <div className="w-full max-w-full overflow-x-auto">
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

        {/* Modulation seams: the lattice re-roots, so show the translation
            and name the new home. This is the flat view's version of the 3D
            scene's y-axis lift — a change of key is new ground, not a
            borrowed chord on the same map. */}
        {!isDepth &&
          modulationSeams.map((seam) => (
            <g key={`seam-${seam.step}`} style={{ pointerEvents: "none" }}>
              <line
                x1={seam.fromPx.x}
                y1={seam.fromPx.y}
                x2={seam.toPx.x}
                y2={seam.toPx.y}
                stroke="#8FD3FF"
                strokeOpacity={0.5}
                strokeWidth={1.4}
                strokeDasharray="5 4"
              />
              <circle
                cx={seam.toPx.x}
                cy={seam.toPx.y}
                r={4.5}
                fill="#0b0e13"
                stroke="#8FD3FF"
                strokeOpacity={0.7}
                strokeWidth={1.2}
              />
              {seam.home && (
                <text
                  x={(seam.fromPx.x + seam.toPx.x) / 2}
                  y={(seam.fromPx.y + seam.toPx.y) / 2 - 5}
                  textAnchor="middle"
                  fontFamily="'IBM Plex Mono', monospace"
                  fontSize={8.5}
                  fontWeight={600}
                  fill="#8FD3FF"
                  stroke="#0b0e13"
                  strokeWidth={2.5}
                  paintOrder="stroke"
                >
                  → {seam.home}
                </text>
              )}
            </g>
          ))}

        {!isDepth && pathD && (
          <path d={pathD} fill="none" stroke="#F5E7C8" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} filter="url(#hw-glow)" style={{ pointerEvents: "none" }} />
        )}

        {!isDepth && loop && loop.translated && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={hexToPixel(displayWalk[0].q, displayWalk[0].r, S).x} y1={hexToPixel(displayWalk[0].q, displayWalk[0].r, S).y}
              x2={hexToPixel(displayWalk[displayWalk.length - 1].q, displayWalk[displayWalk.length - 1].r, S).x} y2={hexToPixel(displayWalk[displayWalk.length - 1].q, displayWalk[displayWalk.length - 1].r, S).y}
              stroke="#E8B54A" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#hw-arrow)" opacity={0.75} />
          </g>
        )}

        {isDepth && depthPath && (
          <path d={depthPath} fill="none" stroke="#F5E7C8" strokeWidth={2.4} strokeLinecap="round"
            strokeLinejoin="round" opacity={0.45} style={{ pointerEvents: "none" }} />
        )}

        {isDepth &&
          depthNodes.map((node) => {
            const chord = chords[node.index];
            if (!chord) return null;
            const hue = HUES[degreeAt(node.q, node.r)];
            const name = chordDisplayName(pitchClass(chord.root), chord.quality, keyName);
            const isSelected = node.index === selectedStep;
            const isLatest = node.index === depthNodes.length - 1;
            return (
              <g
                key={`depth-${node.index}`}
                transform={`translate(${node.x}, ${node.y})`}
                opacity={depthOpacity(node.index, depthNodes.length)}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  onSelectChord(chord.id);
                  onPreviewChord?.(chord);
                }}
              >
                <polygon
                  points={hexPoints(SD - 2)}
                  fill={hue.fill}
                  stroke={hue.rim}
                  strokeWidth={isLatest ? 2.5 : 1.2}
                  style={isLatest ? { filter: "url(#hw-glow)" } : undefined}
                />
                {isSelected && (
                  <polygon points={hexPoints(SD + 2)} fill="none" stroke="#E8B54A" strokeWidth={2}
                    strokeDasharray="3 2" style={{ pointerEvents: "none" }} />
                )}
                <text x={0} y={0} textAnchor="middle" dominantBaseline="middle"
                  fontFamily="'IBM Plex Mono', monospace" fontSize={10} fontWeight={600}
                  fill={hue.ink} style={{ pointerEvents: "none" }}>
                  {chord.romanNumeral}
                </text>
                <text x={0} y={SD * 0.42} textAnchor="middle"
                  fontFamily="'IBM Plex Mono', monospace" fontSize={7}
                  fill={hue.rim} style={{ pointerEvents: "none" }}>
                  {name}
                </text>
                <text x={-SD * 0.62} y={-SD * 0.55} textAnchor="middle"
                  fontFamily="'IBM Plex Mono', monospace" fontSize={7}
                  fill="#8B94A1" style={{ pointerEvents: "none" }}>
                  {node.index + 1}
                </text>
              </g>
            );
          })}

        {frontier.map((cell) => (
          <g
            key={`frontier-${cell.q},${cell.r}`}
            transform={`translate(${cell.x}, ${cell.y})`}
            opacity={0.5}
            style={{ cursor: "pointer" }}
            onClick={() => addChordAtDegree(cell.d, nextRegion)}
          >
            <polygon points={hexPoints(SD - 2)} fill="#12161D"
              stroke={`${HUES[cell.d].rim}66`} strokeWidth={1.4} strokeDasharray="4 3" />
            <text x={0} y={0} textAnchor="middle" dominantBaseline="middle"
              fontFamily="'IBM Plex Mono', monospace" fontSize={9} fontWeight={600}
              fill="#8B94A1" style={{ pointerEvents: "none" }}>
              {(homes[nextRegion] ?? homes[0]).diatonicByDegree[cell.d].triad.minor
                ? ROMAN_UP[cell.d].toLowerCase()
                : ROMAN_UP[cell.d]}
            </text>
          </g>
        ))}

        {!isDepth && revealed.map((cell) => {
          const { q, r, d, type } = cell;
          const cx = hexToPixel(q, r, S).x;
          const cy = hexToPixel(q, r, S).y;
          const isCurrent = type === "current";
          const isChoice = type === "choice";
          const isSelected = selectedStep >= 0 && displayWalk[selectedStep].q === q && displayWalk[selectedStep].r === r;
          const isPlaying =
            activeStep >= 0 && displayWalk[activeStep].q === q && displayWalk[activeStep].r === r;

          // Color-flavor badge: the bi-tonal color extension this chord maps
          // to under the section's flavor, shown as a small square badge like
          // the step-order badge. Skipped when the flavor doesn't apply to
          // this chord's quality (the engine resolves those to "Unison").
          const chordAtCell = isCurrent
            ? chords[displayWalk.findIndex((p) => p.q === q && p.r === r)]
            : undefined;
          const flavorLabel = chordAtCell
            ? resolveFlavor(BI_TONAL_MATRIX, chordAtCell.quality, colorFlavor ?? DEFAULT_COLOR_FLAVOR).label
            : null;
          const badgeLabel = flavorLabel && flavorLabel !== "Unison"
            ? (flavorLabel.length > 7 ? `${flavorLabel.slice(0, 6)}…` : flavorLabel)
            : null;

          // The cell is a DEGREE; label it with the chord that actually
          // landed there — an E major on degree 3 must read "III / E", never
          // the diatonic placeholder "iii / Em".
          const cellKey = `${q},${r}`;
          const lastStep = lastStepAtCell(displayWalk, q, r);
          const cellChord = lastStep >= 0 ? chords[lastStep] : undefined;
          // An unwalked cell is named by the home it sits nearest, so the
          // choices offered beside a re-rooted region read in that region's
          // key rather than the song's.
          const home = homes[regionAt(q, r)] ?? homes[0];
          const romanLabel = cellChord
            ? cellChord.romanNumeral
            : home.diatonicByDegree[d].triad.minor
              ? ROMAN_UP[d].toLowerCase()
              : ROMAN_UP[d];
          const subLabel = cellChord
            ? chordDisplayName(pitchClass(cellChord.root), cellChord.quality, keyName)
            : chordDisplayName(
                (home.keyPc + home.intervals[d]) % 12,
                home.diatonicByDegree[d].triad.minor ? "min" : "maj",
                home.key,
              );
          const hue = HUES[d];

          // Chords that share this degree (Em → E, VI → bVI) stack as chips
          // instead of silently reusing the cell.
          const cellVariants = variants.byCell.get(cellKey) ?? [];
          const hasVariants = cellVariants.length > 1;
          const currentVariant = lastStep >= 0 ? variants.variantOfStep[lastStep] : 0;
          const selectedVariant =
            selectedStep >= 0 && displayWalk[selectedStep].q === q && displayWalk[selectedStep].r === r
              ? variants.variantOfStep[selectedStep]
              : -1;
          const labelSize = hasVariants ? 12 : romanLabel.length > 3 ? 10 : romanLabel.length > 2 ? 12 : 14;

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
              {isPlaying && (
                <polygon points={hexPoints(S + 4)} fill="none" stroke="#8FD3FF" strokeWidth={2.4} style={{ pointerEvents: "none" }} />
              )}
              {isSelected && (
                <polygon points={hexPoints(S + 2)} fill="none" stroke="#E8B54A" strokeWidth={2} strokeDasharray="3 2" style={{ pointerEvents: "none" }} />
              )}
              <text x={0} y={hasVariants ? -S * 0.24 : 1} textAnchor="middle" dominantBaseline="middle"
                fontFamily="'IBM Plex Mono', monospace" fontSize={labelSize} fontWeight={600}
                fill={isChoice ? "#8B94A1" : hue.ink} style={{ pointerEvents: "none" }}>
                {hasVariants ? subLabel : romanLabel}
              </text>
              {!hasVariants && (
                <text x={0} y={S * 0.38} textAnchor="middle"
                  fontFamily="'IBM Plex Mono', monospace" fontSize={9}
                  fill={isChoice ? "#57606D" : hue.rim} style={{ pointerEvents: "none" }}>
                  {subLabel}
                </text>
              )}
              {hasVariants && (
                <g style={{ pointerEvents: "none" }}>
                  {variantChips(cellVariants, currentVariant, selectedVariant).map(({ variant, label, x, width, isCurrent, isSelected }) => (
                    <g key={variant.key}>
                      <rect
                        x={x}
                        y={S * 0.2}
                        width={width}
                        height={11}
                        rx={2.5}
                        fill={isCurrent ? hue.rim : "#10141C"}
                        stroke={isSelected ? "#E8B54A" : hue.rim}
                        strokeWidth={isSelected ? 1.5 : 0.9}
                      />
                      <text
                        x={x + width / 2}
                        y={S * 0.2 + 8}
                        textAnchor="middle"
                        fontFamily="'IBM Plex Mono', monospace"
                        fontSize={7}
                        fill={isCurrent ? "#0E1116" : hue.rim}
                      >
                        {label}
                      </text>
                    </g>
                  ))}
                </g>
              )}
              {badgeLabel && (
                <g style={{ pointerEvents: "none" }}>
                  <rect
                    x={-S * 0.8}
                    y={-S * 0.82}
                    width={badgeLabel.length * 5 + 6}
                    height={12}
                    rx={3}
                    fill="#10141C"
                    stroke="#5B84C4"
                    strokeWidth={1}
                  />
                  <text
                    x={-S * 0.8 + 3}
                    y={-S * 0.82 + 9}
                    fontFamily="'IBM Plex Mono', monospace"
                    fontSize={7.5}
                    fill="#8FB7E8"
                  >
                    {badgeLabel}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Numbered beads for chords the progression revisits: the sequence is
            visible in place, instead of a "×2" repeat count. */}
        {!isDepth &&
          visitPlan.beads.map((bead) => (
            <g key={`bead-${bead.step}`} style={{ pointerEvents: "none" }}>
              <circle cx={bead.x} cy={bead.y} r={5.5} fill="#0E1116" stroke="#F5E7C8" strokeWidth={1.2} />
              <text
                x={bead.x}
                y={bead.y + 0.5}
                textAnchor="middle"
                dominantBaseline="middle"
                fontFamily="'IBM Plex Mono', monospace"
                fontSize={7}
                fill="#F5E7C8"
              >
                {bead.step}
              </text>
            </g>
          ))}

        {!isDepth && walkBadges.filter(({ indices }) => indices.length === 1).map(({ q, r, indices }) => {
          const center = hexToPixel(q, r, S);
          const bx = center.x + S * 0.6;
          const by = center.y - S * 0.6;
          // "3×2" means the SAME chord twice; "1·3" means two different
          // chords landed on this degree — a stack, not a repeat.
          const firstVariant = variants.variantOfStep[indices[0] - 1] ?? 0;
          const mixed = !indices.every((i) => variants.variantOfStep[i - 1] === firstVariant);
          // List the visits, not a repeat count: "1·3" tells you the sequence
          // came back, "1×2" only tells you it happened twice.
          const label =
            indices.length <= 4
              ? indices.join("·")
              : `${indices[0]}…${indices[indices.length - 1]}`;
          const badgeTitle = `Step${indices.length > 1 ? "s" : ""} ${indices.join(", ")} — ${
            mixed ? "different chords on this degree" : "the progression returns here"
          }`;
          return (
            <g key={`${q},${r}`} style={{ pointerEvents: "none" }}>
              <title>{badgeTitle}</title>
              <circle cx={bx} cy={by} r={9} fill="#0E1116" stroke="#F5E7C8" strokeWidth={1.5} />
              <text x={bx} y={by + 1} textAnchor="middle" dominantBaseline="middle"
                fontFamily="'IBM Plex Mono', monospace" fontSize={8} fontWeight={600} fill="#F5E7C8">
                {label}
              </text>
            </g>
          );
        })}

        {dial && dialCenter && (
          <g style={{ pointerEvents: "none" }}>
            <circle cx={dialCenter.x} cy={dialCenter.y} r={22} fill="#0E1116" stroke="#E8B54A" strokeOpacity={0.4} strokeWidth={1} />
            {dial.onsets.map((t, i) => {
              const a = (t / dial.bpb) * Math.PI * 2 - Math.PI / 2;
              const r2 = i === 0 ? 22 : 19;
              const x1 = dialCenter.x + Math.cos(a) * 15;
              const y1 = dialCenter.y + Math.sin(a) * 15;
              return (
                <line
                  key={i}
                  x1={x1} y1={y1}
                  x2={dialCenter.x + Math.cos(a) * r2} y2={dialCenter.y + Math.sin(a) * r2}
                  stroke="#E8B54A"
                  strokeWidth={i === 0 ? 2 : 1.3}
                  strokeOpacity={0.9}
                />
              );
            })}
            <text x={dialCenter.x} y={dialCenter.y + 3} textAnchor="middle" dominantBaseline="middle"
              fontFamily="'IBM Plex Mono', monospace" fontSize={7} fill="#E8B54A" opacity={0.8}>
              {dial.onsets.length}×
            </text>
          </g>
        )}
      </svg>
      </div>
    </div>
  );
}

/** Index of the LAST step that visited a cell (-1 when it was never walked).
 *  The newest visit is what the cell should be labelled with. */
function lastStepAtCell(walk: { q: number; r: number }[], q: number, r: number): number {
  for (let i = walk.length - 1; i >= 0; i--) {
    if (walk[i].q === q && walk[i].r === r) return i;
  }
  return -1;
}

/** Lay out the variant chips centred inside a hex, three at most. */
function variantChips<T extends { key: string; label: string; suffix: string }>(
  variants: T[],
  current: number,
  selected: number,
): { variant: T; label: string; x: number; width: number; isCurrent: boolean; isSelected: boolean }[] {
  // Two variants can share a numeral (I and Imaj7): spell out the suffix only
  // when the bare label would be ambiguous.
  const counts = new Map<string, number>();
  for (const variant of variants) counts.set(variant.label, (counts.get(variant.label) ?? 0) + 1);
  const labelOf = (variant: T) =>
    (counts.get(variant.label) ?? 0) > 1 && variant.suffix
      ? `${variant.label}${variant.suffix.slice(0, 4)}`
      : variant.label;
  const shown = variants.slice(0, 3);
  const widths = shown.map((variant) => Math.max(13, labelOf(variant).length * 4.6 + 4));
  const gap = 2;
  const total = widths.reduce((sum, width) => sum + width + gap, -gap);
  let x = -total / 2;
  return shown.map((variant, index) => {
    const width = widths[index];
    const chip = {
      variant,
      label: labelOf(variant),
      x,
      width,
      isCurrent: index === current,
      isSelected: index === selected,
    };
    x += width + gap;
    return chip;
  });
}
