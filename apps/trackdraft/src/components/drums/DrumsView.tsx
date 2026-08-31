import { useEffect, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { useDockStore } from "../../store/dockStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import { updateSection } from "../../lib/sections";
import { beatsPerBar, type BlueprintSection, type DrumTransitionModel, type DrumVoiceName, type MeterOutline } from "../../types/blueprint";
import {
  resolveSectionVoiceNecklaces,
  resolveSectionVariant,
  inferPatternForSection,
  velocityNumber,
  seededVariantIndex,
  type VoiceNecklace,
} from "../../lib/playback/drumPreview";
import { DRUM_LANES, type DrumLane } from "./laneStyle";
import { TRANSITION_COLOR, TRANSITION_LABEL } from "./transitionStyle";
import { SECTION_ROLE_COLOR } from "./sectionRoleStyle";
import NecklaceGlyph from "./NecklaceGlyph";
import DrumPatternTools from "./DrumPatternTools";
import { planSectionHandoffFills, planSectionTransitions, FILL_DATA, outlineBeatsPerBar, numerator as outlineNumerator, hashSeed, occurrenceSeed, buildEuclideanOutline, twoThreeCellCounts, type HandoffSectionInput } from "@drum/library";

/** A stable identity for a section's *resolved* drum content — same
 *  preset+variant (or same outline cells/voicing) means literally the
 *  same note data, not just a similar-looking pattern. Drives whether a
 *  lane's necklace repeats on the timeline or the line just continues.
 *  A section's `drumVariationOutline` is deliberately *not* part of this:
 *  a variation is a detour at the section's end, drawn as its own
 *  indicator, and doesn't change the main pattern's identity — a section
 *  repeating the same base groove with a different detour still continues
 *  the line. Per-voice overrides (`drumVoiceOutlines`) *are* part of it:
 *  they change the resolved per-voice rhythm, so a section with different
 *  voice patterns reads as a different groove. */
function sectionDrumKey(section: BlueprintSection, concept?: string, occurrenceIndex = 0): string {
  let key: string;
  if (section.drumMeterOutline) {
    const o = section.drumMeterOutline;
    key = `outline::${o.cellBeats}::${o.cells.join(",")}::${(o.cellVoices ?? []).join(",")}`;
  } else {
    const pattern = section.drumPattern ?? inferPatternForSection(section, concept);
    // Use the same seeded variant the export uses, so a repeated section
    // that resolves to a different variant renders as a pattern change
    // (not "the line just continues").
    key = `${pattern}::${seededVariantIndex(pattern, section, occurrenceIndex) ?? 0}`;
  }
  const ov = section.drumVoicePatterns;
  if (ov) {
    const parts = Object.keys(ov)
      .filter((v) => ov[v as DrumVoiceName])
      .sort()
      .map((v) => `${v}:${ov[v as DrumVoiceName]!.k}/${ov[v as DrumVoiceName]!.n}/${ov[v as DrumVoiceName]!.rotation}`);
    if (parts.length > 0) key += `::vo::${parts.join("&")}`;
  }
  return key;
}

/** Eighth-note slots per bar for a section's meter — the default detour
 *  grid (8 for 4/4, 7 for 7/8, ...). */
function eighthNoteNumerator(sec: Pick<BlueprintSection, "timeSignatureNumerator" | "timeSignatureDenPower">): number {
  return sec.timeSignatureNumerator * (8 / 2 ** sec.timeSignatureDenPower);
}

/** A sensible default detour outline for a section — its meter on a /8
 *  grid, 2s/3s grouped (the same shape the Pattern tab's "Add detour"
 *  button produces), so clicking an empty beat dot immediately has a
 *  real fill to shape in the Detour editor. */
function defaultDetourFor(sec: BlueprintSection): MeterOutline {
  const num = eighthNoteNumerator(sec);
  return buildEuclideanOutline(num, 8, twoThreeCellCounts(num)[0] ?? 3, 0);
}

// Canvas geometry — a pure-black stage with a top annotation row, then
// six thick voice tracks. Tuned so six voices fit comfortably and each
// track has room for its internal beat/bar grid.
const X0 = 104;
const BAR_PX = 40;
const TRACK_H = 36;
const TOP_PAD = 40;
const BOTTOM_PAD = 34;
const NECK_R = 10.5;
const STACK_TOP = TOP_PAD;
// One extra row at the bottom of the stack is the beat-dot detour lane.
const STACK_BOTTOM = TOP_PAD + (DRUM_LANES.length + 1) * TRACK_H;

const laneY = (li: number): number => TOP_PAD + li * TRACK_H + TRACK_H / 2;
const trackBottom = (li: number): number => TOP_PAD + (li + 1) * TRACK_H;
// The beat-dot detour lane — a full row at the bottom of the timeline, one
// black dot per beat, clickable to drop/move/remove a detour at that spot.
const DETOUR_Y = TOP_PAD + DRUM_LANES.length * TRACK_H + TRACK_H / 2;

/** Union of a lane's member voices' onsets in one resolved span — the
 *  lane's own necklace. The HAT lane, for example, shows closed and open
 *  hats together; `steps` is the largest grid any member reports (shared
 *  within a span — outline numerator / loop sixteenths). */
function laneNecklace(
  lane: DrumLane,
  necklaces: VoiceNecklace[] | null,
): { hits: number[]; steps?: number } | null {
  if (!necklaces) return null;
  const member = necklaces.filter((n) => lane.voices.includes(n.voice) && n.count > 0);
  if (member.length === 0) return null;
  const hits = Array.from(new Set(member.flatMap((m) => m.hits))).sort((a, b) => a - b);
  const steps = member.reduce((max, m) => Math.max(max, m.steps ?? 0), 0) || undefined;
  return { hits, steps };
}

interface ResolvedSpan {
  span: SectionSpan;
  /** The section actually rendered — the committed section, or a working
   *  draft from the Pattern editor that the timeline is previewing. */
  section: BlueprintSection;
  /** Identity of the resolved groove — see `sectionDrumKey`. */
  key: string;
  necklaces: VoiceNecklace[] | null;
}

/** The detour "node" — the groove lifts OFF the timeline at the detour's
 *  start, arcs up (a small diamond at the peak, more diamonds riding the
 *  arc), and lands back ON the line where the detour ends. Drawn in the
 *  lane's own color. */
function DetourArc({ x1, x2, y, color }: { x1: number; x2: number; y: number; color: string }) {
  const w = x2 - x1;
  if (w < 2) return null;
  const peak = Math.min(26, Math.max(14, w * 0.2));
  const mid = (x1 + x2) / 2;
  const steps = 8;
  return (
    <g pointerEvents="none">
      <path
        d={`M ${x1} ${y} Q ${mid} ${y - peak} ${x2} ${y}`}
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeOpacity={0.95}
        filter="url(#drums-glow)"
      />
      {Array.from({ length: steps + 1 }).map((_, i) => {
        const t = i / steps;
        const dx = x1 + t * w;
        const dy = y - peak * 4 * t * (1 - t); // same parabola as the Q curve
        return (
          <path
            key={i}
            d={`M ${dx} ${dy - 3} L ${dx + 3} ${dy} L ${dx} ${dy + 3} L ${dx - 3} ${dy} Z`}
            fill={color}
            fillOpacity={0.9}
          />
        );
      })}
    </g>
  );
}

/** The fill/transition "gesture" marker — a bold shape sitting on the
 *  voice line, spanning the bars it occupies, drawn in the lane's own
 *  color. Each model reads differently: `buildUp` = a filled dome rising,
 *  `breakDown` = a filled dome dipping below the line, `cut` = one sharp
 *  spike then silence, `dropOut` = a low fading outline, and the automatic
 *  handoff fill = a bold dashed dome. Height is clamped so it reads
 *  clearly without invading the neighbouring lane. */
function FillDome({
  x1, x2, y, color, model, depth = 1,
}: {
  x1: number; x2: number; y: number; color: string; model: DrumTransitionModel | null; depth?: number;
}) {
  const cx = (x1 + x2) / 2;
  const half = (x2 - x1) / 2;
  const h = Math.min(half, 13) * depth;
  const up = `M ${x1.toFixed(1)} ${y} Q ${cx.toFixed(1)} ${(y - 2 * h).toFixed(1)} ${x2.toFixed(1)} ${y}`;
  const dn = `M ${x1.toFixed(1)} ${y} Q ${cx.toFixed(1)} ${(y + 2 * h).toFixed(1)} ${x2.toFixed(1)} ${y}`;

  if (model === "cut") {
    // one sharp hit, then silence — a narrow spike
    const d = `M ${(cx - half * 0.16).toFixed(1)} ${y} L ${cx} ${(y - 2.4 * h).toFixed(1)} L ${(cx + half * 0.16).toFixed(1)} ${y} Z`;
    return <path d={d} fill={color} stroke={color} strokeWidth={1.2} strokeOpacity={0.95} pointerEvents="none" />;
  }
  if (model === "breakDown") {
    // energy drains — dome dips below the line
    return (
      <g pointerEvents="none">
        <path d={`${dn} Z`} fill={color} fillOpacity={0.4} />
        <path d={dn} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeOpacity={0.95} />
      </g>
    );
  }
  if (model === "dropOut") {
    // groove continues but voices silenced — a low, fading outline
    return (
      <path d={up} fill="none" stroke={color} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" strokeOpacity={0.6} />
    );
  }
  if (model === "buildUp") {
    // density ramp landing on a strong hit — filled dome rising
    return (
      <g pointerEvents="none">
        <path d={`${up} Z`} fill={color} fillOpacity={0.4} />
        <path d={up} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeOpacity={0.95} />
      </g>
    );
  }
  // automatic handoff fill — bold dashed dome
  return (
    <path d={up} fill="none" stroke={color} strokeWidth={3} strokeDasharray="3 4" strokeLinecap="round" strokeOpacity={0.95} />
  );
}

function hexagonPoints(cx: number, cy: number, r: number): string {
  let p = "";
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    p += `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)} `;
  }
  return p.trim();
}

/** Compact "n/d" label for a `drumMeterOutline` — 7/8, 7/16, ... — from its
 *  cells (sum = numerator) and cellBeats (denominator). Shown next to a
 *  section name when its drums run an outline, so an independent drum meter
 *  is explicit rather than only visible as drifted gridlines. */
function outlineMeterLabel(outline: MeterOutline): string {
  const num = outlineNumerator(outline);
  const den = Math.round(4 / outline.cellBeats);
  return `${num}/${den}`;
}

/** Whole-song drum arrangement as an event canvas: a pure-black stage,
 *  a fixed six-lane track (KICK/SNR/RIM/HAT/CYM/TOM, silent lanes
 *  dimmed), no section bands — the top annotation row carries each
 *  section's label with a start/stop bracket, plus the handoff transition
 *  labels. Each lane is a thick track with its beat/bar grid drawn
 *  inside; the pattern's Euclidean necklace is drawn once at the node
 *  where the new k/n starts (repeats just continue the line), variations
 *  read as a lane-colored dotted detour under the line, and fills /
 *  transitions read as bold lane-colored domes sitting on the line.
 *
 *  Editing is dock-based, mirroring Harmony: this view registers
 *  `DrumPatternTools` into the shared dock once (it reads
 *  `useDrumsSelectionStore` itself), and clicking the timeline — a
 *  section, a necklace, a variation detour, or a handoff — just selects
 *  the owning section, which loads its Pattern / Variation / Transition
 *  editors into the dock. */
export default function DrumsView() {
  const song = useSongStore((s) => s.currentSong());
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useDrumsSelectionStore((s) => s.setSelectedSectionId);
  const setTools = useDockStore((s) => s.setTools);

  // Horizontal zoom — stretches/shrinks the bar width so the whole song
  // fits on screen or a few bars get detail. Local to the view, not
  // persisted (a song's drum view is a working surface, not song data).
  const [zoom, setZoom] = useState(1);
  const clampZoom = (z: number) => Math.min(2.5, Math.max(0.4, z));
  const barW = BAR_PX * zoom;
  const barX = (bar: number): number => X0 + bar * barW;

  // A working draft from the Pattern editor — when one exists for a
  // section, the timeline renders it instead of the committed section so
  // slider edits preview live on the lines/necklaces before Apply/Revert.
  const draftSectionId = useDrumsDraftStore((s) => s.sectionId);
  const draftSection = useDrumsDraftStore((s) => s.section);

  // Register the dock editor once (Harmony's pattern) — it reads the
  // shared selection store directly, so clicking the timeline updates it
  // without this view re-pushing fresh JSX into the dock on every click.
  useEffect(() => {
    setTools(<DrumPatternTools />);
    return () => setTools(null);
  }, [setTools]);

  if (!song) return null;
  const spans = sectionSpans(song);

  if (spans.length === 0) {
    return (
      <div className="px-3 pt-3 pb-4">
        <p className="text-inkMuted text-sm">No sections yet — add some in Structure first.</p>
      </div>
    );
  }

  const resolved: ResolvedSpan[] = spans.map((span) => {
    const sec = draftSectionId === span.section.id && draftSection ? draftSection : span.section;
    return {
      span,
      section: sec,
      key: sectionDrumKey(sec, song.concept, span.occurrenceIndex),
      necklaces: resolveSectionVoiceNecklaces(sec, song.concept, span.occurrenceIndex),
    };
  });

  // Real handoff-fill planning — the same function the export path uses,
  // so "would this boundary get an automatic fill" here means the same
  // thing it means at export time.
  const handoffInputs: HandoffSectionInput[] = resolved.map((r) => ({
    sectionId: r.span.sectionId,
    occurrenceIndex: r.span.occurrenceIndex,
    variant: resolveSectionVariant(r.section, song.concept, r.span.occurrenceIndex),
    durationBeats: r.span.durationBeats,
    velocityTarget: velocityNumber(r.span.section.velocity),
  }));
  const handoffPlans = planSectionHandoffFills(handoffInputs, FILL_DATA);

  // The role-aware auto transitions — build up into choruses, break down
  // out of verses, drop out of bridges, cut into outros, seeded catalog
  // flavor + bars for variation. Shown on the timeline the same way the
  // export path renders them, so what you see is what gets exported.
  const autoTransitions = planSectionTransitions(
    resolved.map((r) => ({
      sectionId: r.span.sectionId,
      occurrenceIndex: r.span.occurrenceIndex,
      role: r.section.role ?? null,
      durationBeats: r.span.durationBeats,
      beatsPerBar: beatsPerBar(r.span.section),
      velocityTarget: velocityNumber(r.span.section.velocity),
      manualModel: r.section.drumTransitionModel != null,
      hasVariation: r.section.drumVariationOutline != null,
    })),
  );
  // A generic handoff fill only where no gesture applies (and by seeded
  // spice), so not every section carries a fill.
  const fillApplied: boolean[] = resolved.map((r, i) => {
    if (r.section.drumTransitionModel || r.section.drumVariationOutline) return false;
    if (autoTransitions[i].model !== null) return false;
    if (handoffPlans[i].fillStart === null) return false;
    return hashSeed(`${occurrenceSeed(r.span.sectionId, r.span.occurrenceIndex)}:fill`) % 100 < 45;
  });

  const bars = totalBars(spans);
  const width = barX(bars) + 40;
  const height = STACK_BOTTOM + BOTTOM_PAD;

  const anyLaneHits = resolved.some((r) => DRUM_LANES.some((l) => laneNecklace(l, r.necklaces)));

  // Beat/bar gridlines for the thick tracks — bar boundaries strong,
  // in-bar beats faint, computed per section's own meter so odd meters
  // read correctly inside their own tracks.
  const gridLines: { x: number; bar: boolean }[] = [];
  resolved.forEach((r) => {
    const bpb = beatsPerBar(r.span.section);
    const beatCount = Math.max(1, Math.round(bpb));
    for (let b = 0; b < r.span.bars; b++) {
      gridLines.push({ x: barX(r.span.startBar + b), bar: true });
      for (let beat = 1; beat < beatCount; beat++) {
        gridLines.push({ x: barX(r.span.startBar + b) + beat * (barW / beatCount), bar: false });
      }
    }
  });
  gridLines.push({ x: barX(bars), bar: true });

  // ---- Nested drum-meter ruler: the drums' OWN grid, drawn inside the
  // lane tracks and allowed to drift against the section ruler above. For a
  // section with a `drumMeterOutline` this is the 2s/3s cell grouping (each
  // apple/gallop's start) repeated every outline bar — the amber lines show
  // the drums in a different meter than the section (7/8 inside 4/4, say).
  // For a preset/heuristic section whose groove loop length differs from the
  // section's beats-per-bar, just the loop boundaries are drawn, so a
  // mismatched loop reads as its own period instead of an invisible misalign.
  const drumGridLines: { x: number; bar: boolean; cell: boolean }[] = [];
  resolved.forEach((r, i) => {
    const outline = r.section.drumMeterOutline;
    const sectionBpb = beatsPerBar(r.span.section);
    const startBeat = r.span.startBeat;
    const duration = r.span.durationBeats;

    // The detour (variation) owns its own meter across the section's final
    // bars — the base ruler yields the span to it (inDetour), and the detour's
    // 2s/3s grid is drawn there instead.
    const variation = r.section.drumVariationOutline;
    const vBars = Math.max(1, r.section.drumVariationBars ?? 1);
    const vSpanBeats = Math.min(vBars * sectionBpb, duration);
    const vStartBeat = startBeat + duration - vSpanBeats;
    const inDetour = (absBeat: number) => variation !== undefined && absBeat >= vStartBeat - 1e-9;

    if (outline) {
      const outlineBpb = outlineBeatsPerBar(outline);
      // Beat offset of each cell's start within one outline bar.
      const cellStarts: number[] = [];
      let acc = 0;
      for (const cell of outline.cells) {
        cellStarts.push(acc);
        acc += cell * outline.cellBeats;
      }
      // When the outline meter == the section meter, the outline bar line is
      // the section bar line — drawing it again just makes a brighter line.
      // Only the in-bar cell grouping is the extra information then.
      const drifting = Math.abs(outlineBpb - sectionBpb) > 1e-6;
      for (let bar = 0; bar * outlineBpb < duration + 1e-9; bar++) {
        const barStart = startBeat + bar * outlineBpb;
        cellStarts.forEach((cs, idx) => {
          if (bar === 0 && idx === 0) return; // the very first line == section edge
          const absBeat = barStart + cs;
          if (absBeat < startBeat - 1e-9 || absBeat > startBeat + duration + 1e-9) return;
          if (idx === 0 && !drifting) return;
          if (inDetour(absBeat)) return; // the detour owns its span
          const x = X0 + (absBeat / sectionBpb) * barW;
          drumGridLines.push({ x, bar: idx === 0, cell: idx > 0 });
        });
      }
    } else {
      const loopBeats = handoffInputs[i]?.variant?.lengthBeats;
      if (loopBeats && Math.abs(loopBeats - sectionBpb) > 1e-6) {
        for (let o = 0; o * loopBeats < duration + 1e-9; o++) {
          const absBeat = startBeat + o * loopBeats;
          if (absBeat < startBeat - 1e-9) continue;
          if (inDetour(absBeat)) continue;
          const x = X0 + (absBeat / sectionBpb) * barW;
          drumGridLines.push({ x, bar: true, cell: false });
        }
      }
    }

    // The detour's own meter — its 2s/3s grid across the detour span, so the
    // second ruler follows the detour too, not just the base drum meter.
    if (variation) {
      const vBpb = outlineBeatsPerBar(variation);
      const vCellStarts: number[] = [];
      let vAcc = 0;
      for (const cell of variation.cells) {
        vCellStarts.push(vAcc);
        vAcc += cell * variation.cellBeats;
      }
      const vDrifting = Math.abs(vBpb - sectionBpb) > 1e-6;
      for (let bar = 0; bar * vBpb < vSpanBeats + 1e-9; bar++) {
        const barStart = vStartBeat + bar * vBpb;
        vCellStarts.forEach((cs, idx) => {
          if (bar === 0 && idx === 0) return;
          const absBeat = barStart + cs;
          if (absBeat < vStartBeat - 1e-9 || absBeat > vStartBeat + vSpanBeats + 1e-9) return;
          if (idx === 0 && !vDrifting) return;
          const x = X0 + (absBeat / sectionBpb) * barW;
          drumGridLines.push({ x, bar: idx === 0, cell: idx > 0 });
        });
      }
    }
  });

  function selectSection(sectionId: string) {
    setSelectedSectionId(sectionId);
  }

  /** Drop/move/remove a detour at a section-relative beat — the beat-dot
   *  lane's click handler. Clicking an empty dot creates (or moves) the
   *  detour to start there; clicking the section's active detour dot clears
   *  it. Selects the section so the Detour editor is ready to shape it. */
  function setDetourAt(sectionId: string, startBeat: number) {
    const song = useSongStore.getState().currentSong();
    const sec = song?.sections.find((s) => s.id === sectionId);
    if (!song || !sec) return;
    const bpb = beatsPerBar(sec);
    const duration = sec.bars * bpb;
    const span = Math.min((sec.drumVariationBars ?? 1) * bpb, duration);
    const currentStart = sec.drumVariationStartBeat ?? duration - span;
    useSongStore.getState().updateCurrentSong((s) =>
      updateSection(s, sectionId, (x) => {
        if (x.drumVariationOutline && Math.abs(currentStart - startBeat) < 1e-6) {
          // clicking the active detour dot removes it
          return { ...x, drumVariationOutline: undefined, drumVariationBars: undefined, drumVariationStartBeat: undefined };
        }
        return {
          ...x,
          drumVariationOutline: x.drumVariationOutline ?? defaultDetourFor(x),
          drumVariationStartBeat: startBeat,
        };
      }),
    );
    setSelectedSectionId(sectionId);
  }

  return (
    <div className="px-2 pt-1.5 pb-3">
      {!anyLaneHits && <p className="text-inkMuted text-xs mb-2">No drum voices resolve for this song yet.</p>}
      <div className="relative overflow-x-auto border border-edge rounded bg-black">
        {/* Zoom controls live on the timeline's top row — floating at the
            top-left corner of the viewport (the empty corner above the lane
            labels) so they stay put while the timeline scrolls horizontally,
            no dedicated row above. */}
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 border border-edge rounded bg-black/90 px-1 py-0.5 select-none">
          <button
            className="w-5 h-5 flex items-center justify-center text-inkMuted hover:text-ink text-sm leading-none"
            onClick={() => setZoom((z) => clampZoom(z / 1.2))}
            title="Zoom out"
          >
            −
          </button>
          <span className="font-mono text-2xs text-inkMuted tabular-nums w-9 text-center" title="Timeline zoom">
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="w-5 h-5 flex items-center justify-center text-inkMuted hover:text-ink text-sm leading-none"
            onClick={() => setZoom((z) => clampZoom(z * 1.2))}
            title="Zoom in"
          >
            +
          </button>
        </div>
        <svg width={width} height={height} className="block">
          <defs>
            <filter id="drums-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* ---- top annotation row: section labels + start/stop brackets ---- */}
          {resolved.map((r, i) => {
            const x = barX(r.span.startBar);
            const w = barX(r.span.startBar + r.span.bars) - x;
            const isSelected = r.span.section.id === selectedSectionId;
            const roleColor = SECTION_ROLE_COLOR[r.span.section.role] ?? SECTION_ROLE_COLOR.custom;
            const col = isSelected ? "#E8B54A" : roleColor.rim;
            const outline = r.section.drumMeterOutline;
            return (
              <g key={`sec-${i}`} pointerEvents="none">
                <text x={x + w / 2} y={12} textAnchor="middle" fontSize={12} fontFamily="'IBM Plex Mono', monospace" fontWeight={600} fill={col}>
                  {r.span.section.name}
                  {r.span.occurrenceIndex > 0 ? ` ·${r.span.occurrenceIndex + 1}` : ""}
                  {outline && (
                    <tspan fill="#E8B54A" opacity={0.85} fontSize={10}>
                      {` · ${outlineMeterLabel(outline)}`}
                    </tspan>
                  )}
                </text>
                <path
                  d={`M ${x} ${20} L ${x} ${26} L ${x + w} ${26} L ${x + w} ${20}`}
                  fill="none"
                  stroke={col}
                  strokeWidth={1.6}
                  strokeOpacity={isSelected ? 1 : 0.6}
                />
              </g>
            );
          })}

          {/* ---- transition labels in the top row + boundary ticks ---- */}
          {resolved.slice(0, -1).map((r, i) => {
            const manual = r.section.drumTransitionModel;
            const model = manual ?? autoTransitions[i].model;
            const hasAutoFill = fillApplied[i];
            const x = barX(r.span.startBar + r.span.bars);
            const color = model ? TRANSITION_COLOR[model] : "#565F70";
            return (
              <g key={`tr-${i}`}>
                {(model || hasAutoFill) && (
                  <g pointerEvents="none">
                    <polygon
                      points={hexagonPoints(x, STACK_BOTTOM + 12, 6)}
                      fill={color}
                      fillOpacity={model ? 0.9 : 0.25}
                      stroke={color}
                      strokeWidth={1.2}
                    />
                    <text x={x + 9} y={STACK_BOTTOM + 16} fontSize={10} fontFamily="'IBM Plex Mono', monospace" fontWeight={600} fill={color}>
                      {model ? TRANSITION_LABEL[model].toUpperCase() : "FILL"}
                      {model && !manual ? " ·AUTO" : ""}
                    </text>
                  </g>
                )}
                <line
                  x1={x} y1={STACK_TOP} x2={x} y2={STACK_BOTTOM}
                  stroke={color}
                  strokeWidth={1}
                  strokeDasharray="2 4"
                  strokeOpacity={0.28}
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {/* faint bar numbers at the top of the stack */}
          {Array.from({ length: bars + 1 }).map((_, b) => (
            <text
              key={`bn-${b}`}
              x={barX(b)}
              y={TOP_PAD - 8}
              textAnchor="middle"
              fontSize={10}
              fontFamily="'IBM Plex Mono', monospace"
              fill="#7a7a80"
              pointerEvents="none"
            >
              {b}
            </text>
          ))}

          {/* ---- thick lane tracks: internal beat/bar grid + label + quiet baseline ---- */}
          {DRUM_LANES.map((lane, li) => (
            <g key={`track-${lane.key}`} pointerEvents="none">
              {gridLines.map((g, gi) => (
                <line
                  key={`g-${lane.key}-${gi}`}
                  x1={g.x} y1={TOP_PAD + li * TRACK_H} x2={g.x} y2={trackBottom(li)}
                  stroke="#fff"
                  strokeOpacity={g.bar ? 0.14 : 0.06}
                  strokeWidth={1}
                />
              ))}
              {/* The drum's own meter, amber so it reads as a separate ruler: */}
              {drumGridLines.map((g, gi) => (
                <line
                  key={`dg-${lane.key}-${gi}`}
                  x1={g.x} y1={TOP_PAD + li * TRACK_H} x2={g.x} y2={trackBottom(li)}
                  stroke="#E8B54A"
                  strokeOpacity={g.bar ? 0.2 : 0.09}
                  strokeWidth={g.bar ? 1.4 : 1}
                  strokeDasharray={g.cell ? "1 4" : undefined}
                />
              ))}
              <text x={X0 - 14} y={laneY(li) + 4} textAnchor="end" fontSize={12} fontFamily="'IBM Plex Mono', monospace" fill={lane.color} fontWeight={600}>
                {lane.label}
              </text>
              <line
                x1={barX(0)} y1={laneY(li)} x2={barX(bars)} y2={laneY(li)}
                stroke={lane.color}
                strokeWidth={1}
                strokeOpacity={0.12}
              />
            </g>
          ))}

          {/* ---- lane content: active lines, necklaces, continuation nodes, variations ---- */}
          {DRUM_LANES.map((lane, li) => {
            const y = laneY(li);
            let lastKey: string | null = null;
            return resolved.map((r, i) => {
              const n = laneNecklace(lane, r.necklaces);
              if (!n) {
                lastKey = null;
                return null;
              }
              const x1 = barX(r.span.startBar) + 2;
              const x2 = barX(r.span.startBar + r.span.bars) - 2;
              const isSelected = r.span.section.id === selectedSectionId;
              const sameAsPrev = lastKey === r.key;
              lastKey = r.key;
              const cx = barX(r.span.startBar);
              const variation = r.section.drumVariationOutline;
              const vBars = r.section.drumVariationBars ?? 1;
              // The detour's span on the lane line — from its start beat
              // (or the section's final bars when unset) to where it ends.
              const vBpb = beatsPerBar(r.span.section);
              const vSpanBeats = Math.min(vBars * vBpb, r.span.durationBeats);
              const vStartBeat = r.section.drumVariationStartBeat ?? r.span.durationBeats - vSpanBeats;
              const vX1 = X0 + ((r.span.startBeat + vStartBeat) / vBpb) * barW;
              const vX2 = X0 + ((r.span.startBeat + vStartBeat + vSpanBeats) / vBpb) * barW;

              return (
                <g key={`lane-${lane.key}-${i}`}>
                  {/* the lane's active line */}
                  <line
                    x1={x1} y1={y} x2={x2} y2={y}
                    stroke={lane.color}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeOpacity={isSelected ? 1 : 0.9}
                    pointerEvents="none"
                  />

                  {/* pattern change → necklace at the node where it starts;
                      exact repeat → the line just continues, tiny node */}
                  {!sameAsPrev ? (
                    <g style={{ cursor: "pointer" }} onClick={() => selectSection(r.span.section.id)}>
                      <NecklaceGlyph
                        cx={cx} cy={y} radius={NECK_R}
                        hits={n.hits} steps={n.steps}
                        color={lane.color}
                        backdrop="#0D0F14"
                      />
                      {isSelected && (
                        <circle cx={cx} cy={y} r={NECK_R + 3} fill="none" stroke="#E8B54A" strokeWidth={1.2} strokeDasharray="3 3" />
                      )}
                      <circle cx={cx} cy={y} r={NECK_R + 8} fill="transparent" />
                    </g>
                  ) : (
                    <g pointerEvents="none">
                      <circle cx={barX(r.span.startBar)} cy={y} r={3.6} fill="#0D0F14" stroke={lane.color} strokeWidth={1.6} strokeOpacity={0.85} />
                      <circle cx={barX(r.span.startBar)} cy={y} r={1.5} fill={lane.color} />
                    </g>
                  )}

                  {/* variation detour — a node popping OFF the timeline at its
                      start beat and landing back ON at its end, lane color */}
                  {variation && (
                    <DetourArc
                      x1={vX1}
                      x2={vX2}
                      y={laneY(li)}
                      color={lane.color}
                    />
                  )}
                </g>
              );
            });
          })}

          {/* ---- transitions/fills: bold lane-colored domes on the voice line ---- */}
          {resolved.slice(0, -1).map((r, i) => {
            const manual = r.section.drumTransitionModel;
            const model = manual ?? autoTransitions[i].model;
            const hasAutoFill = fillApplied[i];
            if (!model && !hasAutoFill) return null;
            const tBars = (manual ? (r.section.drumTransitionBars ?? 1) : autoTransitions[i].bars) || 1;
            const g1 = barX(r.span.startBar + r.span.bars - tBars);
            const g2 = barX(r.span.startBar + r.span.bars);
            return DRUM_LANES.map((lane, li) => {
              const n = laneNecklace(lane, r.necklaces);
              if (!n) return null; // the dome lives on lanes active in this section
              const depth = model === "breakDown" && lane.key === "tom" ? 1.6 : 1;
              return (
                <FillDome
                  key={`ts-${i}-${lane.key}`}
                  x1={g1} x2={g2} y={laneY(li)}
                  color={lane.color} model={model ?? null} depth={depth}
                />
              );
            });
          })}

          {/* ---- section hit rects: click anywhere in a section to select it ---- */}
          {resolved.map((r, i) => (
            <rect
              key={`hit-${i}`}
              x={barX(r.span.startBar)}
              y={STACK_TOP}
              width={barX(r.span.startBar + r.span.bars) - barX(r.span.startBar)}
              height={STACK_BOTTOM - STACK_TOP - TRACK_H}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onClick={() => selectSection(r.span.section.id)}
            />
          ))}

          {/* ---- boundary hit rects: click a handoff → the section whose ending it is ---- */}
          {resolved.slice(0, -1).map((r, i) => (
            <rect
              key={`hitb-${i}`}
              x={barX(r.span.startBar + r.span.bars) - 12}
              y={STACK_TOP}
              width={24}
              height={STACK_BOTTOM - STACK_TOP - TRACK_H}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onClick={() => selectSection(r.span.section.id)}
            />
          ))}

          {/* ---- beat-dot detour lane: a full row at the bottom of the
              timeline — one black dot per beat; click to drop/move/remove a
              detour at that spot (the active dot glows amber) ---- */}
          <g>
            <rect
              x={barX(0)}
              y={TOP_PAD + DRUM_LANES.length * TRACK_H}
              width={barX(bars) - barX(0)}
              height={TRACK_H}
              fill="#0a0c10"
            />
            <text x={X0 - 14} y={DETOUR_Y + 4} textAnchor="end" fontSize={12} fontFamily="'IBM Plex Mono', monospace" fill="#7a7a80" fontWeight={600}>
              DETOUR
            </text>
            <line x1={barX(0)} y1={DETOUR_Y} x2={barX(bars)} y2={DETOUR_Y} stroke="#565F70" strokeWidth={1.4} strokeOpacity={0.5} />
            {resolved.map((r, i) => {
              const bpb = Math.max(1, Math.round(beatsPerBar(r.span.section)));
              const beatCount = Math.round(r.span.durationBeats);
              const vSpan = Math.min((r.section.drumVariationBars ?? 1) * bpb, r.span.durationBeats);
              const detourStart = r.section.drumVariationOutline
                ? (r.section.drumVariationStartBeat ?? r.span.durationBeats - vSpan)
                : null;
              return (
                <g key={`bd-sec-${i}`}>
                  {Array.from({ length: beatCount }).map((_, beat) => {
                    const x = X0 + ((r.span.startBeat + beat) / bpb) * barW;
                    const active = detourStart !== null && Math.abs(beat - detourStart) < 1e-6;
                    return (
                      <circle
                        key={`bd-${i}-${beat}`}
                        cx={x}
                        cy={DETOUR_Y}
                        r={active ? 4.5 : 3}
                        fill={active ? "#E8B54A" : "#0D0F14"}
                        stroke={active ? "#E8B54A" : "#9a9aa2"}
                        strokeWidth={active ? 0 : 1.2}
                        style={{ cursor: "pointer" }}
                        onClick={() => setDetourAt(r.span.section.id, beat)}
                      >
                        <title>{active ? "Detour starts here — click to remove" : `Insert a detour at beat ${beat}`}</title>
                      </circle>
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* ---- necklace hit circles (drawn last so they sit above the hit rects) ---- */}
          {DRUM_LANES.map((lane, li) => {
            const y = laneY(li);
            let lastKey: string | null = null;
            return resolved.map((r, i) => {
              const n = laneNecklace(lane, r.necklaces);
              if (!n) {
                lastKey = null;
                return null;
              }
              const sameAsPrev = lastKey === r.key;
              lastKey = r.key;
              if (sameAsPrev) return null;
              const cx = barX(r.span.startBar);
              return (
                <circle
                  key={`hitn-${lane.key}-${i}`}
                  cx={cx} cy={y} r={NECK_R + 8}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onClick={() => selectSection(r.span.section.id)}
                />
              );
            });
          })}
        </svg>
      </div>
    </div>
  );
}
