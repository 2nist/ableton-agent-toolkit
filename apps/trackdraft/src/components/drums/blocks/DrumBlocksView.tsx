import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DRUM_LANE_PRIMARY,
  FILL_DATA,
  PRESET_DATA,
  compatibleVariantIndices,
  hashSeed,
  occurrenceSeed,
  planSectionHandoffFills,
  planSectionTransitions,
  type DrumLaneId,
  type TransitionModel,
} from "@drum/library";
import { useSongStore } from "../../../store/songStore";
import { useDrumsSelectionStore } from "../../../store/drumsSelectionStore";
import { useDrumsDraftStore } from "../../../store/drumsDraftStore";
import { updateSection } from "../../../lib/sections";
import { sectionSpans, totalBars, type SectionSpan } from "../../../lib/arrangement";
import { resolveSectionLaneHits, type LaneHit, type LaneHits } from "../../../lib/timeline/drumLaneHits";
import { inferPatternForSection, resolveSectionVariant, seededVariantIndex, velocityNumber } from "../../../lib/playback/drumPreview";
import {
  BAR_PX, TOP_PAD, TRACK_H, X0,
  barX, beatsPerBarOf, gridStepForZoom, snapBeat, spanBeatToX, spanXToBeat, xToSpanBeat,
} from "../../../lib/timeline/beatMap";
import { beatsPerBar, sectionDurationBeats, type BlueprintSection, type DrumBlock, type DrumBlockNote, type DrumVoiceName } from "../../../types/blueprint";
import { DRUM_LANES } from "../laneStyle";
import { SECTION_ROLE_COLOR } from "../sectionRoleStyle";
import { TRANSITION_COLOR, TRANSITION_LABEL } from "../transitionStyle";
import SelectionPad, { PAD_PANEL_H, PAD_PANEL_W, PAD_SCALE } from "./SelectionPad";
import SelectionEditorModal from "./SelectionEditorModal";
import SelectionWorkbench from "./SelectionWorkbench";
import { boxMetrics, CELL_TOP_PAD, copyBlocksToRange, euclidBlocksFor, motionBlockFor, motionLabelFor, replaceRangeBlocks, stripFxCarriers, upsertBlocks, upsertModeBlocks } from "./selectionMath";
import { clampParam, cycleValue, PARAM_SPECS, STEP_PARAMS, type ParamDraftNote, type StepParam } from "./stepParams";
import { scaleVelocity, velocityOpFactor, type VelocityOp } from "./velocityOps";

/**
 * The Drum Blocks view — the alternate drums timeline. Every lane is a row
 * of step dots (the retired DETOUR lane's click-to-edit gesture applied to
 * all six lanes); a marquee drag across beats × drums creates the
 * selection, and the XY pad docks to the right of it in one cluster with
 * the mode buttons. Edits write `BlueprintSection.drumBlocks` through the
 * shared drums draft store, so the existing draft flow (● preview /
 * Apply / Revert) and the next-bar live refresh come for free — and the
 * same `applyDrumBlocks` the export paths use means what you see is what
 * plays.
 *
 * v1 interactions: marquee select · click a dot to toggle a hit · drag
 * the pad (Euclid: k/rotation; Motion: gesture vector). Zoom-adaptive dot
 * subdivision, dot-drag velocity, selection move/resize and the ⤢ step
 * editor are the next pass.
 */

const LANE_COUNT = DRUM_LANES.length;
const STACK_BOTTOM = TOP_PAD + LANE_COUNT * TRACK_H;
const HEIGHT = STACK_BOTTOM + 22;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Pointer capture is a nicety (keeps a drag alive outside the svg); the
 *  browser throws for pointers it no longer considers active, so never let
 *  a failed capture abort a gesture. */
function capture(el: Element, pointerId: number): void {
  try { el.setPointerCapture(pointerId); } catch { /* not capturable — fine */ }
}

/**
 * Circular-cell metrics for the step lanes — cells are packed as tightly
 * as the grid allows (sequencer-style: a hair of gap between steps) and sit
 * at the TOP of each lane. The space below a lane's cell row carries the
 * velocity indicator strip; during a drag it also hosts the slider readout.
 * Cell radius grows with zoom, and the step grid itself subdivides with
 * zoom (`gridStepForZoom`), so the on-screen spacing stays workable.
 */
const CELL_MAX_R = 11;
function cellMetrics(zoom: number, beatsPerBar: number, stepBeats: number): { spacing: number; r: number } {
  const spacing = (stepBeats * BAR_PX * zoom) / beatsPerBar;
  const r = Math.max(1.4, Math.min(spacing / 2 - 1, CELL_MAX_R));
  return { spacing, r };
}
const cellCy = (li: number, r: number): number => TOP_PAD + li * TRACK_H + CELL_TOP_PAD + r;

interface MarqueeState { x0: number; y0: number; x1: number; y1: number }

/** The circular cell a press landed on — feeds both click-to-toggle and the
 *  drag-up/down velocity gesture. */
interface CellPress {
  span: SectionSpan;
  laneKey: DrumLaneId;
  stepBeat: number;
  /** Peak velocity on this step; null when the cell is empty. */
  velocity: number | null;
  cx: number;
  cy: number;
}

/** One press→release gesture on the canvas. */
interface PressState {
  x0: number;
  y0: number;
  /** The circular cell under the press — feeds click-to-toggle and the
   *  drag-up/down velocity gesture. */
  cell: CellPress | null;
  /** Which surface the press landed on: the cell ring (toggle + value) or
   *  the value box below it (the parameter surface — a click there never
   *  toggles the step; discrete params cycle). */
  zone: "cell" | "value" | null;
  /** The lane's active parameter at press time + the step's value of it. */
  param: StepParam;
  paramStart: number;
  /** True when the step has something editable (a hit or an authored note). */
  editable: boolean;
  velMode: boolean;
  /** Set when a value-zone drag covers MULTIPLE steps (a range selection
   *  over the pressed step) — the press-time snapshot the scrub writes are
   *  rebuilt from, so repeated moves never compound. */
  scrub?: ParamScrubTarget | null;
}

/** An in-flight ⌥-drag copy of the selection. */
interface CopyDragState {
  span: SectionSpan;
  range: { startBeat: number; endBeat: number; laneKeys: string[] };
  /** The beat under the press — the drag delta is measured from here. */
  grabBeat: number;
  /** The step grid captured at grab time (deltas snap to it). */
  grid: number;
  /** Where the copy will land (updated on every move). */
  destStart: number;
}

/** A press-time snapshot for a selection-wide parameter scrub: every step
 *  in the range that has an authored note or a resolved hit, with its full
 *  note draft preserved so other parameters survive the edit. */
interface ParamScrubTarget {
  param: StepParam;
  laneKey: DrumLaneId;
  start: number;
  end: number;
  /** The pressed step's value at press time (the drag origin). */
  pressed0: number;
  targets: { draft: ParamDraftNote; value0: number }[];
}

/** An in-flight selection-edge resize. */
interface HandleDragState {
  kind: "left" | "right" | "top" | "bottom";
  span: SectionSpan;
  range: { startBeat: number; endBeat: number; laneKeys: string[] };
}

interface PadDragState {
  clientX: number;
  clientY: number;
  k: number;
  rotation: number;
  mx: number;
  my: number;
  span: SectionSpan;
  range: { startBeat: number; endBeat: number };
  laneKeys: string[];
}

export default function DrumBlocksView() {
  const song = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useDrumsSelectionStore((s) => s.setSelectedSectionId);
  const range = useDrumsSelectionStore((s) => s.range);
  const setRange = useDrumsSelectionStore((s) => s.setRange);
  const clearRange = useDrumsSelectionStore((s) => s.clearRange);
  const draftSectionId = useDrumsDraftStore((s) => s.sectionId);
  const draftSection = useDrumsDraftStore((s) => s.section);

  const [zoom, setZoom] = useState(1.4);
  const [padMode, setPadMode] = useState<"euclid" | "motion">("euclid");
  const [editorOpen, setEditorOpen] = useState(false);
  const [paramMenu, setParamMenu] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [copyDrag, setCopyDrag] = useState<{ dxPx: number; destStart: number } | null>(null);
  const [velocityDrag, setVelocityDrag] = useState<{ x: number; y: number; text: string; label: string; frac: number } | null>(null);
  /** Per-lane parameter lane — which step parameter the value boxes show
   *  and edit (the "effects lane" dropdown). Persisted per browser. */
  const [laneParams, setLaneParams] = useState<Record<string, StepParam>>(() => {
    try { return JSON.parse(localStorage.getItem("trackdraft-drums-lane-param") || "{}"); } catch { return {}; }
  });
  const setLaneParam = useCallback((laneKey: string, p: StepParam) => {
    setLaneParams((m) => {
      const next = { ...m, [laneKey]: p };
      try { localStorage.setItem("trackdraft-drums-lane-param", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setParamMenu(null);
  }, []);
  const paramFor = useCallback((laneKey: string): StepParam => laneParams[laneKey] ?? "vel", [laneParams]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const handleRef = useRef<HandleDragState | null>(null);
  const padDragRef = useRef<PadDragState | null>(null);
  const copyRef = useRef<CopyDragState | null>(null);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Wheel zoom, cursor-anchored: ⌘/Ctrl anywhere (incl. trackpad pinch),
  // and a PLAIN wheel while the pointer is over the sequencer's cell area
  // — the grid itself is the zoom surface there. Elsewhere the plain wheel
  // keeps the browser's native scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Horizontal pans (trackpad two-finger swipe) stay native scrolls —
      // the grid's wheel gesture is vertical-only zoom.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const rect = el.getBoundingClientRect();
      const localY = e.clientY - rect.top;
      const overCells = localY >= TOP_PAD && localY <= STACK_BOTTOM;
      if (!e.ctrlKey && !e.metaKey && !overCells) return;
      e.preventDefault();
      const prev = zoomRef.current;
      const next = clamp(prev * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.5, 6);
      if (Math.abs(next - prev) < 1e-6) return;
      const viewX = e.clientX - rect.left;
      const contentX = viewX + el.scrollLeft;
      const nextContentX = X0 + (contentX - X0) * (next / prev);
      setZoom(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, nextContentX - viewX);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);
  const width = useMemo(() => barX(totalBars(spans), zoom) + 40, [spans, zoom]);

  /** The section a span renders — the working draft when one is open for
   *  it (live preview of uncommitted block edits), else the committed one. */
  const effectiveSection = useCallback(
    (span: SectionSpan): BlueprintSection =>
      draftSectionId === span.section.id && draftSection ? draftSection : span.section,
    [draftSectionId, draftSection],
  );

  const hitsBySpan = useMemo(() => {
    const map = new Map<string, LaneHits>();
    for (const span of spans) {
      const key = `${span.section.id}:${span.occurrenceIndex}`;
      if (map.has(key)) continue;
      map.set(key, resolveSectionLaneHits(effectiveSection(span), song ?? undefined, span.occurrenceIndex));
    }
    return map;
  }, [spans, song, effectiveSection]);
  const hitsForSpan = useCallback(
    (span: SectionSpan): LaneHits => hitsBySpan.get(`${span.section.id}:${span.occurrenceIndex}`) ?? new Map(),
    [hitsBySpan],
  );

  /** The automatic gesture + handoff-fill readout per section END — the
   *  exact planner inputs the classic view (and `planSectionDrumNotes`) use,
   *  so a tag on a boundary means the same thing it means at export. Sections
   *  whose base groove resolves to null show nothing: nothing is layered
   *  under a blocks-only section (it stays pure). Ambience only — never a
   *  gesture target. */
  const autoReadout = useMemo(() => {
    const resolved = spans.map((span) => {
      const section = effectiveSection(span);
      return { span, section, variant: resolveSectionVariant(section, song ?? undefined, span.occurrenceIndex) };
    });
    const handoffPlans = planSectionHandoffFills(
      resolved.map((r) => ({
        sectionId: r.span.sectionId,
        occurrenceIndex: r.span.occurrenceIndex,
        variant: r.variant,
        durationBeats: r.span.durationBeats,
        velocityTarget: velocityNumber(r.section.velocity),
      })),
      FILL_DATA,
    );
    const autoTransitions = planSectionTransitions(
      resolved.map((r) => ({
        sectionId: r.span.sectionId,
        occurrenceIndex: r.span.occurrenceIndex,
        role: r.section.role ?? null,
        durationBeats: r.span.durationBeats,
        beatsPerBar: beatsPerBar(r.span.section),
        velocityTarget: velocityNumber(r.section.velocity),
        manualModel: r.section.drumTransitionModel != null,
        hasVariation: r.section.drumVariationOutline != null,
      })),
    );
    return resolved.map((r, i): { model: TransitionModel | null; manual: boolean; bars: number; fill: boolean; detourStartBeat: number | null } | null => {
      if (!r.variant) return null;
      const manual = r.section.drumTransitionModel ?? null;
      const model = manual ?? autoTransitions[i].model;
      const fill = !manual && !r.section.drumVariationOutline
        && autoTransitions[i].model === null
        && handoffPlans[i].fillStart !== null
        && hashSeed(`${occurrenceSeed(r.span.sectionId, r.span.occurrenceIndex)}:fill`) % 100 < 45;
      // An authored detour is still authored in the classic view / dock —
      // show WHERE it starts here so blocks users aren't blind to it (it
      // applies at export; a selection edit authors the same shape change).
      // Mirrors applyVariation's span math.
      const barBeats = beatsPerBar(r.span.section);
      const maxBars = Math.floor(r.span.durationBeats / barBeats);
      let detourStartBeat: number | null = null;
      if (r.section.drumVariationOutline && maxBars >= 1) {
        const spanBars = Math.max(1, Math.min(Math.round(r.section.drumVariationBars ?? 1), maxBars));
        if (!(spanBars >= maxBars && maxBars < 2)) {
          const spanBeats = spanBars * barBeats;
          detourStartBeat = round4(Math.max(0, Math.min(
            r.section.drumVariationStartBeat ?? r.span.durationBeats - spanBeats,
            r.span.durationBeats - spanBeats,
          )));
        }
      }
      if (!model && !fill && detourStartBeat === null) return null;
      return {
        model,
        manual: manual != null,
        bars: manual ? (r.section.drumTransitionBars ?? 1) : autoTransitions[i].bars,
        fill,
        detourStartBeat,
      };
    });
  }, [spans, song, effectiveSection]);

  /** All block edits funnel through here — always into the draft store
   *  (starting a fresh draft from the committed section when needed), so
   *  Apply/Revert and the live refresh behave exactly like the classic
   *  dock editors. */
  const writeSection = useCallback(
    (sectionId: string, base: BlueprintSection, mutate: (sec: BlueprintSection) => BlueprintSection) => {
      const current = useDrumsDraftStore.getState();
      const sec = current.sectionId === sectionId && current.section ? current.section : base;
      useDrumsDraftStore.getState().setDraft(sectionId, mutate(sec));
    },
    [],
  );

  const applyDraft = useCallback(() => {
    const st = useDrumsDraftStore.getState();
    if (st.sectionId && st.section) {
      const sectionId = st.sectionId;
      const next = st.section;
      updateCurrentSong((s) => updateSection(s, sectionId, () => next));
      useDrumsDraftStore.getState().clearDraft();
    }
    // Apply (and Cancel) END the editing session: the selection + popup
    // close with the commit, so the user never has to click away.
    setEditorOpen(false);
    clearRange();
  }, [updateCurrentSong, clearRange]);
  const revertDraft = useCallback(() => {
    useDrumsDraftStore.getState().clearDraft();
    setEditorOpen(false);
    clearRange();
  }, [clearRange]);

  // ---- selection → pad values -------------------------------------------------

  const anchorSpan = useMemo(
    () => spans.find((s) => s.section.id === selectedSectionId) ?? null,
    [spans, selectedSectionId],
  );
  const selectionSection = anchorSpan ? effectiveSection(anchorSpan) : null;
  const primaryLane = (range?.laneKeys[0] ?? null) as DrumLaneId | null;

  const existingEuclid = useMemo(() => {
    if (!selectionSection || !range || !primaryLane) return null;
    return (selectionSection.drumBlocks ?? []).find(
      (b) => b.mode === "euclid" && b.lane === primaryLane &&
        Math.abs(b.startBeat - range.startBeat) < 1e-6 && Math.abs(b.endBeat - range.endBeat) < 1e-6,
    ) ?? null;
  }, [selectionSection, range, primaryLane]);

  const existingMotion = useMemo(() => {
    if (!selectionSection || !range || !primaryLane) return null;
    return (selectionSection.drumBlocks ?? []).find(
      (b) => b.mode === "motion" && b.lane === primaryLane &&
        Math.abs(b.startBeat - range.startBeat) < 1e-6 && Math.abs(b.endBeat - range.endBeat) < 1e-6,
    ) ?? null;
  }, [selectionSection, range, primaryLane]);

  const nSteps = range ? Math.max(1, Math.round(range.endBeat - range.startBeat)) : 4;
  const euclid = existingEuclid?.euclid ?? { k: Math.max(1, Math.round(nSteps / 2)), n: nSteps, rotation: 0 };
  const motion = existingMotion?.motion ?? { x: 0, y: 0 };
  const motionLabel = motionLabelFor(motion);
  const laneColors = (range?.laneKeys ?? []).map(
    (k) => DRUM_LANES.find((l) => l.key === k)?.color ?? "#B0B0B0",
  );

  // ---- selection pixels -------------------------------------------------------

  const selRects = useMemo(() => {
    if (!range || !selectedSectionId) return [] as { x1: number; y1: number; x2: number; y2: number; span: SectionSpan }[];
    const laneIdxs = range.laneKeys
      .map((k) => DRUM_LANES.findIndex((l) => l.key === k))
      .filter((i) => i >= 0);
    if (laneIdxs.length === 0) return [];
    const y1 = TOP_PAD + Math.min(...laneIdxs) * TRACK_H;
    const y2 = TOP_PAD + (Math.max(...laneIdxs) + 1) * TRACK_H;
    const rects: { x1: number; y1: number; x2: number; y2: number; span: SectionSpan }[] = [];
    for (const span of spans) {
      if (span.section.id !== selectedSectionId) continue;
      rects.push({
        x1: spanBeatToX(span, range.startBeat, zoom),
        y1,
        x2: spanBeatToX(span, range.endBeat, zoom),
        y2,
        span,
      });
    }
    return rects;
  }, [range, selectedSectionId, spans, zoom]);

  const padRect = selRects[0] ?? null;
  const panelX = padRect ? clamp(padRect.x2 + 24, 8, width - PAD_PANEL_W * PAD_SCALE - 8) : 0;
  const panelY = padRect ? clamp(padRect.y1 - 12, 4, HEIGHT - (PAD_PANEL_H * PAD_SCALE + 34) - 6) : 0;

  // ---- gestures ---------------------------------------------------------------

  const toLocal = useCallback((e: ReactPointerEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  const toggleStep = useCallback(
    (span: SectionSpan, laneKey: DrumLaneId, beat: number, stepSize: number) => {
      const sec = effectiveSection(span);
      const hits = resolveSectionLaneHits(sec, song ?? undefined, span.occurrenceIndex);
      const laneHits = hits.get(laneKey) ?? [];
      const existing = (sec.drumBlocks ?? []).find(
        (b) => b.mode === "steps" && b.lane === laneKey && beat >= b.startBeat - 1e-9 && beat < b.endBeat - 1e-9,
      );
      const start = existing ? existing.startBeat : beat;
      const end = existing ? existing.endBeat : round4(beat + stepSize);
      const tol = Math.max(0.02, stepSize * 0.35);
      const inRange = laneHits.filter((h) => h.beat >= start - 1e-9 && h.beat < end - 1e-9);
      const hasHit = inRange.some((h) => Math.abs(h.beat - beat) < tol);

      // The authored notes mirror what's currently audible in the range,
      // with the clicked step flipped (every voice on that step drops when
      // toggling off — that's the delete gesture).
      const notes: DrumBlockNote[] = [];
      for (const h of inRange) {
        if (Math.abs(h.beat - beat) < tol) continue;
        notes.push({ beat: round4(h.beat - start), voice: h.voice as DrumVoiceName, velocity: h.velocity });
      }
      if (!hasHit) {
        const avg = inRange.length > 0
          ? Math.round(inRange.reduce((sum, h) => sum + h.velocity, 0) / inRange.length)
          : 100;
        notes.push({ beat: round4(beat - start), voice: DRUM_LANE_PRIMARY[laneKey] as DrumVoiceName, velocity: avg });
      }

      const block: DrumBlock = {
        id: existing?.id ?? `blk-${laneKey}-${round4(start)}-${round4(end)}-steps`,
        lane: laneKey,
        startBeat: start,
        endBeat: end,
        mode: "steps",
        notes,
      };
      writeSection(span.section.id, span.section, (s) => ({ ...s, drumBlocks: upsertModeBlocks(s.drumBlocks, start, end, [block]) }));
      setSelectedSectionId(span.section.id);
    },
    [effectiveSection, song, writeSection, setSelectedSectionId],
  );

  /** The authored step notes for a lane in a span, keyed by step index —
   *  what the value boxes read beyond velocity, and what the parameter
   *  edits preserve (a probability-dropped note has no resolved hit but
   *  stays visible and editable through this map). */
  const authoredNotesFor = useCallback((span: SectionSpan, laneKey: DrumLaneId, stepBeats: number): Map<number, DrumBlockNote> => {
    const map = new Map<number, DrumBlockNote>();
    const sec = effectiveSection(span);
    const tol = Math.max(0.02, stepBeats * 0.35);
    for (const b of sec.drumBlocks ?? []) {
      if (b.mode !== "steps" || b.lane !== laneKey) continue;
      for (const n of b.notes ?? []) {
        const abs = b.startBeat + n.beat;
        const idx = Math.round(abs / stepBeats);
        if (idx < 0 || Math.abs(abs - idx * stepBeats) > tol) continue;
        const prev = map.get(idx);
        if (!prev || n.velocity > prev.velocity) map.set(idx, n);
      }
    }
    return map;
  }, [effectiveSection]);

  /** Single-step parameter edit. An existing authored block is edited in
   *  place (other parameters on the note survive); base-groove steps
   *  flatten from what's audible first — same WYSIWYG rule as tapping a
   *  step through, one field at a time. */
  const writeStepParam = useCallback((cell: CellPress, param: StepParam, value: number) => {
    const spec = PARAM_SPECS[param];
    const sec = effectiveSection(cell.span);
    const grid = gridStepForZoom(zoom);
    const laneHits = resolveSectionLaneHits(sec, song ?? undefined, cell.span.occurrenceIndex).get(cell.laneKey) ?? [];
    const tol = Math.max(0.02, grid * 0.35);
    const existing = (sec.drumBlocks ?? []).find(
      (b) => b.mode === "steps" && b.lane === cell.laneKey && cell.stepBeat >= b.startBeat - 1e-9 && cell.stepBeat < b.endBeat - 1e-9,
    );
    const start = existing ? existing.startBeat : cell.stepBeat;
    const end = existing ? existing.endBeat : round4(cell.stepBeat + grid);
    let notes: DrumBlockNote[];
    if (existing && (existing.notes?.length ?? 0) > 0) {
      notes = (existing.notes ?? []).map((n) => ({ ...n }));
      let target = notes.find((n) => Math.abs(start + n.beat - cell.stepBeat) < tol);
      if (!target) {
        const onStep = laneHits.filter((h) => Math.abs(h.beat - cell.stepBeat) < tol);
        if (onStep.length === 0) return;
        const loudest = onStep.reduce((a, b) => (b.velocity > a.velocity ? b : a));
        target = { beat: round4(loudest.beat - start), voice: loudest.voice as DrumVoiceName, velocity: loudest.velocity };
        notes.push(target);
      }
      spec.write(target, value, grid);
    } else {
      const onStep = laneHits.filter((h) => Math.abs(h.beat - cell.stepBeat) < tol);
      if (onStep.length === 0) return;
      const loudest = onStep.reduce((a, b) => (b.velocity > a.velocity ? b : a));
      notes = onStep.map((h) => ({ beat: round4(h.beat - start), voice: h.voice as DrumVoiceName, velocity: h.velocity }));
      const target = notes.find((n) => n.voice === loudest.voice && Math.abs(start + n.beat - loudest.beat) < 1e-6);
      if (!target) return;
      spec.write(target, value, grid);
    }
    const block: DrumBlock = {
      id: existing?.id ?? `blk-${cell.laneKey}-${round4(start)}-${round4(end)}-steps`,
      lane: cell.laneKey,
      startBeat: start,
      endBeat: end,
      mode: "steps",
      notes,
    };
    writeSection(cell.span.section.id, cell.span.section, (s) => ({ ...s, drumBlocks: upsertModeBlocks(s.drumBlocks, start, end, [block]) }));
  }, [effectiveSection, song, writeSection, zoom]);

  const onCanvasDown = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = toLocal(e);
    if (y > STACK_BOTTOM) return;
    const startHit = xToSpanBeat(spans, x, zoom);
    if (!startHit) return;
    capture(e.currentTarget as Element, e.pointerId);

    // ⌥-drag inside the selection = copy. Capture the source up front; the
    // drop writes the authored blocks (or the audible material) elsewhere.
    if (e.altKey && range && anchorSpan) {
      const inSel = selRects.some((r) => x >= r.x1 - 2 && x <= r.x2 + 2 && y >= r.y1 - 2 && y <= r.y2 + 2);
      if (inSel) {
        copyRef.current = {
          span: anchorSpan,
          range: { startBeat: range.startBeat, endBeat: range.endBeat, laneKeys: [...range.laneKeys] },
          grabBeat: spanXToBeat(anchorSpan, x, zoom),
          grid: gridStepForZoom(zoom),
          destStart: range.startBeat,
        };
        setCopyDrag({ dxPx: 0, destStart: range.startBeat });
        setMarquee(null);
        return;
      }
    }

    // Resolve the surface under the press up front — the circular CELL
    // (click-to-toggle + drag = the lane's parameter) or the value BOX
    // below it (the parameter surface; a click never toggles the step).
    let cell: CellPress | null = null;
    let zone: PressState["zone"] = null;
    let param: StepParam = "vel";
    let paramStart = 100;
    let editable = false;
    if (y >= TOP_PAD && y <= STACK_BOTTOM) {
      const span = startHit.span;
      const stepBeats = gridStepForZoom(zoom);
      const laneIdx = clamp(Math.floor((y - TOP_PAD) / TRACK_H), 0, LANE_COUNT - 1);
      const stepCount = Math.max(1, Math.ceil(span.durationBeats / stepBeats - 1e-9));
      const stepIdx = clamp(Math.round(startHit.beat / stepBeats), 0, stepCount - 1);
      const stepBeat = round4(stepIdx * stepBeats);
      const { r, spacing } = cellMetrics(zoom, beatsPerBarOf(span), stepBeats);
      const cx = spanBeatToX(span, stepBeat, zoom);
      const cy = cellCy(laneIdx, r);
      const bm = boxMetrics(laneIdx, r, spacing);
      const laneKey = DRUM_LANES[laneIdx].key as DrumLaneId;
      const laneHits = hitsForSpan(span).get(laneKey) ?? [];
      const tol = Math.max(0.02, stepBeats * 0.35);
      const onStep = laneHits.filter((h) => Math.abs(h.beat - stepBeat) < tol);
      const peak = onStep.length > 0 ? Math.max(...onStep.map((h) => h.velocity)) : null;
      if (Math.hypot(cx - x, cy - y) <= r + 3) {
        cell = { span, laneKey, stepBeat, velocity: peak, cx, cy };
        zone = "cell";
      } else if (bm && y >= bm.top - 2 && y <= bm.bottom + 2 && Math.abs(cx - x) <= bm.w / 2 + 1.5) {
        // Anchor the floating readout on the box, not the circle.
        cell = { span, laneKey, stepBeat, velocity: peak, cx, cy: (bm.top + bm.bottom) / 2 };
        zone = "value";
      }
      if (cell) {
        const activeParam = paramFor(laneKey);
        const activeSpec = PARAM_SPECS[activeParam];
        const authored = authoredNotesFor(span, laneKey, stepBeats).get(stepIdx);
        const authoredVal = authored ? activeSpec.read(authored, stepBeats) : undefined;
        param = activeParam;
        paramStart = activeParam === "vel" ? (peak ?? authoredVal ?? activeSpec.rest) : (authoredVal ?? activeSpec.rest);
        editable = onStep.length > 0 || !!authored;
      }
    }
    pressRef.current = { x0: x, y0: y, cell, zone, param, paramStart, editable, velMode: false };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  }, [spans, zoom, toLocal, hitsForSpan, paramFor, authoredNotesFor, range, anchorSpan, selRects]);

  /** Press-time snapshot for a selection-wide parameter scrub: every step
   *  in the range (authored notes stay canonical — a probability-dropped
   *  step keeps its box; resolved-only steps flatten in), with the full
   *  note draft and its starting value for the drag delta. */
  const buildParamScrub = useCallback((cell: CellPress, param: StepParam, pressed0: number): ParamScrubTarget | null => {
    const st = useDrumsSelectionStore.getState();
    const rng = st.range;
    const grid = gridStepForZoom(zoom);
    if (!rng || rng.endBeat - rng.startBeat <= grid + 1e-6) return null;
    if (cell.stepBeat < rng.startBeat - 1e-6 || cell.stepBeat >= rng.endBeat - 1e-6) return null;
    const spec = PARAM_SPECS[param];
    const sec = effectiveSection(cell.span);
    const laneHits = (hitsForSpan(cell.span).get(cell.laneKey) ?? [])
      .filter((h) => h.beat >= rng.startBeat - 1e-9 && h.beat < rng.endBeat - 1e-9);
    const tol = Math.max(0.02, grid * 0.35);
    const targets: ParamScrubTarget["targets"] = [];
    for (const b of sec.drumBlocks ?? []) {
      if (b.mode !== "steps" || b.lane !== cell.laneKey) continue;
      for (const n of b.notes ?? []) {
        const abs = b.startBeat + n.beat;
        if (abs < rng.startBeat - 1e-9 || abs >= rng.endBeat - 1e-9) continue;
        targets.push({
          draft: {
            beat: round4(abs - rng.startBeat), voice: n.voice, velocity: n.velocity,
            offsetBeats: n.offsetBeats, durBeats: n.durBeats, prob: n.prob, ratchet: n.ratchet, flam: n.flam,
          },
          value0: spec.read(n, grid) ?? spec.rest,
        });
      }
    }
    const covered = new Set(targets.map((t) => Math.round((rng.startBeat + t.draft.beat) / grid)));
    const stepCount = Math.max(1, Math.ceil(cell.span.durationBeats / grid - 1e-9));
    for (let q = 0; q < stepCount; q++) {
      const stepBeat = q * grid;
      if (stepBeat < rng.startBeat - 1e-9 || stepBeat >= rng.endBeat - 1e-9) continue;
      if (covered.has(q)) continue;
      const onStep = laneHits.filter((h) => Math.abs(h.beat - stepBeat) < tol);
      for (const h of onStep) {
        targets.push({
          draft: { beat: round4(h.beat - rng.startBeat), voice: h.voice, velocity: h.velocity },
          value0: param === "vel" ? h.velocity : spec.rest,
        });
      }
      if (onStep.length > 0) covered.add(q);
    }
    if (targets.length === 0) return null;
    return { param, laneKey: cell.laneKey, start: rng.startBeat, end: rng.endBeat, pressed0, targets };
  }, [zoom, hitsForSpan, effectiveSection]);

  /** Range scrub write: one steps block over the selection, rebuilt from
   *  the press-time snapshot — continuous params move by the drag delta,
   *  discrete params take the dragged value across the range. */
  const scrubParam = useCallback((span: SectionSpan, s: ParamScrubTarget, value: number) => {
    const spec = PARAM_SPECS[s.param];
    const grid = gridStepForZoom(zoom);
    const delta = value - s.pressed0;
    const notes: DrumBlockNote[] = s.targets.map((t) => {
      const next = spec.kind === "continuous" ? clampParam(spec, t.value0 + delta) : value;
      const draft = { ...t.draft };
      spec.write(draft, next, grid);
      return { ...draft, voice: draft.voice as DrumVoiceName };
    });
    const block: DrumBlock = {
      id: `blk-${s.laneKey}-${round4(s.start)}-${round4(s.end)}-steps`,
      lane: s.laneKey,
      startBeat: s.start,
      endBeat: s.end,
      mode: "steps",
      notes,
    };
    writeSection(span.section.id, span.section, (sec) => ({ ...sec, drumBlocks: upsertModeBlocks(sec.drumBlocks, s.start, s.end, [block]) }));
  }, [writeSection, zoom]);

  /** The selection's audible material for one lane, grouped per step — what
   *  flatten writes verbatim and what the velocity ops scale. */
  const laneRangeMaterial = useCallback(
    (span: SectionSpan, laneKey: DrumLaneId, start: number, end: number) => {
      const grid = gridStepForZoom(zoom);
      const hits = (hitsForSpan(span).get(laneKey) ?? [])
        .filter((h) => h.beat >= start - 1e-9 && h.beat < end - 1e-9);
      if (hits.length === 0) return null;
      const stepCount = Math.max(1, Math.ceil((end - start) / grid - 1e-9));
      const entries = hits.map((h) => ({
        h,
        stepIdx: clamp(Math.round((h.beat - start) / grid), 0, stepCount - 1),
      }));
      const peaks = new Array<number>(stepCount).fill(0);
      for (const e of entries) peaks[e.stepIdx] = Math.max(peaks[e.stepIdx], e.h.velocity);
      return { entries, peaks, stepCount, peak: Math.max(...peaks) };
    },
    [zoom, hitsForSpan],
  );

  const stepsBlockFor = (laneKey: DrumLaneId, start: number, end: number, notes: DrumBlockNote[]): DrumBlock => ({
    id: `blk-${laneKey}-${round4(start)}-${round4(end)}-steps`,
    lane: laneKey,
    startBeat: start,
    endBeat: end,
    mode: "steps",
    notes,
  });

  /** Flatten — freeze the selection's audible material into editable dots
   *  (the algorithm underneath is replaced, so the dots are what plays). */
  const flattenSelection = useCallback((span: SectionSpan, rng: { startBeat: number; endBeat: number; laneKeys: string[] }) => {
    const lanes = rng.laneKeys as DrumLaneId[];
    const changes: DrumBlock[] = [];
    for (const laneKey of lanes) {
      const mat = laneRangeMaterial(span, laneKey, rng.startBeat, rng.endBeat);
      if (!mat) continue;
      changes.push(stepsBlockFor(laneKey, rng.startBeat, rng.endBeat, mat.entries.map(({ h }) => ({
        beat: round4(h.beat - rng.startBeat), voice: h.voice as DrumVoiceName, velocity: h.velocity,
      }))));
    }
    if (changes.length === 0) return;
    writeSection(span.section.id, span.section, (sec) => ({
      ...sec,
      drumBlocks: replaceRangeBlocks(sec.drumBlocks, lanes, rng.startBeat, rng.endBeat, changes),
    }));
  }, [laneRangeMaterial, writeSection]);

  /** The one-shot velocity ops — ramp / accents / alternate / humanize /
   *  scale — baked into steps dots (a step's relative dynamics survive). */
  const applyVelocityOp = useCallback((span: SectionSpan, rng: { startBeat: number; endBeat: number; laneKeys: string[] }, op: VelocityOp) => {
    const lanes = rng.laneKeys as DrumLaneId[];
    const changes: DrumBlock[] = [];
    for (const laneKey of lanes) {
      const mat = laneRangeMaterial(span, laneKey, rng.startBeat, rng.endBeat);
      if (!mat) continue;
      const seed = `${span.section.id}:${laneKey}`;
      const notes = mat.entries.map(({ h, stepIdx }) => ({
        beat: round4(h.beat - rng.startBeat),
        voice: h.voice as DrumVoiceName,
        velocity: scaleVelocity(h.velocity, velocityOpFactor(op, stepIdx, { stepCount: mat.stepCount, peakVelocity: mat.peak, seed })),
      }));
      changes.push(stepsBlockFor(laneKey, rng.startBeat, rng.endBeat, notes));
    }
    if (changes.length === 0) return;
    writeSection(span.section.id, span.section, (sec) => ({
      ...sec,
      drumBlocks: replaceRangeBlocks(sec.drumBlocks, lanes, rng.startBeat, rng.endBeat, changes),
    }));
  }, [laneRangeMaterial, writeSection]);

  /** ⌥-drag drop — copy the source range's authored blocks (or, for lanes
   *  with none, their audible material) to the destination, then move the
   *  selection onto the copy so it stays the working range. */
  const dropCopy = useCallback((span: SectionSpan, rng: { startBeat: number; endBeat: number; laneKeys: string[] }, destStart: number) => {
    const lanes = rng.laneKeys as DrumLaneId[];
    const destEnd = round4(destStart + (rng.endBeat - rng.startBeat));
    const copies = copyBlocksToRange(effectiveSection(span).drumBlocks, lanes, rng.startBeat, rng.endBeat, destStart);
    const covered = new Set(copies.map((c) => c.lane));
    for (const laneKey of lanes) {
      if (covered.has(laneKey)) continue;
      const mat = laneRangeMaterial(span, laneKey, rng.startBeat, rng.endBeat);
      if (!mat) continue;
      copies.push(stepsBlockFor(laneKey, destStart, destEnd, mat.entries.map(({ h }) => ({
        beat: round4(h.beat - rng.startBeat), voice: h.voice as DrumVoiceName, velocity: h.velocity,
      }))));
    }
    if (copies.length === 0) return;
    writeSection(span.section.id, span.section, (sec) => ({
      ...sec,
      drumBlocks: upsertBlocks(stripFxCarriers(sec.drumBlocks, lanes, destStart, destEnd), copies),
    }));
    setSelectedSectionId(span.section.id);
    setRange({ startBeat: destStart, endBeat: destEnd, laneKeys: rng.laneKeys });
  }, [effectiveSection, laneRangeMaterial, writeSection, setRange, setSelectedSectionId]);

  /** The section's next seeded variant — what Regenerate rolls to (null on
   *  sections with no variants: outline / blocks-only / none). Odd-meter
   *  sections roll only through variants that fit their meter — the mined
   *  Zappa grooves — so a regenerate never lands a 7/8 section on a 4/4
   *  groove that drifts against the barline. */
  const regenerate = useMemo(() => {
    if (!song || !anchorSpan || !selectionSection) return null;
    const pattern = selectionSection.drumPattern ?? inferPatternForSection(selectionSection, song);
    const preset = PRESET_DATA[pattern];
    const all = preset?.variants ?? [];
    if (all.length <= 1) return null;
    const compatible = compatibleVariantIndices(
      all,
      sectionDurationBeats(selectionSection),
      beatsPerBar(selectionSection),
    );
    const pool = compatible.length > 1 ? compatible : all.map((_, i) => i);
    const current = selectionSection.drumVariantIndex
      ?? seededVariantIndex(pattern, selectionSection, song, anchorSpan.occurrenceIndex)
      ?? 0;
    return { pool, current };
  }, [song, anchorSpan, selectionSection]);

  const regenerateVariant = useCallback(() => {
    if (!anchorSpan || !regenerate) return;
    const position = regenerate.pool.indexOf(regenerate.current);
    const next = regenerate.pool[(position + 1) % regenerate.pool.length];
    writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({ ...sec, drumVariantIndex: next }));
  }, [anchorSpan, regenerate, writeSection]);

  const onCanvasMove = useCallback((e: ReactPointerEvent) => {
    const copy = copyRef.current;
    if (copy) {
      const { x } = toLocal(e);
      const length = copy.range.endBeat - copy.range.startBeat;
      const delta = snapBeat(spanXToBeat(copy.span, x, zoom) - copy.grabBeat, copy.grid);
      copy.destStart = round4(clamp(copy.range.startBeat + delta, 0, Math.max(0, copy.span.durationBeats - length)));
      setCopyDrag({
        dxPx: spanBeatToX(copy.span, copy.destStart, zoom) - spanBeatToX(copy.span, copy.range.startBeat, zoom),
        destStart: copy.destStart,
      });
      return;
    }
    const d = pressRef.current;
    if (!d) return;
    const { x, y } = toLocal(e);
    const dx = x - d.x0;
    const dy = y - d.y0;
    // Drag a step (cell or its value box) up/down → the lane's parameter.
    // A value-box drag over a range selection adjusts every step in the
    // selection by the same delta (discrete params take the dragged value).
    if (!d.velMode && d.cell && d.editable && Math.abs(dy) > 4 && Math.abs(dy) > Math.abs(dx)) {
      d.velMode = true;
      if (d.zone === "value") d.scrub = buildParamScrub(d.cell, d.param, d.paramStart);
      setMarquee(null);
    }
    if (d.velMode && d.cell) {
      const spec = PARAM_SPECS[d.param];
      const value = clampParam(spec, d.paramStart - dy * spec.perPx);
      if (d.scrub) scrubParam(d.cell.span, d.scrub, value);
      else writeStepParam(d.cell, d.param, value);
      setVelocityDrag({
        x: d.cell.cx, y: d.cell.cy,
        text: spec.format(value, gridStepForZoom(zoom)),
        label: spec.short,
        frac: Math.max(0, Math.min(1, (value - spec.min) / Math.max(1e-6, spec.max - spec.min))),
      });
      return;
    }
    setMarquee({ x0: d.x0, y0: d.y0, x1: x, y1: y });
  }, [toLocal, writeStepParam, buildParamScrub, scrubParam, zoom]);

  const onCanvasUp = useCallback((e: ReactPointerEvent) => {
    const copy = copyRef.current;
    if (copy) {
      copyRef.current = null;
      setCopyDrag(null);
      if (Math.abs(copy.destStart - copy.range.startBeat) > 1e-6) {
        dropCopy(copy.span, copy.range, copy.destStart);
      }
      return;
    }
    const d = pressRef.current;
    pressRef.current = null;
    setMarquee(null);
    if (!d) {
      setVelocityDrag(null);
      return;
    }
    if (d.velMode) {
      setVelocityDrag(null);
      return;
    }
    const { x, y } = toLocal(e);
    const dist = Math.hypot(x - d.x0, y - d.y0);
    const startHit = xToSpanBeat(spans, d.x0, zoom);
    const stepBeats = gridStepForZoom(zoom);

    if (dist < 4) {
      // A press (not a drag).
      // Section title row: select the WHOLE section — every lane, first
      // beat to last — the one-click "edit this section" gesture.
      if (startHit && d.y0 < TOP_PAD) {
        setSelectedSectionId(startHit.span.section.id);
        setRange({
          startBeat: 0,
          endBeat: startHit.span.durationBeats,
          laneKeys: DRUM_LANES.map((l) => l.key),
        });
        return;
      }
      // A CELL press toggles that step: empty → add, filled → delete.
      // A VALUE-box click cycles DISCRETE parameters (ratchet/flam) and is
      // otherwise inert — continuous params exist to be dragged.
      if (d.zone === "value" && d.cell) {
        const spec = PARAM_SPECS[d.param];
        if (spec.kind === "discrete" && d.editable) {
          writeStepParam(d.cell, d.param, cycleValue(spec, d.paramStart));
        }
        return;
      }
      if (d.cell && d.zone === "cell") {
        toggleStep(d.cell.span, d.cell.laneKey, d.cell.stepBeat, stepBeats);
        return;
      }
      // Plain click on empty space: drop the range, keep (or set) the section.
      clearRange();
      if (startHit) setSelectedSectionId(startHit.span.section.id);
      return;
    }
    if (!startHit) return; // a drag that started outside every span
    const span = startHit.span;
    const b0 = snapBeat(spanXToBeat(span, Math.min(d.x0, x), zoom), stepBeats);
    const b1 = snapBeat(spanXToBeat(span, Math.max(d.x0, x), zoom), stepBeats);
    if (b1 - b0 < stepBeats) {
      clearRange();
      setSelectedSectionId(span.section.id);
      return;
    }
    // A drag that STARTED on the title row is a section-wide gesture: the
    // beat range it covers, across every lane.
    const inTitle = d.y0 < TOP_PAD;
    const i0 = inTitle ? 0 : clamp(Math.floor((Math.min(d.y0, y) - TOP_PAD) / TRACK_H), 0, LANE_COUNT - 1);
    const i1 = inTitle ? LANE_COUNT - 1 : clamp(Math.floor((Math.max(d.y0, y) - TOP_PAD - 1e-6) / TRACK_H), 0, LANE_COUNT - 1);
    setSelectedSectionId(span.section.id);
    setRange({ startBeat: b0, endBeat: b1, laneKeys: DRUM_LANES.slice(i0, i1 + 1).map((l) => l.key) });
  }, [spans, zoom, toLocal, clearRange, setSelectedSectionId, setRange, toggleStep, writeStepParam, dropCopy]);

  /** Browsers can CANCEL a pointer mid-gesture (context menu, HMR swap,
   *  OS-level gesture, devtools). Without this the press / marquee / slider
   *  state sticks — e.g. a phantom velocity slider frozen over the grid.
   *  Every gesture surface gets this cleanup. */
  const onCanvasCancel = useCallback(() => {
    pressRef.current = null;
    handleRef.current = null;
    padDragRef.current = null;
    copyRef.current = null;
    setMarquee(null);
    setCopyDrag(null);
    setVelocityDrag(null);
  }, []);

  // ---- selection edge handles -------------------------------------------------

  const onHandleDown = useCallback((e: ReactPointerEvent, kind: HandleDragState["kind"], span: SectionSpan) => {
    if (!range) return;
    e.stopPropagation();
    capture(e.currentTarget as Element, e.pointerId);
    handleRef.current = {
      kind,
      span,
      range: { startBeat: range.startBeat, endBeat: range.endBeat, laneKeys: [...range.laneKeys] },
    };
  }, [range]);

  const onHandleMove = useCallback((e: ReactPointerEvent) => {
    const d = handleRef.current;
    if (!d) return;
    const { x, y } = toLocal(e);
    const stepBeats = gridStepForZoom(zoom);
    if (d.kind === "left" || d.kind === "right") {
      const beat = snapBeat(spanXToBeat(d.span, x, zoom), stepBeats);
      if (d.kind === "left") {
        setRange({ ...d.range, startBeat: round4(clamp(beat, 0, d.range.endBeat - stepBeats)) });
      } else {
        setRange({ ...d.range, endBeat: round4(clamp(beat, d.range.startBeat + stepBeats, d.span.durationBeats)) });
      }
      return;
    }
    const laneIdx = clamp(Math.floor((y - TOP_PAD) / TRACK_H), 0, LANE_COUNT - 1);
    const idxs = d.range.laneKeys.map((k) => DRUM_LANES.findIndex((l) => l.key === k)).filter((i) => i >= 0);
    if (idxs.length === 0) return;
    let lo = Math.min(...idxs);
    let hi = Math.max(...idxs);
    if (d.kind === "top") lo = clamp(laneIdx, 0, hi);
    else hi = clamp(laneIdx, lo, LANE_COUNT - 1);
    setRange({ ...d.range, laneKeys: DRUM_LANES.slice(lo, hi + 1).map((l) => l.key) });
  }, [toLocal, zoom, setRange]);

  const onHandleUp = useCallback((e: ReactPointerEvent) => {
    handleRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onPadDown = useCallback((e: ReactPointerEvent) => {
    if (!range || !anchorSpan || !primaryLane) return;
    e.stopPropagation();
    capture(e.currentTarget as Element, e.pointerId);
    padDragRef.current = {
      clientX: e.clientX, clientY: e.clientY,
      k: euclid.k, rotation: euclid.rotation,
      mx: motion.x, my: motion.y,
      span: anchorSpan,
      range: { startBeat: range.startBeat, endBeat: range.endBeat },
      laneKeys: range.laneKeys,
    };
  }, [range, anchorSpan, primaryLane, euclid, motion]);

  const onPadMove = useCallback((e: ReactPointerEvent) => {
    const d = padDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.clientX;
    const dy = e.clientY - d.clientY;
    if (padMode === "euclid") {
      const nn = Math.max(1, Math.round(d.range.endBeat - d.range.startBeat));
      const k = clamp(Math.round(d.k - dy * (nn / 60)), 1, nn);
      const rotation = ((d.rotation + Math.round(dx * (nn / 80))) % nn + nn) % nn;
      writeSection(d.span.section.id, d.span.section, (sec) => ({
        ...sec,
        drumBlocks: upsertModeBlocks(
          sec.drumBlocks, d.range.startBeat, d.range.endBeat,
          euclidBlocksFor(d.laneKeys as DrumLaneId[], d.range.startBeat, d.range.endBeat, k, nn, rotation),
        ),
      }));
    } else {
      const x = clamp(dx / 40, -1, 1);
      const y = clamp(-dy / 40, -1, 1);
      writeSection(d.span.section.id, d.span.section, (sec) => ({
        ...sec,
        drumBlocks: upsertModeBlocks(
          sec.drumBlocks, d.range.startBeat, d.range.endBeat,
          [motionBlockFor(d.laneKeys[0] as DrumLaneId, d.range.startBeat, d.range.endBeat, x, y)],
        ),
      }));
    }
  }, [padMode, writeSection]);

  const onPadUp = useCallback((e: ReactPointerEvent) => {
    padDragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  // ---- render -----------------------------------------------------------------

  if (!song || spans.length === 0) {
    return (
      <div className="relative overflow-x-auto border border-edge rounded bg-black">
        <p className="text-inkMuted text-xs p-3">No sections yet — add some in Structure first.</p>
      </div>
    );
  }

  const totalBarCount = totalBars(spans);

  return (
    <div className="flex items-start gap-2">
      {/* timeline column */}
      <div className="flex-1 min-w-0">
      {/* min-h keeps the draft controls from growing this row: layout must
          not shift mid-gesture (velocity drags compute from client coords) */}
      <div className="flex items-center justify-between mb-1.5 min-h-6">
        <span className="text-xs text-inkMuted">
          Click a cell to toggle · drag cells or their value boxes ↑↓ = the lane's parameter (chip in the gutter picks it) · wheel over the grid zooms · drag beats × lanes → controls · click a title selects the section · ⌥-drag the selection = copy
        </span>
        <span className="flex items-center gap-1.5">
          {draftSection && <span className="font-mono text-2xs uppercase tracking-wider text-[#E8B54A]">● preview</span>}
          {draftSection && (
            <>
              <button
                onClick={applyDraft}
                className="font-mono text-2xs rounded px-2 py-0.5 border border-accent text-accent bg-accent/10 hover:bg-accent/20"
              >
                Apply
              </button>
              <button
                onClick={revertDraft}
                className="font-mono text-2xs rounded px-2 py-0.5 border border-edge text-inkMuted hover:text-ink"
              >
                Revert
              </button>
            </>
          )}
        </span>
      </div>

      <div ref={scrollRef} className="relative overflow-x-auto border border-edge rounded bg-black">
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-0.5 border border-edge rounded bg-black/90 px-1 py-0.5 select-none">
          <button
            onClick={() => setZoom((z) => clamp(z / 1.1, 0.5, 6))}
            className="w-5 h-5 flex items-center justify-center text-inkMuted hover:text-ink text-sm leading-none"
          >
            −
          </button>
          <span className="font-mono text-2xs text-inkMuted tabular-nums w-9 text-center" title="Timeline zoom">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => clamp(z * 1.1, 0.5, 6))}
            className="w-5 h-5 flex items-center justify-center text-inkMuted hover:text-ink text-sm leading-none"
          >
            +
          </button>
        </div>

        <svg
          ref={svgRef}
          width={width}
          height={HEIGHT}
          className="block touch-none select-none"
          onPointerDown={onCanvasDown}
          onPointerMove={onCanvasMove}
          onPointerUp={onCanvasUp}
          onPointerCancel={onCanvasCancel}
        >
          {/* section labels + brackets + bar numbers */}
          {spans.map((span, si) => {
            const color = SECTION_ROLE_COLOR[span.section.role]?.rim ?? "#565F70";
            const x1 = barX(span.startBar, zoom);
            const x2 = barX(span.startBar + span.bars, zoom);
            return (
              <g key={`sec-${si}`} pointerEvents="none">
                <text x={(x1 + x2) / 2} y={12} textAnchor="middle" fontSize={12} fontWeight={600} fontFamily="'IBM Plex Mono', monospace" fill={color}>
                  {span.section.name}
                  {span.occurrenceIndex > 0 ? ` ·${span.occurrenceIndex + 1}` : ""}
                </text>
                <path d={`M ${x1} 20 L ${x1} 26 L ${x2} 26 L ${x2} 20`} fill="none" stroke={color} strokeWidth={1.6} strokeOpacity={0.6} />
              </g>
            );
          })}
          {/* automatic gesture + handoff fill at each boundary — read-only
              ambience, mirroring the classic view's hexagon chip. A tag
              describes the PRECEDING section's ending (its transition lands
              on the boundary). */}
          {autoReadout.slice(0, -1).map((r, i) => {
            if (!r) return null;
            const x = barX(spans[i].startBar + spans[i].bars, zoom);
            const color = r.model ? TRANSITION_COLOR[r.model] : "#8B94A1";
            const label = r.model
              ? `${TRANSITION_LABEL[r.model].toUpperCase()}${r.bars > 1 ? ` ·${r.bars}` : ""}${r.manual ? "" : " ·AUTO"}`
              : "FILL";
            return (
              <text
                key={`auto-${i}`}
                x={x + 4} y={12}
                fontSize={9}
                fontFamily="'IBM Plex Mono', monospace"
                fontWeight={600}
                fill={color}
                fillOpacity={0.9}
                pointerEvents="none"
              >
                {label}
              </text>
            );
          })}

          {/* authored detour marker (classic view / dock still author it) —
              read-only, marks where the detour's span change begins */}
          {autoReadout.map((r, i) =>
            r && r.detourStartBeat !== null ? (
              <text
                key={`det-${i}`}
                x={spanBeatToX(spans[i], r.detourStartBeat, zoom) + 4}
                y={24}
                fontSize={9}
                fontFamily="'IBM Plex Mono', monospace"
                fontWeight={600}
                fill="#E8B54A"
                fillOpacity={0.85}
                pointerEvents="none"
              >
                DETOUR
              </text>
            ) : null,
          )}

          {/* title-row hit strips — a pointer cursor + guaranteed hit area
              for the click-a-title-selects-the-section gesture (the svg
              handler does the work; these make it discoverable). */}
          {spans.map((span, si) => (
            <rect
              key={`title-hit-${si}`}
              x={barX(span.startBar, zoom)}
              y={2}
              width={barX(span.startBar + span.bars, zoom) - barX(span.startBar, zoom)}
              height={28}
              fill="transparent"
              style={{ cursor: "pointer" }}
            />
          ))}
          {spans.flatMap((span, si) =>
            Array.from({ length: span.bars }).map((_, barIdx) => (
              <text
                key={`bn-${si}-${barIdx}`}
                x={barX(span.startBar + barIdx, zoom)}
                y={32}
                textAnchor="middle"
                fontSize={10}
                fontFamily="'IBM Plex Mono', monospace"
                fill="#7a7a80"
                pointerEvents="none"
              >
                {Math.round(span.startBar) + barIdx}
              </text>
            )),
          )}

          {/* section ruler: bar + beat lines */}
          {spans.map((span, si) => {
            const bpb = beatsPerBarOf(span);
            const lines: { x: number; bar: boolean }[] = [];
            for (let barIdx = 0; barIdx < span.bars; barIdx++) {
              lines.push({ x: spanBeatToX(span, barIdx * bpb, zoom), bar: true });
              for (let q = 1; q < bpb - 1e-9; q++) {
                lines.push({ x: spanBeatToX(span, barIdx * bpb + q, zoom), bar: false });
              }
            }
            lines.push({ x: spanBeatToX(span, span.durationBeats, zoom), bar: true });
            return lines.map((g, gi) => (
              <line
                key={`g-${si}-${gi}`}
                x1={g.x} y1={TOP_PAD} x2={g.x} y2={STACK_BOTTOM}
                stroke="#fff" strokeOpacity={g.bar ? 0.14 : 0.06} strokeWidth={1}
                pointerEvents="none"
              />
            ));
          })}

          {/* lane labels — aligned with the top-aligned cell row */}
          {DRUM_LANES.map((lane, li) => {
            const { r: labelR } = cellMetrics(zoom, 4, gridStepForZoom(zoom));
            return (
              <text
                key={`lb-${lane.key}`}
                x={X0 - 14} y={cellCy(li, labelR) + 4} textAnchor="end" fontSize={12} fontWeight={600}
                fontFamily="'IBM Plex Mono', monospace" fill={lane.color} pointerEvents="none"
              >
                {lane.label}
              </text>
            );
          })}

          {/* step lanes — packed circular cells; the grid subdivides with
              zoom (see gridStepForZoom), and the strip below each cell row
              shows authored velocity as a bar */}
          {spans.map((span, si) => {
            const hits = hitsForSpan(span);
            const bpb = beatsPerBarOf(span);
            const stepBeats = gridStepForZoom(zoom);
            const stepCount = Math.max(1, Math.ceil(span.durationBeats / stepBeats - 1e-9));
            const { r, spacing } = cellMetrics(zoom, bpb, stepBeats);
            const accentEvery = Math.max(1, Math.round(bpb / stepBeats));
            const tol = Math.max(0.02, stepBeats * 0.35);
            return DRUM_LANES.map((lane, li) => {
              const y = cellCy(li, r);
              const laneHits = hits.get(lane.key as DrumLaneId) ?? [];
              const hitAt = new Map<number, LaneHit>();
              const diamonds: LaneHit[] = [];
              for (const h of laneHits) {
                const idx = Math.round(h.beat / stepBeats);
                if (Math.abs(h.beat - idx * stepBeats) <= tol && idx >= 0 && idx < stepCount) hitAt.set(idx, h);
                else diamonds.push(h);
              }
              const param = paramFor(lane.key);
              const spec = PARAM_SPECS[param];
              const authored = authoredNotesFor(span, lane.key as DrumLaneId, stepBeats);
              const dots = [];
              for (let q = 0; q < stepCount; q++) {
                const x = spanBeatToX(span, q * stepBeats, zoom);
                const hit = hitAt.get(q);
                const accent = q % accentEvery === 0;
                // Cells are pure visuals — the canvas pointer-up resolves
                // clicks into toggles (an SVG circle with fill="none" would
                // only be hit-testable on its stroke). The ring is the
                // sequencer's primary affordance: thick, pure white, and
                // brighter on filled steps + barline accents so the grid
                // reads at a glance.
                const sw = Math.min(2.6, Math.max(1.1, r * 0.25));
                dots.push(
                  <circle
                    key={`c-${q}`}
                    cx={x} cy={y} r={r}
                    fill={hit ? lane.color : "#0b0e13"}
                    fillOpacity={hit ? 0.45 + 0.55 * (hit.velocity / 127) : 1}
                    stroke="#FFFFFF"
                    strokeOpacity={hit ? (accent ? 0.9 : 0.72) : accent ? 0.72 : 0.5}
                    strokeWidth={accent ? sw + 0.3 : sw}
                    pointerEvents="none"
                  />,
                );
              }
              const hh = Math.max(2.6, r * 0.62);
              const marks = diamonds.map((hit, i) => {
                const x = spanBeatToX(span, hit.beat, zoom);
                return (
                  <polygon
                    key={`m-${i}`}
                    points={`${x},${y - hh} ${x + hh},${y} ${x},${y + hh} ${x - hh},${y}`}
                    fill={lane.color} fillOpacity={0.9}
                    stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={Math.min(1.6, Math.max(0.8, hh * 0.2))}
                    pointerEvents="none"
                  />
                );
              });
              // Step value boxes — the PARAMETER lane. What each box shows
              // and edits is the lane's chosen parameter (its dropdown
              // chip lives in the gutter): velocity by default, or nudge /
              // gate / probability / ratchet / flam. Authored values read
              // solid; defaults on live hits read dimmed.
              const bm = boxMetrics(li, r, spacing);
              const boxes = bm
                ? Array.from({ length: stepCount }).map((_, q) => {
                    const x = spanBeatToX(span, q * stepBeats, zoom);
                    const hit = hitAt.get(q);
                    const auth = authored.get(q);
                    const authoredVal = auth ? spec.read(auth, stepBeats) : undefined;
                    let v: number | null = null;
                    let dim = false;
                    if (param === "vel") {
                      if (hit) v = Math.round(hit.velocity);
                      else if (auth) { v = auth.velocity; dim = true; }
                    } else if (authoredVal !== undefined) {
                      v = authoredVal;
                      dim = !hit;
                    } else if (hit) {
                      v = spec.rest;
                      dim = true;
                    }
                    const label = v === null ? null : spec.format(v, stepBeats);
                    return (
                      <g key={`vb-${q}`}>
                        <rect
                          x={x - bm.w / 2} y={bm.top} width={bm.w} height={bm.h} rx={2.5}
                          fill={hit ? lane.color : "#0b0e13"} fillOpacity={hit ? (dim ? 0.08 : 0.14) : 0.6}
                          stroke={hit ? lane.color : "#2E3540"} strokeOpacity={hit ? (dim ? 0.32 : 0.55) : 1} strokeWidth={1}
                          pointerEvents="none"
                        />
                        {label !== null && bm.w >= (spec.short.length > 3 ? 16 : 12) && (
                          <text
                            x={x} y={bm.top + bm.h / 2 + Math.min(bm.font, bm.w * 0.34) * 0.36}
                            textAnchor="middle" fontSize={Math.min(bm.font, bm.w * 0.34)} fontFamily="'IBM Plex Mono', monospace"
                            fill={dim ? "#8B94A1" : "#E9EDF3"} fillOpacity={dim ? 0.8 : 0.92} pointerEvents="none"
                          >
                            {label}
                          </text>
                        )}
                      </g>
                    );
                  })
                : [];
              // Gutter chip — the lane's parameter picker (the "effects
              // lane" dropdown).
              const chipY = TOP_PAD + li * TRACK_H + 3;
              const chip = (
                <g
                  key={`pchip-${lane.key}`}
                  onClick={() => setParamMenu(paramMenu === lane.key ? null : lane.key)}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={8} y={chipY} width={46} height={13} rx={3}
                    fill="#0f1218" stroke={param !== "vel" ? "#E8B54A" : "#2E3540"} strokeOpacity={param !== "vel" ? 0.8 : 1}
                  />
                  <text
                    x={31} y={chipY + 9.5} textAnchor="middle" fontSize={7.5} fontWeight={600}
                    fontFamily="'IBM Plex Mono', monospace" fill={param !== "vel" ? "#E8B54A" : "#8B94A1"}
                  >
                    {spec.short}
                  </text>
                </g>
              );
              return <g key={`dots-${si}-${li}`}>{chip}{boxes}{dots}{marks}</g>;
            });
          })}

          {/* selection: dim everything else, bracket the range */}
          {selRects.length > 0 && (
            <>
              <path
                d={
                  `M 0 0 H ${width} V ${HEIGHT} H 0 Z ` +
                  selRects.map((r) => `M ${r.x1} ${r.y1} H ${r.x2} V ${r.y2} H ${r.x1} Z`).join(" ")
                }
                fillRule="evenodd" fill="#000" opacity={0.45} pointerEvents="none"
              />
              {selRects.map((r, i) => {
                const midX = (r.x1 + r.x2) / 2;
                // Handles live ENTIRELY OUTSIDE the selection's beat span —
                // they used to straddle the edge (±4px), which stole the
                // first/last cell's hit area so a press there resized instead
                // of toggling or scrubbing. The side grips also sit BELOW the
                // dot row (the cells are centered on the boundary, so their
                // outer half hangs outside the span): only the lower strip
                // carries the grip, keeping every cell's dot pressable.
                const handles: { kind: HandleDragState["kind"]; x: number; y: number; w: number; h: number; cursor: string }[] = [
                  { kind: "left", x: r.x1 - 8, y: r.y2 - 26, w: 8, h: 20, cursor: "ew-resize" },
                  { kind: "right", x: r.x2, y: r.y2 - 26, w: 8, h: 20, cursor: "ew-resize" },
                  { kind: "top", x: midX - 14, y: r.y1 - 8, w: 28, h: 8, cursor: "ns-resize" },
                  { kind: "bottom", x: midX - 14, y: r.y2, w: 28, h: 8, cursor: "ns-resize" },
                ];
                return (
                  <g key={`sel-${i}`}>
                    <rect
                      x={r.x1} y={r.y1} width={r.x2 - r.x1} height={r.y2 - r.y1}
                      fill="rgba(232,181,74,0.05)" stroke="#E8B54A" strokeWidth={1.2} strokeDasharray="5 4"
                      pointerEvents="none"
                    />
                    {handles.map((h) => (
                      <rect
                        key={h.kind}
                        x={h.x} y={h.y} width={h.w} height={h.h} rx={3}
                        fill="#E8B54A" fillOpacity={0.9}
                        style={{ cursor: h.cursor }}
                        onPointerDown={(e) => onHandleDown(e, h.kind, r.span)}
                        onPointerMove={onHandleMove}
                        onPointerUp={onHandleUp}
                        onPointerCancel={onHandleUp}
                      />
                    ))}
                  </g>
                );
              })}
            </>
          )}

          {/* marquee rubber band */}
          {marquee && (
            <rect
              x={Math.min(marquee.x0, marquee.x1)} y={Math.min(marquee.y0, marquee.y1)}
              width={Math.abs(marquee.x1 - marquee.x0)} height={Math.abs(marquee.y1 - marquee.y0)}
              fill="rgba(232,181,74,0.07)" stroke="#E8B54A" strokeWidth={1.2} strokeDasharray="5 4"
              pointerEvents="none"
            />
          )}

          {/* ⌥-drag copy ghost — the selection's outline at its drop spot */}
          {copyDrag && selRects.map((r, i) => (
            <rect
              key={`copyghost-${i}`}
              x={r.x1 + copyDrag.dxPx} y={r.y1} width={r.x2 - r.x1} height={r.y2 - r.y1}
              fill="rgba(232,181,74,0.10)" stroke="#E8B54A" strokeWidth={1.2} strokeDasharray="2 3"
              pointerEvents="none"
            />
          ))}

          {/* floating velocity slider — shown only while dragging a cell
              up/down; afterwards just the strip bar below the cell remains */}
          {velocityDrag && (
            <g pointerEvents="none">
              <rect
                x={velocityDrag.x + 16} y={velocityDrag.y - 46} width={70} height={70} rx={6}
                fill="rgba(11,13,17,0.95)" stroke="#E8B54A" strokeOpacity={0.6} strokeWidth={1}
              />
              <text
                x={velocityDrag.x + 51} y={velocityDrag.y - 28} textAnchor="middle" fontSize={14} fontWeight={600}
                fontFamily="'IBM Plex Mono', monospace" fill="#E8B54A"
              >
                {velocityDrag.text}
              </text>
              <rect x={velocityDrag.x + 47} y={velocityDrag.y - 16} width={8} height={32} rx={4} fill="#1c2129" />
              <rect
                x={velocityDrag.x + 47}
                y={velocityDrag.y - 16 + 32 * (1 - velocityDrag.frac)}
                width={8} height={32 * velocityDrag.frac} rx={4} fill="#E8B54A"
              />
              <text
                x={velocityDrag.x + 51} y={velocityDrag.y + 36} textAnchor="middle" fontSize={9}
                fontFamily="'IBM Plex Mono', monospace" fill="#B0B0B0"
              >
                {velocityDrag.label}
              </text>
            </g>
          )}

          {/* the parameter dropdown — a lane's chip opens the picker; the
              full-canvas catcher closes it on any outside press */}
          {paramMenu && (() => {
            const li = DRUM_LANES.findIndex((l) => l.key === paramMenu);
            if (li < 0) return null;
            const laneTop = TOP_PAD + li * TRACK_H;
            const menuH = STEP_PARAMS.length * 17 + 8;
            const menuY = laneTop + 18 + menuH <= HEIGHT - 6 ? laneTop + 18 : Math.max(2, laneTop - menuH - 2);
            const active = paramFor(paramMenu);
            return (
              <g>
                <rect
                  x={0} y={0} width={width} height={HEIGHT} fill="transparent"
                  onPointerDown={(e) => { e.stopPropagation(); setParamMenu(null); }}
                />
                <rect x={8} y={menuY} width={104} height={menuH} rx={4} fill="#0d1016" stroke="#2E3540" />
                {STEP_PARAMS.map((p, i) => (
                  <g
                    key={p}
                    onClick={() => setLaneParam(paramMenu, p)}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={11} y={menuY + 4 + i * 17} width={98} height={16} rx={3}
                      fill={p === active ? "rgba(232,181,74,0.14)" : "transparent"}
                    />
                    <text
                      x={17} y={menuY + 15.5 + i * 17} fontSize={9} fontFamily="'IBM Plex Mono', monospace"
                      fill={p === active ? "#E8B54A" : "#B0B0B0"}
                    >
                      {PARAM_SPECS[p].label}
                    </text>
                  </g>
                ))}
              </g>
            );
          })()}

          {/* the XY pad cluster, docked right of the selection */}
          {range && padRect && (
            <SelectionPad
              panelX={panelX}
              panelY={panelY}
              connectorFromX={padRect.x2}
              mode={padMode}
              euclid={euclid}
              motion={motion}
              motionLabel={motionLabel}
              laneColors={laneColors}
              hasDraft={!!draftSection}
              onApply={applyDraft}
              onCancel={revertDraft}
              onMode={setPadMode}
              onExpand={() => setEditorOpen(true)}
              onPadPointerDown={onPadDown}
              onPadPointerMove={onPadMove}
              onPadPointerUp={onPadUp}
            />
          )}
        </svg>
      </div>

      {/* the exploded selection editor — opened from the pad's ⤢ chip; the
          docked workbench (right) is the everyday control surface */}
      {editorOpen && range && anchorSpan && selectionSection && (
        <SelectionEditorModal
          span={anchorSpan}
          section={selectionSection}
          range={range}
          hits={hitsForSpan(anchorSpan)}
          spans={spans}
          stepBeats={gridStepForZoom(zoom)}
          hasDraft={!!draftSection}
          onWrite={(mutate) => writeSection(anchorSpan.section.id, anchorSpan.section, mutate)}
          onVelocityOp={(op) => applyVelocityOp(anchorSpan, range, op)}
          onFlatten={() => flattenSelection(anchorSpan, range)}
          onRegenerate={regenerate ? regenerateVariant : null}
          onApply={applyDraft}
          onCancel={revertDraft}
          onClose={() => setEditorOpen(false)}
        />
      )}
      </div>

      {/* the selection-scoped working area — comes up WITH a selection and
          goes away with it (Apply/Cancel/plain click). The pad's ⤢ opens
          the exploded modal version of the same controls. */}
      {range && anchorSpan && (
        <SelectionWorkbench
          span={anchorSpan}
          section={selectionSection}
          range={range}
          onWrite={(mutate) => writeSection(anchorSpan.section.id, anchorSpan.section, mutate)}
          onVelocityOp={(op) => applyVelocityOp(anchorSpan, range, op)}
          onFlatten={() => flattenSelection(anchorSpan, range)}
          onRegenerate={regenerate ? regenerateVariant : null}
          hasDraft={!!draftSection}
          onApply={applyDraft}
          onCancel={revertDraft}
        />
      )}
    </div>
  );
}
