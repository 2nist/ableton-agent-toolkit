import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  PRESET_DATA,
  DRUM_LANE_PRIMARY,
  DRUM_LANE_VOICES,
  audibleLanes,
  compatibleVariantIndices,
  type DrumLaneId,
  type KitVoice,
} from "@drum/library";
import { useSongStore } from "../../../store/songStore";
import { useTimeSelectionStore } from "../../../store/timeSelectionStore";
import { useStudioSelectionStore } from "../../../store/studioSelectionStore";
import { useDrumsDraftStore } from "../../../store/drumsDraftStore";
import { updateSection } from "../../../lib/sections";
import { sectionSpans, type SectionSpan } from "../../../lib/arrangement";
import type { LaneHit } from "../../../lib/timeline/drumLaneHits";
import {
  inferPatternForSection,
  resolveSectionVariant,
  seededVariantIndex,
} from "../../../lib/playback/drumPreview";
import {
  beatsPerBar,
  sectionDurationBeats,
  type BlueprintSection,
  type DrumBlock,
  type DrumBlockFx,
  type DrumBlockNote,
  type DrumVoiceName,
} from "../../../types/blueprint";
import { DRUM_LANES, laneColor } from "../laneStyle";
import { VOICE_LABEL } from "../voiceStyle";
import { usePalette } from "../../../theme/palette";
import GrooveShelf from "./GrooveShelf";
import GrooveGlue from "./GrooveGlue";
import LaneRow from "./LaneRow";
import LaneGutter from "./LaneGutter";
import MarkerRail, { MARKER_BAND_H } from "./MarkerRail";
import { sectionMarkers } from "./transitionMarkers";
import SelectionEditorModal from "./SelectionEditorModal";
import { BARS_PER_VIEW_OPTIONS, stepGridFor, type BarsPerView } from "./meterGrid";
import { laneHitsFor, peakVelocityByStep } from "./hitsCache";
import { withToggledStep } from "./stepToggle";
import { asStepParam } from "./stepParams";
import { gestureLayerFor } from "./gestureLayer";
import { auditionDrumHit } from "../../../lib/playback/previewMidi";
import {
  copyBlocksToRange,
  fxBlocksFor,
  fxForLanes,
  replaceRangeBlocks,
  stripFxCarriers,
  upsertBlocks,
  upsertModeBlocks,
} from "./selectionMath";
import { clampParam, PARAM_SPECS, type ParamDraftNote, type StepParam } from "./stepParams";
import { scaleVelocity, velocityOpFactor, type VelocityOp } from "./velocityOps";
import type { FxParam } from "./fxParams";

/**
 * The Drum Blocks view — rebuilt around three ideas.
 *
 * 1. TIERS. Song map (read-only navigation) → groove shelf (pick a groove by
 *    seeing its rhythm) → the surface lanes. Nothing docks over the
 *    timeline, and there is no separate bar strip: at one bar per view the
 *    lanes ARE the bar view, with the ◂ A · bar n/8 ▸ navigator walking it.
 *
 * 2. NO MARQUEE. One drag used to mean three things (vertical = velocity,
 *    horizontal = select, click = toggle), which is what felt disjointed.
 *    Selection is built by CLICKING NAMES: a lane label selects that lane,
 *    a bar number selects that bar across every lane, shift extends. A drag
 *    on a bar therefore means exactly one thing — its velocity.
 *
 * 3. ZOOM IS BARS PER VIEW. [1|2|4|8|16|ALL], with the step grid derived
 *    from the METER (`meterGrid.ts`), so 12/8 lands on 12/6/3 steps per bar
 *    and 7/8 keeps its seven eighths. The wheel scrolls; nothing hijacks it.
 *    Every step is an OUTLINED CELL and the hit fills it from the bottom, so
 *    the grid reads as a grid instead of squares floating in white space.
 *
 * Edits still write `BlueprintSection.drumBlocks` through the shared draft
 * store with the same helpers the export paths use, and every gesture
 * commits ONCE on release — a drag never writes per pixel.
 */

const LANE_COUNT = DRUM_LANES.length;
/** Canvas top band: the bar ruler, then the handoff/detour marker rail
 *  (section names live in the app spine, which selects the same section). */
const RULER_H = 26;
const MARKER_TOP = RULER_H + 1;
const TOP = MARKER_TOP + MARKER_BAND_H;
const ROW_H = 52;
const GUTTER = 104;
const HEIGHT = TOP + LANE_COUNT * ROW_H + 12;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A lanes × bars selection. */
interface BarSel {
  sectionId: string;
  lanes: DrumLaneId[];
  fromBar: number;
  toBar: number;
}

type ScrubTargets = { draft: ParamDraftNote; value0: number; stepIdx: number }[];

/** The in-flight velocity gesture. */
interface VelDrag {
  laneKey: DrumLaneId;
  stepIdx: number;
  stepBeat: number;
  param: StepParam;
  startValue: number;
  value: number;
  /** Press-time snapshot for a selection-wide scrub, else null. */
  scrub: { targets: ScrubTargets; start: number; end: number; pressed0: number } | null;
  /** Press point — the drag ORIGIN. Never updated during the gesture. */
  x0: number;
  y0: number;
  /** Current pointer, for the readout. */
  x: number;
  y: number;
  /** The cell's box, so a click can be read as a velocity. */
  cellTop: number;
  cellH: number;
  /** Add the step when the click/drag lands on an empty cell. */
  addIfEmpty: boolean;
  moved: boolean;
}

/**
 * The velocity a pointer HEIGHT means inside a cell: the top of the box is
 * 127, its floor is 0. Clicking and dragging share this one mapping, so a
 * click is simply a drag that never moved — and the bar always sits where
 * your finger is.
 */
function velocityAt(y: number, cellTop: number, cellH: number): number {
  const frac = Math.max(0, Math.min(1, (cellTop + cellH - y) / Math.max(1, cellH - 2)));
  return Math.round(frac * 127);
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export default function DrumBlocksView() {
  const P = usePalette();
  const song = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const draftSectionId = useDrumsDraftStore((s) => s.sectionId);
  const draftSection = useDrumsDraftStore((s) => s.section);

  const [barsPerView, setBarsPerView] = useState<BarsPerView>(() => loadJson<BarsPerView>("trackdraft-drums-bars-view", "all"));
  const [sel, setSel] = useState<BarSel | null>(null);
  const [copyArm, setCopyArm] = useState<BarSel | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [velDrag, setVelDrag] = useState<VelDrag | null>(null);
  const [fxPreview, setFxPreview] = useState<{ laneKey: string; id: FxParam; value: number } | null>(null);
  const [stepSel, setStepSel] = useState<Record<string, StepParam>>(() => loadJson("trackdraft-drums-step-sel", {}));
  const [fxSel, setFxSel] = useState<Record<string, FxParam | null>>(() => loadJson("trackdraft-drums-fx-sel", {}));
  const [width, setWidth] = useState(900);
  const [shiftHeld, setShiftHeld] = useState(false);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<VelDrag | null>(null);

  // ---- song / section ---------------------------------------------------------

  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);
  const anchorSpan = useMemo(
    () => spans.find((s) => s.section.id === selectedSectionId) ?? spans[0] ?? null,
    [spans, selectedSectionId],
  );

  /** The section a span renders — the working draft when one is open. */
  const effectiveSection = useCallback(
    (span: SectionSpan): BlueprintSection =>
      draftSectionId === span.section.id && draftSection ? draftSection : span.section,
    [draftSectionId, draftSection],
  );

  const section = anchorSpan ? effectiveSection(anchorSpan) : null;
  const hits = useMemo(
    () => (anchorSpan && section ? laneHitsFor(section, song ?? undefined, anchorSpan.occurrenceIndex) : null),
    [anchorSpan, section, song],
  );

  const grid = useMemo(
    () => (anchorSpan ? stepGridFor(anchorSpan, barsPerView) : { stepsPerBar: 16, stepBeats: 0.25, beatsPerBar: 4 }),
    [anchorSpan, barsPerView],
  );
  const sectionBars = anchorSpan ? Math.max(1, Math.round(anchorSpan.bars)) : 1;
  const visibleBars = barsPerView === "all" ? sectionBars : Math.min(sectionBars, barsPerView);
  // the gutter is a sticky OVERLAY, so the canvas gets the remaining pixels
  const barPx = Math.max(40, (width - GUTTER) / Math.max(1, visibleBars));
  const contentW = barPx * sectionBars;
  const beatToX = barPx / Math.max(1e-6, grid.beatsPerBar);
  const stepCount = sectionBars * grid.stepsPerBar;
  // cells take the whole step: fewer bars ⇒ wider cells (no 16px cap),
  // so a one-bar view fills the panel instead of floating in white space
  const stepW = Math.max(3, beatToX * grid.stepBeats - 3);

  /** What the export plays here that the grid can't show (detour ·
   *  transition · handoff fill). Cached on the section object, so a drag
   *  never pays for it. */
  const gesture = useMemo(() => {
    if (!song || !anchorSpan) return null;
    // With the preview draft overlaid, exactly like the marker rail above —
    // otherwise the rail shows a detour the lanes refuse to explain.
    const live = spans.map((span) => ({ ...span, section: effectiveSection(span) }));
    const at = live.findIndex(
      (sp) => sp.sectionId === anchorSpan.sectionId && sp.occurrenceIndex === anchorSpan.occurrenceIndex,
    );
    return at < 0 ? null : gestureLayerFor(song, live, live[at]);
  }, [song, spans, anchorSpan, effectiveSection]);

  /** Which lanes will actually sound — the SAME rule the planner applies
   *  (`audibleLanes`), so a dimmed lane is a lane the export drops. */
  const mutedLanes = useMemo(() => new Set(section?.drumLaneMute ?? []), [section]);
  const soloedLanes = useMemo(() => new Set(section?.drumLaneSolo ?? []), [section]);
  const silentLanes = useMemo(() => {
    if (!section) return new Set<string>();
    const play = audibleLanes(section.drumLaneMute, section.drumLaneSolo);
    return new Set(DRUM_LANES.map((l) => l.key).filter((k) => !play.has(k as DrumLaneId)));
  }, [section]);

  /** Every resolved hit in the section — the pocket the glue measures. */
  const allDrumBeats = useMemo(() => {
    if (!hits) return [] as { beat: number; velocity: number }[];
    const out: { beat: number; velocity: number }[] = [];
    for (const list of hits.values()) for (const h of list) out.push({ beat: h.beat, velocity: h.velocity });
    return out.sort((a, b) => a.beat - b.beat);
  }, [hits]);

  const laneData = useMemo(
    () =>
      DRUM_LANES.map((lane) =>
        peakVelocityByStep((hits?.get(lane.key as DrumLaneId) ?? []) as LaneHit[], grid.stepBeats, stepCount),
      ),
    [hits, grid.stepBeats, stepCount],
  );

  /** Peak maps with the in-flight drag applied — memo-stable per lane, so a
   *  KICK drag re-renders KICK's row and nothing else. */
  const peakFor = useCallback(
    (li: number): ReadonlyMap<number, number> => {
      const d = velDrag;
      const laneKey = DRUM_LANES[li].key as DrumLaneId;
      if (!d || d.laneKey !== laneKey || !d.moved) return laneData[li].peak;
      const out = new Map(laneData[li].peak);
      if (d.scrub) {
        if (d.param === "vel") {
          const delta = d.value - d.scrub.pressed0;
          for (const t of d.scrub.targets) out.set(t.stepIdx, clamp(t.value0 + delta, 1, 127));
        }
      } else {
        out.set(d.stepIdx, d.value);
      }
      return out;
    },
    [velDrag, laneData],
  );

  // ---- width ------------------------------------------------------------------

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // A drag must never outlive its gesture: if the pointerup is swallowed by
  // another layer (a menu backdrop, an overlay), drop the in-flight drag
  // instead of leaving a readout glued to the canvas.
  useEffect(() => {
    const clear = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setVelDrag(null);
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  // shift-click extends the bar range; track the modifier globally so the
  // gutter's lane labels can extend a LANE set the same way
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    const blur = () => setShiftHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCopyArm(null); setSel(null); }
    };
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  // ---- selection ---------------------------------------------------------------

  const selRange = useMemo(() => {
    if (!sel || !anchorSpan || sel.sectionId !== anchorSpan.section.id) return null;
    const bpb = grid.beatsPerBar;
    const from = Math.min(sel.fromBar, sel.toBar);
    const to = Math.max(sel.fromBar, sel.toBar);
    return { startBeat: from * bpb, endBeat: (to + 1) * bpb, laneKeys: sel.lanes };
  }, [sel, anchorSpan, grid.beatsPerBar]);

  // Mirror into the shared time-selection store so other surfaces see the
  // same range without reading this view's local state.
  const selKey = selRange ? `${anchorSpan?.section.id}:${selRange.startBeat}:${selRange.endBeat}:${selRange.laneKeys.join("+")}` : "";
  useEffect(() => {
    const store = useTimeSelectionStore.getState();
    if (!selRange || !anchorSpan) {
      store.clearSelection();
      return;
    }
    store.setSelection({
      sectionId: anchorSpan.section.id,
      startBeat: selRange.startBeat,
      endBeat: selRange.endBeat,
      lanes: selRange.laneKeys,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const selectLane = useCallback((laneKey: DrumLaneId) => {
    if (!anchorSpan) return;
    setCopyArm(null);
    setSel((cur) => {
      const sameSection = cur && cur.sectionId === anchorSpan.section.id;
      // plain click = "this lane, the whole section"; shift adds/removes a
      // lane while keeping whatever bar range is already chosen
      if (shiftHeld && sameSection) {
        const has = cur!.lanes.includes(laneKey);
        const lanes = has ? cur!.lanes.filter((l) => l !== laneKey) : [...cur!.lanes, laneKey];
        return { ...cur!, lanes: lanes.length > 0 ? lanes : [laneKey] };
      }
      return { sectionId: anchorSpan.section.id, lanes: [laneKey], fromBar: 0, toBar: sectionBars - 1 };
    });
  }, [anchorSpan, sectionBars, shiftHeld]);

  const selectBar = useCallback((bar: number, extend = false) => {
    if (!anchorSpan) return;
    setSel((cur) => {
      const lanes = cur && cur.sectionId === anchorSpan.section.id ? cur.lanes : DRUM_LANES.map((l) => l.key as DrumLaneId);
      const from = extend && cur && cur.sectionId === anchorSpan.section.id ? cur.fromBar : bar;
      return { sectionId: anchorSpan.section.id, lanes, fromBar: from, toBar: bar };
    });
  }, [anchorSpan]);

  /** ◂ / ▸ walk the selection one bar at a time (creating a one-bar,
   *  all-lane selection on the first press). */
  const stepSelBar = useCallback((delta: number) => {
    if (!anchorSpan) return;
    setSel((cur) => {
      const same = cur && cur.sectionId === anchorSpan.section.id;
      if (!same) {
        const bar = clamp(delta < 0 ? sectionBars - 1 : 0, 0, sectionBars - 1);
        return { sectionId: anchorSpan.section.id, lanes: DRUM_LANES.map((l) => l.key as DrumLaneId), fromBar: bar, toBar: bar };
      }
      const lo = Math.min(cur!.fromBar, cur!.toBar);
      const hi = Math.max(cur!.fromBar, cur!.toBar);
      const width = hi - lo;
      const nextLo = clamp(lo + delta, 0, Math.max(0, sectionBars - 1 - width));
      return { ...cur!, fromBar: nextLo, toBar: nextLo + width };
    });
  }, [anchorSpan, sectionBars]);

  const clearSelection = useCallback(() => {
    setSel(null);
    setCopyArm(null);
  }, []);

  // The spine retargets this view, so a selection can outlive its section —
  // and a section can shrink under it. Drop it, or clamp it, but never let
  // the navigator name a bar that no longer exists.
  useEffect(() => {
    setSel((cur) => {
      if (!cur) return cur;
      if (!anchorSpan || cur.sectionId !== anchorSpan.section.id) return null;
      const last = sectionBars - 1;
      const fromBar = clamp(cur.fromBar, 0, last);
      const toBar = clamp(cur.toBar, 0, last);
      return fromBar === cur.fromBar && toBar === cur.toBar ? cur : { ...cur, fromBar, toBar };
    });
  }, [anchorSpan, sectionBars]);

  // Keep the selected bars in view — with a fixed bars-per-view the canvas is
  // wider than the panel, so walking bars with ◂ ▸ must carry the viewport.
  const selFrom = sel ? Math.min(sel.fromBar, sel.toBar) : null;
  const selTo = sel ? Math.max(sel.fromBar, sel.toBar) : null;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || selFrom === null || selTo === null) return;
    const lo = selFrom * barPx;
    const hi = (selTo + 1) * barPx;
    // prefer the selection's left edge: walking bars should feel like
    // turning pages, not like chasing content
    if (lo < el.scrollLeft || hi > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, lo - 6);
  }, [selFrom, selTo, barPx]);

  // ---- draft plumbing ------------------------------------------------------------

  const writeSection = useCallback(
    (sectionId: string, base: BlueprintSection, mutate: (sec: BlueprintSection) => BlueprintSection) => {
      const current = useDrumsDraftStore.getState();
      const sec = current.sectionId === sectionId && current.section ? current.section : base;
      useDrumsDraftStore.getState().setDraft(sectionId, mutate(sec));
    },
    [],
  );

  /** M / S — a per-lane mixer flag on the section (draft → Apply). */
  const toggleLaneFlag = useCallback(
    (flag: "drumLaneMute" | "drumLaneSolo", laneKey: string) => {
      if (!anchorSpan) return;
      writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => {
        const cur = sec[flag] ?? [];
        const next = cur.includes(laneKey as never)
          ? cur.filter((k) => k !== laneKey)
          : [...cur, laneKey as never];
        return { ...sec, [flag]: next.length > 0 ? next : undefined };
      });
    },
    [anchorSpan, writeSection],
  );

  /** A lane's MIDI CC assignment (draft → Apply). */
  const setLaneCc = useCallback(
    (laneKey: string, spec: { cc: number; from: number; to: number } | null) => {
      if (!anchorSpan) return;
      writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => {
        const next = { ...(sec.drumLaneCc ?? {}) };
        if (spec) next[laneKey as keyof typeof next] = spec;
        else delete next[laneKey as keyof typeof next];
        return { ...sec, drumLaneCc: Object.keys(next).length > 0 ? next : undefined };
      });
    },
    [anchorSpan, writeSection],
  );

  const applyDraft = useCallback(() => {
    const st = useDrumsDraftStore.getState();
    if (st.sectionId && st.section) {
      const sectionId = st.sectionId;
      const next = st.section;
      updateCurrentSong((s) => updateSection(s, sectionId, () => next));
      useDrumsDraftStore.getState().clearDraft();
    }
    setEditorOpen(false);
  }, [updateCurrentSong]);

  const revertDraft = useCallback(() => {
    useDrumsDraftStore.getState().clearDraft();
    setEditorOpen(false);
  }, []);

  // ---- gestures: velocity (commit on release) -------------------------------------

  const authoredNotesFor = useCallback(
    (laneKey: DrumLaneId): Map<number, DrumBlockNote> => {
      const map = new Map<number, DrumBlockNote>();
      if (!section) return map;
      const tol = Math.max(0.02, grid.stepBeats * 0.35);
      for (const b of section.drumBlocks ?? []) {
        if (b.mode !== "steps" || b.lane !== laneKey) continue;
        for (const n of b.notes ?? []) {
          const abs = b.startBeat + n.beat;
          const idx = Math.round(abs / grid.stepBeats);
          if (Math.abs(abs - idx * grid.stepBeats) > tol) continue;
          const prev = map.get(idx);
          if (!prev || n.velocity > prev.velocity) map.set(idx, n);
        }
      }
      return map;
    },
    [section, grid.stepBeats],
  );

  /** What each lane's cells carry beyond velocity — the marks `LaneRow`
   *  draws (ratchet ticks, a flam slash, a gate rule) plus the value of the
   *  lane's ACTIVE step param, so a gate/ratchet/flam is visible after the
   *  drag ends. Memoised per (section, grid, chip selection) so only the
   *  lane you edited re-renders. */
  const laneMarks = useMemo(
    () =>
      DRUM_LANES.map((lane) => {
        const laneKey = lane.key as DrumLaneId;
        const active = asStepParam(stepSel[laneKey]);
        const spec = PARAM_SPECS[active];
        const ratchet = new Map<number, number>();
        const flam = new Set<number>();
        const gate = new Map<number, number>();
        const values = new Map<number, number>();
        const voices = new Map<number, { label: string; index: number }>();
        const family = DRUM_LANE_VOICES[laneKey] ?? [];
        for (const [stepIdx, note] of authoredNotesFor(laneKey)) {
          const vi = family.indexOf(note.voice as KitVoice);
          if (vi > 0) voices.set(stepIdx, { label: VOICE_LABEL[note.voice as KitVoice] ?? String(note.voice), index: vi });
          if (note.ratchet && note.ratchet > 1) ratchet.set(stepIdx, note.ratchet);
          if (note.flam) flam.add(stepIdx);
          if (note.durBeats !== undefined) {
            const frac = note.durBeats / grid.stepBeats;
            if (Math.abs(frac - 1) > 0.02) gate.set(stepIdx, frac);
          }
          const v = spec.read(note, grid.stepBeats, laneKey);
          if (v !== undefined) values.set(stepIdx, v);
        }
        return { ratchet, flam, gate, active, values, voices };
      }),
    [authoredNotesFor, stepSel, grid.stepBeats],
  );

  /** The press-time snapshot for a selection-wide scrub: every authored note
   *  and every resolved hit inside the selected bars on the pressed lane. */  const buildScrub = useCallback((laneKey: DrumLaneId, param: StepParam, pressed0: number): VelDrag["scrub"] => {
    if (!section || !selRange || !selRange.laneKeys.includes(laneKey)) return null;
    if (selRange.endBeat - selRange.startBeat <= grid.stepBeats + 1e-6) return null;
    const spec = PARAM_SPECS[param];
    const targets: ScrubTargets = [];
    for (const b of section.drumBlocks ?? []) {
      if (b.mode !== "steps" || b.lane !== laneKey) continue;
      for (const n of b.notes ?? []) {
        const abs = b.startBeat + n.beat;
        if (abs < selRange.startBeat - 1e-9 || abs >= selRange.endBeat - 1e-9) continue;
        targets.push({
          draft: {
            beat: round4(abs - selRange.startBeat), voice: n.voice, velocity: n.velocity,
            offsetBeats: n.offsetBeats, durBeats: n.durBeats, prob: n.prob, ratchet: n.ratchet, flam: n.flam,
          },
          value0: spec.read(n, grid.stepBeats, laneKey) ?? spec.rest,
          stepIdx: Math.round(abs / grid.stepBeats),
        });
      }
    }
    const covered = new Set(targets.map((t) => t.stepIdx));
    const laneHits = hits?.get(laneKey) ?? [];
    const tol = Math.max(0.02, grid.stepBeats * 0.35);
    for (let q = 0; q < stepCount; q++) {
      const beat = q * grid.stepBeats;
      if (beat < selRange.startBeat - 1e-9 || beat >= selRange.endBeat - 1e-9) continue;
      if (covered.has(q)) continue;
      const onStep = laneHits.filter((h) => Math.abs(h.beat - beat) < tol);
      if (onStep.length === 0) continue;
      for (const h of onStep) {
        targets.push({
          draft: { beat: round4(h.beat - selRange.startBeat), voice: h.voice as DrumVoiceName, velocity: h.velocity },
          value0: param === "vel" ? h.velocity : spec.rest,
          stepIdx: q,
        });
      }
    }
    if (targets.length === 0) return null;
    return { targets, start: selRange.startBeat, end: selRange.endBeat, pressed0 };
  }, [section, selRange, grid.stepBeats, hits, stepCount]);

  /** The velocity a freshly created hit gets: the dragged value when the
   *  chip is on VEL, otherwise the engine's neutral 100. */
  const newHitVelocity = (d: VelDrag): number =>
    d.param === "vel" ? Math.round(d.value) : 100;

  /** One write for a whole gesture. */
  const commitVelocity = useCallback((d: VelDrag) => {
    if (!anchorSpan || !section) return;
    const span = anchorSpan;
    const spec = PARAM_SPECS[d.param];
    if (d.scrub) {
      const delta = d.value - d.scrub.pressed0;
      const notes: DrumBlockNote[] = d.scrub.targets.map((t) => {
        const next = spec.kind === "continuous" ? clampParam(spec, t.value0 + delta) : d.value;
        const draft = { ...t.draft };
        spec.write(draft, next, grid.stepBeats, d.laneKey);
        return { ...draft, voice: draft.voice as DrumVoiceName };
      });
      const block: DrumBlock = {
        id: `blk-${d.laneKey}-${round4(d.scrub.start)}-${round4(d.scrub.end)}-steps`,
        lane: d.laneKey,
        startBeat: d.scrub.start,
        endBeat: d.scrub.end,
        mode: "steps",
        notes,
      };
      writeSection(span.section.id, span.section, (sec) => ({
        ...sec,
        drumBlocks: upsertModeBlocks(sec.drumBlocks, d.scrub!.start, d.scrub!.end, [block]),
      }));
      return;
    }
    const existing = (section.drumBlocks ?? []).find(
      (b) => b.mode === "steps" && b.lane === d.laneKey && d.stepBeat >= b.startBeat - 1e-9 && d.stepBeat < b.endBeat - 1e-9,
    );
    const start = existing ? existing.startBeat : d.stepBeat;
    const end = existing ? existing.endBeat : round4(d.stepBeat + grid.stepBeats);
    const laneHits = hits?.get(d.laneKey) ?? [];
    const tol = Math.max(0.02, grid.stepBeats * 0.35);
    const onStep = laneHits.filter((h) => Math.abs(h.beat - d.stepBeat) < tol);
    let notes: DrumBlockNote[];
    const voice = () => DRUM_LANE_PRIMARY[d.laneKey] as DrumVoiceName;
    if (existing && (existing.notes?.length ?? 0) > 0) {
      notes = (existing.notes ?? []).map((n) => ({ ...n }));
      let target = notes.find((n) => Math.abs(start + n.beat - d.stepBeat) < tol);
      if (!target) {
        if (onStep.length === 0) {
          // an empty step: a click/drag at a height CREATES the hit there
          if (!d.addIfEmpty) return;
          // a new hit gets a real velocity — `d.value` is the PARAM's value
          // (a ratchet of 2 is not a velocity of 2)
          target = { beat: round4(d.stepBeat - start), voice: voice(), velocity: newHitVelocity(d) };
        } else {
          const loudest = onStep.reduce((a, b) => (b.velocity > a.velocity ? b : a));
          target = { beat: round4(loudest.beat - start), voice: loudest.voice as DrumVoiceName, velocity: loudest.velocity };
        }
        notes.push(target);
      }
      spec.write(target, d.value, grid.stepBeats, d.laneKey);
    } else if (onStep.length === 0) {
      if (!d.addIfEmpty) return;
      notes = [{ beat: 0, voice: voice(), velocity: newHitVelocity(d) }];
      spec.write(notes[0], d.value, grid.stepBeats, d.laneKey);
    } else {
      notes = onStep.map((h) => ({ beat: round4(h.beat - start), voice: h.voice as DrumVoiceName, velocity: h.velocity }));
      const loudest = notes.reduce((a, b) => (b.velocity > a.velocity ? b : a));
      spec.write(loudest, d.value, grid.stepBeats, d.laneKey);
    }
    const block: DrumBlock = {
      id: existing?.id ?? `blk-${d.laneKey}-${round4(start)}-${round4(end)}-steps`,
      lane: d.laneKey,
      startBeat: start,
      endBeat: end,
      mode: "steps",
      notes,
    };
    writeSection(span.section.id, span.section, (sec) => ({ ...sec, drumBlocks: upsertModeBlocks(sec.drumBlocks, start, end, [block]) }));
  }, [anchorSpan, section, hits, grid.stepBeats, writeSection]);

  /** Click feedback: play the hit you just made or pressed, on the lane's
   *  own voice. `voice` defaults to whatever the step already resolves to. */
  const auditionStep = useCallback((laneKey: DrumLaneId, beat: number, voice?: KitVoice, velocity?: number) => {
    const laneHits = hits?.get(laneKey) ?? [];
    const tol = Math.max(0.02, grid.stepBeats * 0.35);
    const hit = laneHits.find((h) => Math.abs(h.beat - beat) < tol);
    const v = voice ?? ((hit?.voice as KitVoice | undefined) ?? (DRUM_LANE_PRIMARY[laneKey] as KitVoice));
    void auditionDrumHit(v, velocity ?? hit?.velocity ?? 100);
  }, [hits, grid.stepBeats]);

  const toggleStep = useCallback((laneKey: DrumLaneId, beat: number) => {
    if (!anchorSpan || !section) return;
    writeSection(anchorSpan.section.id, anchorSpan.section, (s) =>
      withToggledStep(s, {
        section, song: song ?? undefined, occurrenceIndex: anchorSpan.occurrenceIndex,
        laneKey, beat, stepSize: grid.stepBeats,
      }),
    );
    setSelectedSectionId(anchorSpan.section.id);
  }, [anchorSpan, section, song, grid.stepBeats, writeSection, setSelectedSectionId]);


  const localPoint = (e: ReactPointerEvent): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onCanvasDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !anchorSpan) return;
    const { x, y } = localPoint(e);
    const bar = clamp(Math.floor(x / barPx), 0, sectionBars - 1);

    // the ruler band: bar selection (or the paste target while copying)
    if (y < TOP) {
      if (copyArm) { pasteAtBar(bar); return; }
      selectBar(bar, e.shiftKey);
      return;
    }

    const laneIdx = clamp(Math.floor((y - TOP) / ROW_H), 0, LANE_COUNT - 1);
    const laneKey = DRUM_LANES[laneIdx].key as DrumLaneId;
    const stepIdx = clamp(Math.floor(x / (beatToX * grid.stepBeats)), 0, stepCount - 1);
    const stepBeat = round4(stepIdx * grid.stepBeats);

    if (copyArm) { pasteAtBar(bar); return; }

    const authored = authoredNotesFor(laneKey).get(stepIdx);
    const param = asStepParam(stepSel[laneKey]);
    const cellTop = TOP + laneIdx * ROW_H + 5;
    const cellH = ROW_H - 12;
    // VEL is absolute: the press height IS the value — a click and a drag
    // therefore use the same mapping
    const startValue = param === "vel"
      ? velocityAt(y, cellTop, cellH)
      : (authored ? (PARAM_SPECS[param].read(authored, grid.stepBeats, laneKey) ?? PARAM_SPECS[param].rest) : PARAM_SPECS[param].rest);
    const d: VelDrag = {
      laneKey, stepIdx, stepBeat, param,
      startValue, value: startValue,
      scrub: buildScrub(laneKey, param, startValue),
      x0: x, y0: y, x, y,
      cellTop,
      cellH,
      addIfEmpty: false,
      moved: false,
    };
    dragRef.current = d;
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* fine */ }
  };

  const onCanvasMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // NOTE: no `e.buttons` guard here — a synthetic/pen pointer can report 0
    // mid-drag. The window-level pointerup listener is what ends the gesture.
    const { x, y } = localPoint(e);
    // the origin is fixed: `dy` is press→pointer, not last-move→pointer
    const dy = y - d.y0;
    if (!d.moved && Math.abs(dy) < 4) return;
    const spec = PARAM_SPECS[d.param];
    d.moved = true;
    // VEL follows the pointer's height exactly (0 at the cell floor, 127 at
    // its top) — so a click and a drag are the same mapping, and the whole
    // range is reachable in one cell. Other params scrub by delta.
    d.value = d.param === "vel"
      ? clampParam(spec, velocityAt(y, d.cellTop, d.cellH))
      : clampParam(spec, d.startValue - dy * spec.perPx);
    d.x = x;
    d.y = y;
    // dragging onto an empty step starts a hit, so a drag can also create one
    d.addIfEmpty = true;
    setVelDrag({ ...d });
  };

  const onCanvasUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setVelDrag(null);
    if (!d) return;
    if (!d.moved) {
      const laneHits = hits?.get(d.laneKey) ?? [];
      const tol = Math.max(0.02, grid.stepBeats * 0.35);
      const has = laneHits.some((h) => Math.abs(h.beat - d.stepBeat) < tol)
        || !!authoredNotesFor(d.laneKey).get(d.stepIdx);
      // With the STEP chip on VEL, a click IS a velocity edit: the height you
      // press is the value. Clicking the cell's floor (≤2) removes the hit.
      if (d.param === "vel") {
        const v = velocityAt(d.y, d.cellTop, d.cellH);
        if (v <= 2) {
          if (has) toggleStep(d.laneKey, d.stepBeat);
          return;
        }
        commitVelocity({ ...d, moved: true, value: v, addIfEmpty: true });
        auditionStep(d.laneKey, d.stepBeat, undefined, v);
        return;
      }
      // any other step parameter keeps click = toggle; the click still
      // sounds, so you hear the cell you just turned on
      toggleStep(d.laneKey, d.stepBeat);
      if (!has) auditionStep(d.laneKey, d.stepBeat);
      return;
    }
    if (d.param !== "vel" && !authoredNotesFor(d.laneKey).get(d.stepIdx)) {
      auditionStep(d.laneKey, d.stepBeat);
    }
    if (d.param === "vel" && d.value <= 2) {
      // dragged down to the floor — the same gesture as clicking it
      const laneHits = hits?.get(d.laneKey) ?? [];
      const tol = Math.max(0.02, grid.stepBeats * 0.35);
      const had = laneHits.some((h) => Math.abs(h.beat - d.stepBeat) < tol);
      if (had) { toggleStep(d.laneKey, d.stepBeat); return; }
      return;
    }
    commitVelocity(d);
  };

  // ---- commands: flatten / velocity ops / copy / regenerate ------------------------

  const laneRangeMaterial = useCallback((laneKey: DrumLaneId, start: number, end: number) => {
    const laneHits = (hits?.get(laneKey) ?? []).filter((h) => h.beat >= start - 1e-9 && h.beat < end - 1e-9);
    if (laneHits.length === 0) return null;
    const count = Math.max(1, Math.ceil((end - start) / grid.stepBeats - 1e-9));
    const peaks = new Array<number>(count).fill(0);
    const entries = laneHits.map((h) => {
      const stepIdx = clamp(Math.round((h.beat - start) / grid.stepBeats), 0, count - 1);
      peaks[stepIdx] = Math.max(peaks[stepIdx], h.velocity);
      return { h, stepIdx };
    });
    return { entries, stepCount: count, peak: Math.max(...peaks) };
  }, [hits, grid.stepBeats]);

  const stepsBlockFor = (laneKey: DrumLaneId, start: number, end: number, notes: DrumBlockNote[]): DrumBlock => ({
    id: `blk-${laneKey}-${round4(start)}-${round4(end)}-steps`,
    lane: laneKey,
    startBeat: start,
    endBeat: end,
    mode: "steps",
    notes,
  });

  const flattenSelection = useCallback(() => {
    if (!anchorSpan || !selRange) return;
    const changes: DrumBlock[] = [];
    for (const laneKey of selRange.laneKeys as DrumLaneId[]) {
      const mat = laneRangeMaterial(laneKey, selRange.startBeat, selRange.endBeat);
      if (!mat) continue;
      changes.push(stepsBlockFor(laneKey, selRange.startBeat, selRange.endBeat, mat.entries.map(({ h }) => ({
        beat: round4(h.beat - selRange.startBeat), voice: h.voice as DrumVoiceName, velocity: h.velocity,
      }))));
    }
    if (changes.length === 0) return;
    writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
      ...sec,
      drumBlocks: replaceRangeBlocks(sec.drumBlocks, selRange.laneKeys, selRange.startBeat, selRange.endBeat, changes),
    }));
  }, [anchorSpan, selRange, laneRangeMaterial, writeSection]);

  const applyVelocityOp = useCallback((op: VelocityOp) => {
    if (!anchorSpan || !selRange) return;
    const changes: DrumBlock[] = [];
    for (const laneKey of selRange.laneKeys as DrumLaneId[]) {
      const mat = laneRangeMaterial(laneKey, selRange.startBeat, selRange.endBeat);
      if (!mat) continue;
      const seed = `${anchorSpan.section.id}:${laneKey}`;
      const notes = mat.entries.map(({ h, stepIdx }) => ({
        beat: round4(h.beat - selRange.startBeat),
        voice: h.voice as DrumVoiceName,
        velocity: scaleVelocity(h.velocity, velocityOpFactor(op, stepIdx, { stepCount: mat.stepCount, peakVelocity: mat.peak, seed })),
      }));
      changes.push(stepsBlockFor(laneKey, selRange.startBeat, selRange.endBeat, notes));
    }
    if (changes.length === 0) return;
    writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
      ...sec,
      drumBlocks: replaceRangeBlocks(sec.drumBlocks, selRange.laneKeys, selRange.startBeat, selRange.endBeat, changes),
    }));
  }, [anchorSpan, selRange, laneRangeMaterial, writeSection]);

  const pasteAtBar = useCallback((destBar: number) => {
    if (!copyArm || !anchorSpan || !section) return;
    const bpb = grid.beatsPerBar;
    const srcStart = Math.min(copyArm.fromBar, copyArm.toBar) * bpb;
    const srcEnd = (Math.max(copyArm.fromBar, copyArm.toBar) + 1) * bpb;
    const destStart = destBar * bpb;
    const destEnd = destStart + (srcEnd - srcStart);
    const copies = copyBlocksToRange(section.drumBlocks, copyArm.lanes, srcStart, srcEnd, destStart);
    const covered = new Set(copies.map((c) => c.lane));
    for (const laneKey of copyArm.lanes) {
      if (covered.has(laneKey)) continue;
      const mat = laneRangeMaterial(laneKey, srcStart, srcEnd);
      if (!mat) continue;
      copies.push(stepsBlockFor(laneKey, destStart, destEnd, mat.entries.map(({ h }) => ({
        beat: round4(h.beat - srcStart), voice: h.voice as DrumVoiceName, velocity: h.velocity,
      }))));
    }
    if (copies.length === 0) { setCopyArm(null); return; }
    writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
      ...sec,
      drumBlocks: upsertBlocks(stripFxCarriers(sec.drumBlocks, copyArm.lanes, destStart, destEnd), copies),
    }));
    const len = Math.max(1, Math.round((srcEnd - srcStart) / bpb));
    setSel({ sectionId: anchorSpan.section.id, lanes: copyArm.lanes, fromBar: destBar, toBar: destBar + len - 1 });
    setCopyArm(null);
  }, [copyArm, anchorSpan, section, grid.beatsPerBar, laneRangeMaterial, writeSection]);

  const regenerate = useMemo(() => {
    if (!song || !anchorSpan || !section) return null;
    const pattern = section.drumPattern ?? inferPatternForSection(section, song);
    const preset = PRESET_DATA[pattern];
    const all = preset?.variants ?? [];
    if (all.length <= 1) return null;
    const compatible = compatibleVariantIndices(all, sectionDurationBeats(section), beatsPerBar(section));
    const pool = compatible.length > 1 ? compatible : all.map((_, i) => i);
    const current = section.drumVariantIndex
      ?? seededVariantIndex(pattern, section, song, anchorSpan.occurrenceIndex)
      ?? 0;
    return { pool, current };
  }, [song, anchorSpan, section]);

  const regenerateVariant = useCallback(() => {
    if (!anchorSpan || !regenerate) return;
    const position = regenerate.pool.indexOf(regenerate.current);
    const next = regenerate.pool[(position + 1) % regenerate.pool.length];
    writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({ ...sec, drumVariantIndex: next }));
  }, [anchorSpan, regenerate, writeSection]);

  // ---- lane FX ------------------------------------------------------------------

  const fxScopeFor = useCallback((laneKey: string): { startBeat: number; endBeat: number } => {
    if (selRange && (selRange.laneKeys as string[]).includes(laneKey)) {
      return { startBeat: selRange.startBeat, endBeat: selRange.endBeat };
    }
    return { startBeat: 0, endBeat: section ? sectionDurationBeats(section) : 0 };
  }, [selRange, section]);

  const fxValues = useMemo(() => {
    const out: Record<string, DrumBlockFx | undefined> = {};
    if (!section) return out;
    for (const lane of DRUM_LANES) {
      const scope = fxScopeFor(lane.key);
      out[lane.key] = fxForLanes(section.drumBlocks, [lane.key as DrumLaneId], scope.startBeat, scope.endBeat);
    }
    return out;
  }, [section, fxScopeFor]);

  const commitLaneFx = useCallback((laneKey: string, next: DrumBlockFx) => {
    if (!anchorSpan || !section) return;
    const scope = fxScopeFor(laneKey);
    writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
      ...sec,
      drumBlocks: fxBlocksFor(sec.drumBlocks, [laneKey as DrumLaneId], scope.startBeat, scope.endBeat, next),
    }));
    setSelectedSectionId(anchorSpan.section.id);
  }, [anchorSpan, section, fxScopeFor, writeSection, setSelectedSectionId]);

  // ---- handoff / detour markers ---------------------------------------------------
  // Read from the plan the exporter applies, for the section on screen only —
  // the rail sits inside THIS section's beat axis, so markers land on real bars.

  const markers = useMemo(() => {
    if (!anchorSpan || !section || !song) return null;
    const resolved = spans.map((span) => {
      const sec = effectiveSection(span);
      return {
        sectionId: span.sectionId,
        occurrenceIndex: span.occurrenceIndex,
        durationBeats: span.durationBeats,
        section: sec,
        hasVariant: !!resolveSectionVariant(sec, song, span.occurrenceIndex),
      };
    });
    const at = resolved.findIndex(
      (r) => r.sectionId === anchorSpan.sectionId && r.occurrenceIndex === anchorSpan.occurrenceIndex,
    );
    if (at < 0) return null;
    return sectionMarkers(resolved)[at];
  }, [anchorSpan, section, song, spans, effectiveSection]);

  /** A marker click focuses the gesture's bars (shift clears an authored one). */
  const focusGesture = useCallback(
    (range: { startBeat: number; endBeat: number }, clear: (() => void) | null, shift: boolean) => {
      if (!anchorSpan) return;
      if (shift && clear) {
        clear();
        return;
      }
      const bpb = Math.max(1e-6, beatsPerBar(anchorSpan.section));
      const from = clamp(Math.floor(range.startBeat / bpb), 0, sectionBars - 1);
      const to = clamp(Math.ceil(range.endBeat / bpb) - 1, from, sectionBars - 1);
      setCopyArm(null);
      setSel({
        sectionId: anchorSpan.section.id,
        lanes: DRUM_LANES.map((l) => l.key as DrumLaneId),
        fromBar: from,
        toBar: to,
      });
    },
    [anchorSpan, sectionBars],
  );

  // ---- render -------------------------------------------------------------------

  if (!song || spans.length === 0 || !anchorSpan || !section) {
    return (
      <div className="relative overflow-x-auto border border-edge rounded bg-deep">
        <p className="text-inkMuted text-xs p-3">No sections yet — add some in Structure first.</p>
      </div>
    );
  }

  const currentPattern = section.drumPattern ?? inferPatternForSection(section, song);
  const hasDraft = !!draftSection && draftSectionId === anchorSpan.section.id;
  const barLabel = sel ? `${Math.min(sel.fromBar, sel.toBar) + 1}–${Math.max(sel.fromBar, sel.toBar) + 1}` : "";
  const gridLines = Array.from({ length: sectionBars + 1 }).map((_, b) => b * barPx);
  const rangeForModal = selRange
    ? { startBeat: selRange.startBeat, endBeat: selRange.endBeat, laneKeys: selRange.laneKeys }
    : null;

  return (
    <div className="w-full min-w-0">
      <GrooveShelf
        span={anchorSpan}
        section={section}
        current={currentPattern}
        onPick={(pattern) => {
          writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
            ...sec,
            drumPattern: pattern as BlueprintSection["drumPattern"],
            drumVariantIndex: 0,
            drumMeterOutline: undefined,
          }));
          setSelectedSectionId(anchorSpan.section.id);
        }}
      />

      {/* header: zoom (bars per view) · selection pill · draft controls */}
      <div className="flex items-center gap-2 mb-1.5 min-h-6">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-inkMuted">bars</span>
        <div className="flex items-center gap-0.5">
          {BARS_PER_VIEW_OPTIONS.map((n) => (
            <button
              key={String(n)}
              onClick={() => { setBarsPerView(n); saveJson("trackdraft-drums-bars-view", n); }}
              className="font-mono text-2xs rounded-sm px-1.5 py-0.5 border"
              style={{
                borderColor: barsPerView === n ? P.track : P.grid,
                color: barsPerView === n ? P.track : P.label,
                background: barsPerView === n ? "rgba(232,181,74,0.12)" : "transparent",
              }}
              title={`${n === "all" ? "Whole section" : `${n} bar${n === 1 ? "" : "s"}`} per view — the step grid follows the meter`}
            >
              {n === "all" ? "ALL" : n}
            </button>
          ))}
        </div>

        {/* the bar navigator — the one-bar view's spine, tied to the
            selection: it names the bars you have chosen and walks them */}
        <span className="flex items-center gap-1 font-mono text-2xs text-ink tabular-nums">
          <button
            onClick={() => stepSelBar(-1)}
            className="w-4 h-4 flex items-center justify-center text-inkMuted hover:text-ink"
            title="Previous bar"
            aria-label="Previous bar"
          >
            ◂
          </button>
          <span title="Selection, in bars of this section">
            {anchorSpan.section.name} ·{" "}
            {sel
              ? (() => {
                  const a = Math.min(sel.fromBar, sel.toBar) + 1;
                  const b = Math.max(sel.fromBar, sel.toBar) + 1;
                  return a === b ? `bar ${a}/${sectionBars}` : `bars ${a}–${b}/${sectionBars}`;
                })()
              : `${sectionBars} bars`}
          </span>
          <button
            onClick={() => stepSelBar(1)}
            className="w-4 h-4 flex items-center justify-center text-inkMuted hover:text-ink"
            title="Next bar"
            aria-label="Next bar"
          >
            ▸
          </button>
        </span>

        <GrooveGlue
          section={section}
          drumBeats={allDrumBeats}
          onWrite={(mutate) => writeSection(anchorSpan.section.id, anchorSpan.section, mutate)}
        />

        <span className="flex-1" />

        {copyArm && (
          <span className="font-mono text-2xs text-track" title="Click a bar number (or any lane cell) to paste — Esc cancels">
            ⧉ click a bar to paste · esc
          </span>
        )}

        {sel && !copyArm && (
          <span className="flex items-center gap-1 rounded border border-edge px-1.5 py-0.5">
            <span className="font-mono text-2xs text-inkMuted">
              {sel.lanes.map((k) => DRUM_LANES.find((l) => l.key === k)?.label ?? k).join("·")} × bars {barLabel}
            </span>
            <button
              onClick={() => setCopyArm(sel)}
              className="font-mono text-2xs rounded px-1 border border-edge text-inkMuted hover:text-ink"
              title="Copy this selection, then click a bar to paste it there"
            >
              ⧉
            </button>
            <button
              onClick={flattenSelection}
              className="font-mono text-2xs rounded px-1 border border-edge text-inkMuted hover:text-ink"
              title="Freeze the selection's audible material into editable bars"
            >
              ❄
            </button>
            <button
              onClick={regenerateVariant}
              disabled={!regenerate}
              className="font-mono text-2xs rounded px-1 border border-edge text-inkMuted hover:text-ink disabled:opacity-30"
              title="Roll the section to its next seeded variant"
            >
              ⟳
            </button>
            <button
              onClick={() => setEditorOpen(true)}
              className="font-mono text-2xs rounded px-1 border border-edge text-inkMuted hover:text-ink"
              title="Open the selection editor (Euclid · Motion · Velocity · FX)"
            >
              ⤢
            </button>
            <button
              onClick={clearSelection}
              className="font-mono text-2xs rounded px-1 border border-edge text-inkMuted hover:text-ink"
              title="Clear the selection (Esc)"
            >
              ✕
            </button>
          </span>
        )}

        {hasDraft && <span className="font-mono text-2xs uppercase tracking-wider text-track">● preview</span>}
        {hasDraft && (
          <>
            <button onClick={applyDraft} className="font-mono text-2xs rounded px-2 py-0.5 border border-accent text-accent bg-accent/10 hover:bg-accent/20">Apply</button>
            <button onClick={revertDraft} className="font-mono text-2xs rounded px-2 py-0.5 border border-edge text-inkMuted hover:text-ink">Revert</button>
          </>
        )}
      </div>

      {/* TIER 2 — the surface lanes */}
      <div ref={frameRef} className="w-full border border-edge rounded bg-deep overflow-hidden">
        <div ref={scrollerRef} className="relative overflow-x-auto" style={{ cursor: copyArm ? "copy" : undefined }}>
          <div className="relative" style={{ width: GUTTER + contentW, height: HEIGHT }}>
            <svg
              ref={svgRef}
              width={contentW}
              height={HEIGHT}
              style={{ marginLeft: GUTTER }}
              className="block touch-none select-none"
              onPointerDown={onCanvasDown}
              onPointerMove={onCanvasMove}
              onPointerUp={onCanvasUp}
              onPointerCancel={onCanvasUp}
            >
              <defs>
                <pattern id="pencil-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(44)">
                  <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(38,34,27,0.30)" strokeWidth="1.15" />
                </pattern>
              </defs>

              {/* bar ruler — the numbers ARE the bar-selection targets */}
              {Array.from({ length: sectionBars }).map((_, b) => {
                const inSel = !!sel && b >= Math.min(sel.fromBar, sel.toBar) && b <= Math.max(sel.fromBar, sel.toBar);
                return (
                  <g key={`bn-${b}`}>
                    <rect
                      x={b * barPx} y={0} width={barPx} height={RULER_H}
                      fill={inSel ? "rgba(232,181,74,0.10)" : "transparent"}
                    />
                    <text
                      x={b * barPx + 4} y={15}
                      fontSize={9} fontFamily="'IBM Plex Mono', monospace"
                      fill={inSel ? P.track : P.grid}
                      pointerEvents="none"
                    >
                      {b + 1}
                    </text>
                  </g>
                );
              })}

              {/* the ruler/marker seam — the rail is a band, not floating text */}
              <line
                x1={0} y1={RULER_H} x2={contentW} y2={RULER_H}
                stroke={P.handDrawn ? P.grid : "#fff"}
                strokeOpacity={P.handDrawn ? 0.3 : 0.07}
                strokeWidth={1}
                pointerEvents="none"
              />

              {markers && (
                <MarkerRail
                  markers={markers}
                  beatToX={beatToX}
                  top={MARKER_TOP}
                  P={P}
                  onTransition={(e) => {
                    e.stopPropagation();
                    if (!markers.transition) return;
                    const manual = markers.transition.manual;
                    focusGesture(
                      markers.transition,
                      manual
                        ? () =>
                            writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
                              ...sec,
                              drumTransitionModel: undefined,
                              drumTransitionBars: undefined,
                            }))
                        : null,
                      e.shiftKey,
                    );
                  }}
                  onDetour={(e) => {
                    e.stopPropagation();
                    if (!markers.detour) return;
                    focusGesture(
                      markers.detour,
                      () =>
                        writeSection(anchorSpan.section.id, anchorSpan.section, (sec) => ({
                          ...sec,
                          drumVariationOutline: undefined,
                          drumVariationBars: undefined,
                          drumVariationStartBeat: undefined,
                        })),
                      e.shiftKey,
                    );
                  }}
                />
              )}

              {gridLines.map((x, i) => (
                <line
                  key={`bl-${i}`}
                  x1={x} y1={TOP} x2={x} y2={HEIGHT - 8}
                  stroke={P.handDrawn ? P.grid : "#fff"}
                  strokeOpacity={P.handDrawn ? 0.4 : 0.08}
                  strokeWidth={1}
                  pointerEvents="none"
                />
              ))}

              {sel && (
                <rect
                  x={Math.min(sel.fromBar, sel.toBar) * barPx}
                  y={TOP}
                  width={(Math.abs(sel.toBar - sel.fromBar) + 1) * barPx}
                  height={LANE_COUNT * ROW_H}
                  fill="rgba(232,181,74,0.06)"
                  pointerEvents="none"
                />
              )}

              {DRUM_LANES.map((lane, li) => {
                const inSel = !!sel && sel.lanes.includes(lane.key as DrumLaneId);
                return (
                  <g
                    key={`lane-${lane.key}`}
                    opacity={silentLanes.has(lane.key) ? 0.28 : sel && !inSel ? 0.62 : 1}
                  >
                    {inSel && (
                      <rect
                        x={Math.min(sel!.fromBar, sel!.toBar) * barPx}
                        y={TOP + li * ROW_H + 2}
                        width={(Math.abs(sel!.toBar - sel!.fromBar) + 1) * barPx}
                        height={ROW_H - 4}
                        fill="rgba(232,181,74,0.10)"
                        stroke="rgba(232,181,74,0.35)"
                        strokeWidth={1}
                        pointerEvents="none"
                      />
                    )}
                    <LaneRow
                      lane={{ ...lane, color: laneColor(lane, P) }}
                      beatToX={beatToX}
                      stepBeats={grid.stepBeats}
                      stepW={stepW}
                      stepCount={stepCount}
                      stepsPerBar={grid.stepsPerBar}
                      top={TOP + li * ROW_H}
                      rowH={ROW_H}
                      peak={peakFor(li)}
                      offGrid={laneData[li].offGrid}
                      marks={laneMarks[li]}
                      gesture={gesture?.get(lane.key as DrumLaneId)}
                      P={P}
                    />
                  </g>
                );
              })}

              {velDrag && velDrag.moved && (
                <g pointerEvents="none">
                  <rect x={velDrag.x + 14} y={velDrag.y - 46} width={72} height={32} rx={5} fill="rgba(11,13,17,0.95)" stroke={P.track} strokeOpacity={0.6} />
                  <text x={velDrag.x + 50} y={velDrag.y - 31} textAnchor="middle" fontSize={13} fontWeight={600} fontFamily="'IBM Plex Mono', monospace" fill={P.track}>
                    {PARAM_SPECS[velDrag.param].format(velDrag.value, grid.stepBeats, velDrag.laneKey)}
                  </text>
                  <text x={velDrag.x + 50} y={velDrag.y - 20} textAnchor="middle" fontSize={7.5} fontFamily="'IBM Plex Mono', monospace" fill={P.label}>
                    {PARAM_SPECS[velDrag.param].short}
                  </text>
                </g>
              )}
            </svg>

            <LaneGutter
              height={HEIGHT}
              width={GUTTER}
              top={TOP}
              rowH={ROW_H}
              stepSel={stepSel}
              fxSel={fxSel}
              fxValues={fxValues}
              fxPreview={fxPreview}
              selectedLanes={new Set(sel?.lanes ?? [])}
              onLaneClick={(laneKey) => selectLane(laneKey as DrumLaneId)}
              onStepSel={(laneKey, param) => {
                setStepSel((m) => { const next = { ...m, [laneKey]: param }; saveJson("trackdraft-drums-step-sel", next); return next; });
              }}
              onFxSel={(laneKey, id) => {
                setFxSel((m) => { const next = { ...m, [laneKey]: id }; saveJson("trackdraft-drums-fx-sel", next); return next; });
              }}
              silentLanes={silentLanes}
              mutedLanes={mutedLanes}
              soloedLanes={soloedLanes}
              onMute={(laneKey) => toggleLaneFlag("drumLaneMute", laneKey)}
              onSolo={(laneKey) => toggleLaneFlag("drumLaneSolo", laneKey)}
              ccs={(section.drumLaneCc ?? {}) as Record<string, { cc: number; from: number; to: number } | undefined>}
              onCcSet={(laneKey, spec) => setLaneCc(laneKey, spec)}
              onFxPreview={setFxPreview}
              onFxCommit={(laneKey, next) => { setFxPreview(null); commitLaneFx(laneKey, next); }}
            />
          </div>
        </div>
      </div>

      {editorOpen && rangeForModal && (
        <SelectionEditorModal
          span={anchorSpan}
          section={section}
          range={rangeForModal}
          hits={hits ?? new Map()}
          spans={spans}
          stepBeats={grid.stepBeats}
          hasDraft={hasDraft}
          onWrite={(mutate) => writeSection(anchorSpan.section.id, anchorSpan.section, mutate)}
          onVelocityOp={applyVelocityOp}
          onFlatten={flattenSelection}
          onRegenerate={regenerate ? regenerateVariant : null}
          onApply={applyDraft}
          onCancel={revertDraft}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
