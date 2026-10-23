import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { addSection, removeSection, reorderSections, repeatsFor, updateSection } from "../../lib/sections";
import { NOTE_TO_PC, pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { resolveChordOccurrences } from "@drum/library";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import IconBtn from "../common/IconBtn";
import ThemeToggle from "../common/ThemeToggle";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { pauseSong, playLoopRegion, playSectionLoop, playSong, resumeUnlooped, seekTo, stopSong } from "../../lib/playback/transportControl";
import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { classifySong } from "../../lib/classification";
import { askConfirm } from "../../lib/confirm";
import {
  SONG_BAR_PX_STEPS as BAR_PX_STEPS,
  anchoredScrollLeft,
  clampBarPx,
  scrollBarFromLeft,
  scrollLeftFromBar,
} from "../../lib/time/timeMath";
import { useTimeViewportStore } from "../../store/timeViewportStore";
import { usePinchToZoom } from "../../hooks/usePinchToZoom";
import type { BlueprintSection, BlueprintSong, SectionRole } from "../../types/blueprint";
import { beatsPerBarOf } from "../../lib/timeline/beatMap";

/** Zoom presets in px per BAR. Bar-linear on purpose: every bar is the
 *  same width — 7/8 bars included — because the bars are the axis (a
 *  time-linear scale would make odd-meter bars narrower than their
 *  neighbours and break "this section is an 8, that one's a 16"). The
 *  ladder now lives in `lib/time/timeMath` so every song-depth surface
 *  shares one zoom state. */

/** Rows for the block context palette (placement law tier 3:
 *  selection-scoped floats — the drums selection control is the first
 *  citizen, this is the second). */
const MENU_ITEM =
  "w-full text-left px-2.5 py-1 font-mono text-[11px] text-inkMuted hover:text-ink hover:bg-panelAlt/60";

/** Canonical role order for the blank-song first-section chips (same list
 *  and order as every other role picker in the app). */
const ROLES: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

/**
 * The Spine — the workspace's full-width top band (docs/design/workspace.md §2).
 *
 * Timeline v2 (user-specified 2026-09-21): fixed scale (px per BAR, default
 * 10), horizontally scrollable inside the full-bleed band — the mouse wheel
 * ZOOMS, anchored on the bar under the cursor; shift+wheel / trackpad swipe
 * / the slim `.daw-scroll` rail pans. A bar ruler on top doubles as the seek
 * control; a pixel-exact playhead auto-follows while playing. Controls live
 * ONLY in a compact icon-only strip ABOVE the timeline (transport: play ·
 * pause · stop · section loop + undo/redo, then zoom −/+ · fit ·
 * zoom-to-section · follow) — nothing sits at the timeline's left or right
 * ends. Blocks are TRUE scale — a short song leaves an honest empty tail,
 * it is never stretched to fit.
 *
 * Selection is the same `studioSelectionStore.selectedSectionId` the
 * arrangement timeline and the Mix/Bend panel already share, so the spine
 * re-targets them for free.
 */
export default function Spine({ song, hint }: { song: BlueprintSong; hint?: string }) {
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);
  const clockSource = useSongStore((s) => s.clockSource);
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const [tick, setTick] = useState<TransportTick | null>(null);
  const barPx = useTimeViewportStore((s) => s.scales.song);
  const setBarPx = (px: number) => useTimeViewportStore.getState().setScale("song", px);
  /** Auto-follow the playhead while playing; drops off on manual scroll. */
  const [follow, setFollow] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  /** Ruler-drawn loop region, in BARS (inclusive a..b). */
  const [region, setRegion] = useState<{ a: number; b: number } | null>(null);
  const [regionDraft, setRegionDraft] = useState<{ a: number; b: number } | null>(null);
  /** Right-click context palette on a block. */
  const [menu, setMenu] = useState<{ x: number; y: number; span: SectionSpan } | null>(null);
  /** Live resize drag — a DRAFT (not store writes), so the whole timeline
   *  reflows per frame and a whole gesture costs ONE undo step on release.
   *  `resizeRef` mirrors it for the window-level mouseup closure (Knob
   *  `latest` lesson); Esc clears the draft, which makes the release a
   *  no-op — the cancel path. */
  const [resizeDraft, setResizeDraftState] = useState<{ sectionId: string; bars: number } | null>(null);
  const resizeRef = useRef(resizeDraft);
  resizeRef.current = resizeDraft;
  /** Fresh values for the window-level gesture listeners — they hold the
   *  closure from when the drag BEGAN, so they must read these refs rather
   *  than the state captured in that closure (barPx and total both change
   *  mid-gesture: a resize draft reflows the timeline). */
  const barPxRef = useRef(barPx);
  barPxRef.current = barPx;
  function setResizeDraft(v: { sectionId: string; bars: number } | null) {
    resizeRef.current = v;
    setResizeDraftState(v);
  }
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rulerDrag = useRef<{ startBar: number; startX: number; moved: boolean } | null>(null);
  /** Hotkey targets — read through a ref so the once-mounted key listener
   *  always calls the latest closures (the Knob `latest` lesson). */
  const actionsRef = useRef<{
    space: () => void;
    zoomToSection: () => void;
    fit: () => void;
    loop: () => void;
    zoom: (dir: 1 | -1) => void;
    escape: () => void;
  } | null>(null);
  const canUndo = useSongStore((s) => s.canUndo());
  const canRedo = useSongStore((s) => s.canRedo());
  const undo = useSongStore((s) => s.undo);
  const redo = useSongStore((s) => s.redo);
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const transport = getSongTransport();
    return transport.onTick((t) => {
      setTick(t);
      setIsPaused(transport.isPaused());
      // A hard stop (not a pause) also drops the section loop + region.
      if (!t.isPlaying && !transport.isPaused()) {
        setLoopOn(false);
        setRegion(null);
      }
    });
  }, []);

  // The timeline renders the DRAFT-resized song while a resize gesture is
  // live — a pure recompute per frame, no store writes, no undo spam.
  const spans = useMemo(
    () =>
      sectionSpans(
        resizeDraft ? updateSection(song, resizeDraft.sectionId, (s) => ({ ...s, bars: resizeDraft.bars })) : song,
      ),
    [song, resizeDraft],
  );
  const total = useMemo(() => totalBars(spans), [spans]);
  const totalRef = useRef(total);
  totalRef.current = total;
  const liveIndex =
    tick?.isPlaying && tick.sectionIndex >= 0 && tick.sectionIndex < spans.length ? tick.sectionIndex : null;
  const playingSectionId =
    tick?.isPlaying && tick.sectionIndex >= 0 && tick.sectionIndex < spans.length
      ? spans[tick.sectionIndex].sectionId
      : null;

  // Playhead position — pixel-exact in bar space. Within a span, progress
  // maps to its BARS (bar-linear), so a 7/8 bar still spans `barPx`.
  let playheadPx: number | null = null;
  if (spans.length > 0 && tick && (tick.isPlaying || tick.beat > 0)) {
    const span =
      (liveIndex != null ? spans[liveIndex] : null) ??
      spans.find((s) => tick.beat >= s.startBeat && tick.beat < s.startBeat + s.durationBeats) ??
      null;
    if (span) {
      const frac =
        span.durationBeats > 0 ? Math.max(0, Math.min(1, (tick.beat - span.startBeat) / span.durationBeats)) : 0;
      playheadPx = (span.startBar + frac * span.bars) * barPx;
    }
  }

  // Auto-follow: keep the playhead inside a comfort band while playing.
  useEffect(() => {
    if (!follow || !tick?.isPlaying || playheadPx == null) return;
    const el = scrollRef.current;
    if (!el) return;
    const margin = 64;
    if (playheadPx < el.scrollLeft + margin || playheadPx > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = Math.max(0, playheadPx - el.clientWidth / 2);
    }
  }, [follow, tick?.isPlaying, playheadPx]);

  // A different song is a different timeline: don't restore the previous
  // song's scroll position into it.
  const lastSongRef = useRef(song.id);
  useEffect(() => {
    if (lastSongRef.current === song.id) return;
    lastSongRef.current = song.id;
    useTimeViewportStore.getState().setScrollBar("song", 0);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [song.id]);

  // Restore this depth's last scroll position (stored in bars, so it
  // survives zoom changes) and record manual scrolls for the next view.
  // Only one song-depth surface is mounted at a time, so this is a
  // hand-off, not a live sync.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const restore = requestAnimationFrame(() => {
      const state = useTimeViewportStore.getState();
      el.scrollLeft = scrollLeftFromBar(state.scrollBars.song, state.scales.song);
    });
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const state = useTimeViewportStore.getState();
        state.setScrollBar("song", scrollBarFromLeft(el.scrollLeft, state.scales.song));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(restore);
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Walk the selection into view when stopped (irrelevant while the
  // playhead is driving the scroll — follow owns it then).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || getSongTransport().getIsPlaying()) return;
    const span = spans.find((s) => s.sectionId === selectedSectionId);
    if (!span) return;
    const leftPx = span.startBar * barPx;
    const rightPx = (span.startBar + span.bars) * barPx;
    if (leftPx < el.scrollLeft || rightPx > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, leftPx - 24);
    }
  }, [selectedSectionId, barPx, spans]);

  // Mouse wheel over the timeline = zoom, anchored on the bar under the
  // cursor (the musical position you're pointing at stays put). Shift+wheel
  // and trackpad horizontal swipes keep the native pan and drop follow, like
  // any manual scroll; Ctrl+wheel is left alone (browser zoom). Native
  // listener because React's synthetic wheel is passive and can't
  // preventDefault. The tiny accumulator turns trackpad dribble into one
  // clean step per gesture "notch".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let acc = 0;
    function onWheel(e: WheelEvent) {
      if (!el) return;
      if (e.ctrlKey) return;
      if (e.shiftKey || e.deltaX !== 0) {
        setFollow(false);
        return; // native horizontal pan
      }
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      const dir: 1 | -1 = acc < 0 ? 1 : -1; // wheel up = zoom in
      acc = 0;
      const next =
        dir > 0
          ? BAR_PX_STEPS.find((v) => v > barPx + 0.01)
          : [...BAR_PX_STEPS].reverse().find((v) => v < barPx - 0.01);
      if (next == null) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const barAtCursor = (el.scrollLeft + px) / barPx;
      setBarPx(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, barAtCursor * next - px);
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [barPx]);

  // Pinch-to-zoom on touch, anchored like the wheel. The wheel path stays
  // for trackpads; this gives iPad/phone the same gesture as Ableton.
  usePinchToZoom(scrollRef, ({ scale, focalX }) => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = useTimeViewportStore.getState().scales.song;
    const next = clampBarPx("song", prev * scale);
    if (Math.abs(next - prev) < 1e-6) return;
    const left = anchoredScrollLeft(el.scrollLeft, focalX, prev, next);
    useTimeViewportStore.getState().setScale("song", next);
    requestAnimationFrame(() => {
      el.scrollLeft = left;
    });
  });

  // Hotkeys — workbench-wide: space = play/pause · Z = zoom-to-section ·
  // F = fit · L = section loop · [ ] = zoom ladder · Esc closes the palette
  // and clears the loop region. Skipped while typing in form fields; space
  // is left to the browser when a button outside the spine has focus
  // (buttons natively activate on space — handling it there would
  // double-fire).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const a = actionsRef.current;
      if (!a) return;
      switch (e.key) {
        case " ":
          if (e.repeat) return;
          if (t?.tagName === "BUTTON" && !t.closest("[data-spine]")) return;
          e.preventDefault();
          a.space();
          break;
        case "z":
        case "Z":
          if (!e.repeat) a.zoomToSection();
          break;
        case "f":
        case "F":
          if (!e.repeat) a.fit();
          break;
        case "l":
        case "L":
          if (!e.repeat) a.loop();
          break;
        case "[":
          a.zoom(-1);
          break;
        case "]":
          a.zoom(1);
          break;
        case "Escape":
          a.escape();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the context palette on any outside press, scroll, or resize.
  useEffect(() => {
    if (!menu) return;
    const el = scrollRef.current;
    const close = (e: MouseEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      setMenu(null);
    };
    const onScrollOrResize = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", onScrollOrResize);
    el?.addEventListener("scroll", onScrollOrResize);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", onScrollOrResize);
      el?.removeEventListener("scroll", onScrollOrResize);
    };
  }, [menu]);

  const contentW = Math.max(1, Math.ceil(total * barPx));
  const labelEvery = barPx >= 16 ? 4 : barPx >= 10 ? 8 : 16;

  function stepZoom(dir: 1 | -1) {
    const next =
      dir > 0
        ? BAR_PX_STEPS.find((v) => v > barPx + 0.01)
        : [...BAR_PX_STEPS].reverse().find((v) => v < barPx - 0.01);
    setBarPx(next ?? barPx);
  }

  /** Fit = the squeeze-to-width behavior demoted to a mode: the scale that
   *  shows the whole song in the current viewport. */
  function fitZoom() {
    const el = scrollRef.current;
    if (!el) return;
    setBarPx(Math.max(2, Math.floor(el.clientWidth / Math.max(1, total))));
  }

  /** Zoom-to-section — the scale that makes the selected section (or an
   *  explicit one — the context menu passes its target, since store updates
   *  haven't landed within the same tick) fill the viewport, then bring it
   *  into view. Goes beyond the manual 4–80 steps on purpose: filling a
   *  13-bar section needs ~55px/bar; − / + step back through the presets
   *  from there. */
  function zoomToSection(sectionId?: string) {
    const el = scrollRef.current;
    const span =
      spans.find((s) => s.sectionId === (sectionId ?? selectedSectionId)) ??
      (liveIndex != null ? spans[liveIndex] : null) ??
      spans[0];
    if (!el || !span || span.bars <= 0) return;
    const w = el.clientWidth;
    const next = Math.max(2, Math.min(120, Math.floor(w / span.bars)));
    setBarPx(next);
    const left = span.startBar * next;
    const width = span.bars * next;
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, width <= w ? left - (w - width) / 2 : left - 8);
    });
  }

  function toggleFollow() {
    setFollow((f) => {
      const next = !f;
      if (next && playheadPx != null) {
        const el = scrollRef.current;
        if (el) el.scrollLeft = Math.max(0, playheadPx - el.clientWidth / 2);
      }
      return next;
    });
  }

  /** Transport — the same shared control paths the layout header uses, so
   *  the two can't drift. This strip replaces the header's cluster on the
   *  workbench and is the seed of P2's collapsed header. */
  async function togglePlay() {
    if (tick?.isPlaying) return;
    setRegion(null); // a plain play is not the region loop
    await playSong(song, clockSource);
  }
  function pausePlayback() {
    pauseSong();
  }
  function stopPlayback() {
    stopSong();
  }
  /** Section loop — loops the section that's playing, or the one selected
   *  on the spine (so a section can be auditioned without playing first). */
  async function toggleLoop() {
    if (loopOn) {
      setLoopOn(false);
      await resumeUnlooped(song);
      return;
    }
    const sectionId = playingSectionId ?? selectedSectionId ?? spans[0]?.sectionId;
    if (!sectionId) return;
    setRegion(null); // section loop and region loop are mutually exclusive
    const ok = await playSectionLoop(song, sectionId);
    if (ok) setLoopOn(true);
  }

  /** Bar index for a client X position, clamped to the song — CONTENT-space
   *  math: the scroll container's own rect (its left edge is fixed on
   *  screen) plus its live `scrollLeft`. The original version read
   *  `clientX - rect.left` on the SCROLL CONTAINER, which only equals
   *  content x at scroll 0 — any resize drag taken while the timeline was
   *  scrolled mapped the pointer to the wrong bar, collapsing far-right
   *  sections to their 1-bar floor while the drag seemed to do nothing.
   *  (The ruler gesture passed its own element, which scrolls WITH the
   *  content and so self-compensated — two callers, one correct by
   *  accident. Now both share this single correct implementation.)
   *  `maxBar` defaults to the song end, but the right-edge resize passes
   *  no ceiling: that edge DEFINES the end for the last section, so
   *  clamping to the pre-drag total would cap growth at +1 bar per drag. */
  function barFromClientX(clientX: number, maxBar: number = totalRef.current): number {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const bar = Math.floor((clientX - rect.left + el.scrollLeft) / barPxRef.current);
    return Math.max(0, Math.min(maxBar, bar));
  }

  /** Seek to a bar (bar-quantized) — the ruler's plain-click gesture.
   *  Playing keeps playing from there; paused/stopped auditions from there.
   *  No-op under the Ableton clock (Live is the master). */
  function seekBar(bar: number) {
    const span = spans.find((s) => bar >= s.startBar && bar < s.startBar + s.bars);
    if (!span) return;
    setRegion(null); // a plain seek is not the region loop
    // Bars are evenly spaced across a span, so the divisor is its *mean* bar
    // length — equal to the declared meter unless a meter map makes the bars
    // different lengths.
    const beat = span.startBeat + (bar - span.startBar) * beatsPerBarOf(span);
    void seekTo(song, clockSource, beat);
  }

  /** Draw-loop the bars a..b (inclusive): bar b ends where bar b+1 begins. */
  function applyRegion(a: number, b: number) {
    const startSpan = spans.find((s) => a >= s.startBar && a < s.startBar + s.bars);
    const endSpan = spans.find((s) => b >= s.startBar && b < s.startBar + s.bars);
    if (!startSpan || !endSpan) return;
    const startBeat = startSpan.startBeat + (a - startSpan.startBar) * beatsPerBarOf(startSpan);
    const endBeat = endSpan.startBeat + (b + 1 - endSpan.startBar) * beatsPerBarOf(endSpan);
    setRegion({ a, b });
    setLoopOn(false);
    void playLoopRegion(song, startBeat, endBeat);
  }

  /** Ruler gesture: press = remember the bar; drag = draw a loop region
   *  (shown live as a draft); release without moving = seek. Window-level
   *  listeners so the gesture survives re-renders (the Knob lesson). */
  function onRulerMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || clockSource === "ableton") return;
    const startX = e.clientX;
    const startBar = barFromClientX(startX);
    rulerDrag.current = { startBar, startX, moved: false };
    function move(ev: MouseEvent) {
      const d = rulerDrag.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientX - d.startX) > 4) d.moved = true;
      if (d.moved) {
        const bar = barFromClientX(ev.clientX);
        setRegionDraft({ a: Math.min(d.startBar, bar), b: Math.max(d.startBar, bar) });
      }
    }
    function up(ev: MouseEvent) {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const d = rulerDrag.current;
      rulerDrag.current = null;
      setRegionDraft(null);
      if (!d) return;
      const bar = barFromClientX(ev.clientX);
      if (d.moved && bar !== d.startBar) applyRegion(Math.min(d.startBar, bar), Math.max(d.startBar, bar));
      else seekBar(d.startBar);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /** Right-click on a block → selection-scoped palette at the cursor. */
  function openMenu(e: ReactMouseEvent, span: SectionSpan) {
    e.preventDefault();
    setSelectedSectionId(span.sectionId);
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 190),
      y: Math.min(e.clientY, window.innerHeight - 150),
      span,
    });
  }

  /** Edge-drag resize: the right edge resizes this section, the left edge
   *  the previous one (a boundary belongs to both). Window listeners
   *  survive the per-frame re-renders; the draft reflows the timeline live
   *  and commits ONCE on release. Right edge lands at the END of the
   *  pointed bar (+1); left edge at its START. */
  function onResizeStart(e: ReactMouseEvent, span: SectionSpan, side: "left" | "right") {
    e.preventDefault();
    e.stopPropagation();
    const sc = scrollRef.current;
    if (!sc) return;
    let target: SectionSpan;
    if (side === "left") {
      const i = spans.findIndex((s) => s.sectionId === span.sectionId && s.startBar === span.startBar);
      const prev = i > 0 ? spans[i - 1] : null;
      if (!prev || prev.sectionId === span.sectionId) return;
      target = prev;
    } else {
      target = span;
    }
    const t = target;
    function moveResize(ev: MouseEvent) {
      const bar = barFromClientX(ev.clientX, side === "right" ? Number.MAX_SAFE_INTEGER : undefined);
      const bars = side === "right" ? Math.max(1, bar - t.startBar + 1) : Math.max(1, bar - t.startBar);
      setResizeDraft({ sectionId: t.sectionId, bars });
    }
    function upResize() {
      window.removeEventListener("mousemove", moveResize);
      window.removeEventListener("mouseup", upResize);
      const draft = resizeRef.current;
      setResizeDraft(null);
      if (!draft || draft.sectionId !== t.sectionId) return;
      updateCurrentSong((s) => updateSection(s, draft.sectionId, (sec) => ({ ...sec, bars: draft.bars })));
    }
    window.addEventListener("mousemove", moveResize);
    window.addEventListener("mouseup", upResize);
  }

  const shownRegion = regionDraft ?? region;
  const menuIdx = menu ? song.sections.findIndex((x) => x.id === menu.span.sectionId) : -1;

  // Latest closures for the once-mounted hotkey listener.
  actionsRef.current = {
    space: () => {
      if (tick?.isPlaying) pauseSong();
      else void togglePlay();
    },
    zoomToSection: () => zoomToSection(),
    fit: fitZoom,
    loop: () => void toggleLoop(),
    zoom: stepZoom,
    escape: () => {
      setMenu(null);
      setResizeDraft(null);
      if (region != null) {
        setRegion(null);
        // Also release the transport's region loop — continue play normally.
        if (getSongTransport().getIsPlaying()) void resumeUnlooped(song);
      }
    },
  };

  return (
    <section
      className="shrink-0 border-b border-edge bg-panel"
      data-spine
      aria-label="Song spine"
      title={hint ?? "The Spine — click a section to target it, the ruler to seek; ←→ walks sections"}
    >
      {/* Compact control strip — icons only, meaning in the tooltips:
          transport (play · pause · stop · section loop) + undo/redo on the
          left, timeline view controls (zoom −/+, fit, follow) on the right.
          Since P2 this row IS the shell's collapsed header — the spine
          mounts above every song route and the legacy header transport is
          gone; no controls sit at the timeline's left or right ends. */}
      <div className="flex items-center gap-1 px-2 h-7 border-b border-edge/60">
        {/* Song chip — the identity (title · key · meter) moved here when
            the standalone header dissolved (user decision 2026-09-21:
            dissolve the top tabs, gain two rows). Click = dashboard. */}
        <button
          type="button"
          className="flex items-center gap-1.5 min-w-0 max-w-[260px] shrink group text-left"
          onClick={() => navigate("/")}
          title={`${song.title} — ${song.key} ${song.scale} · ${song.bpm} BPM${
            song.sections.length > 0 ? ` · ${classifySong(song).label}` : ""
          }\nClick to go back to the dashboard`}
        >
          <span className="text-inkMuted group-hover:text-ink text-sm shrink-0">←</span>
          <span className="truncate text-xs text-ink/90">{song.title}</span>
          <span className="hidden md:inline text-[9px] font-mono text-inkMuted/60 tabular-nums shrink-0">
            {song.key} {song.scale} · {song.bpm}
          </span>
        </button>
        <span className="w-px h-3.5 bg-edge/80 mx-1 shrink-0" />
        <IconBtn title="Play" disabled={tick?.isPlaying === true} onClick={() => void togglePlay()} icon="play" />
        <IconBtn title="Pause" disabled={tick?.isPlaying !== true} onClick={pausePlayback} icon="pause" />
        <IconBtn title="Stop — reset to the top" disabled={tick?.isPlaying !== true && !isPaused} onClick={stopPlayback} icon="stop" />
        <IconBtn
          title={loopOn ? "Looping this section — click to stop" : "Loop a section — the one playing, or the one selected on the spine"}
          disabled={clockSource === "ableton"}
          active={loopOn}
          onClick={() => void toggleLoop()}
          icon="loop"
        />
        <span className="w-px h-3.5 bg-edge/80 mx-1" />
        <IconBtn title="Undo" disabled={!canUndo} onClick={() => undo()} icon="undo" />
        <IconBtn title="Redo" disabled={!canRedo} onClick={() => redo()} icon="redo" />
        <span className="w-px h-3.5 bg-edge/80 mx-1" />
        <IconBtn
          title="Add a section at the end — it arrives selected with its ≣ form open (right-click any block to insert after it instead)"
          onClick={() => {
            const withNew = addSection(song, "verse");
            const fresh = withNew.sections[withNew.sections.length - 1];
            updateCurrentSong(() => withNew);
            setSelectedSectionId(fresh.id);
          }}
          icon="plus"
        />
        <span className="flex-1" />
        <IconBtn title={`Zoom out — fewer pixels per bar (now ${barPx}px)`} onClick={() => stepZoom(-1)} icon="minus" />
        <IconBtn title={`Zoom in — more pixels per bar (now ${barPx}px)`} onClick={() => stepZoom(1)} icon="plus" />
        <IconBtn title="Fit the whole song in view" onClick={fitZoom} icon="fit" />
        <IconBtn title="Zoom to the selected section — fills the view with it" onClick={zoomToSection} icon="frame" />
        <IconBtn
          title={follow ? "Following the playhead — click to stop" : "Follow the playhead while playing"}
          active={follow}
          onClick={toggleFollow}
          icon="follow"
        />
        <ThemeToggle compact />
      </div>

      {/* A blank song STILL gets its arrangement surface (user repro
          2026-09-21: "start a blank song and add sections" — the spine
          used to render NOTHING when empty, so a new song had no
          transport, no ruler, and no way to add anything; every view
          pointed back at the legacy Structure tab). The strip above
          stays live — undo of your first add matters — and these chips
          mint a section directly, each a miniature of the block it will
          create (role colour + label). Adding selects the new section,
          so the inspector engages and the section workspace follows. */}
      {spans.length === 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap px-3 py-2">
          <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted/60 mr-1 shrink-0">
            Empty arrangement — add the first section:
          </span>
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className="h-[22px] px-2 rounded-sm text-[10px] font-mono tracking-wide hover:brightness-125 active:brightness-90"
              style={{ background: roleStyle(r).bg, color: roleStyle(r).text }}
              title={`Add a ${roleStyle(r).label} section — starts at 8 bars · 4/4; name, bars and harmony live in the ≣ Section form`}
              onClick={() => {
                const withNew = addSection(song, r);
                const fresh = withNew.sections[withNew.sections.length - 1];
                updateCurrentSong(() => withNew);
                setSelectedSectionId(fresh.id);
              }}
            >
              ＋ {roleStyle(r).label}
            </button>
          ))}
        </div>
      ) : (
        /* The timeline — fixed scale, scrolls inside the full-bleed band.
           A song shorter than the viewport leaves an honest empty tail.
           overflow-x: SCROLL (not auto): the scrollbar strip's space stays
           reserved even when the song fits, so nothing jumps up/down by its
           height. (`scrollbar-gutter: stable` does not cover horizontal
           scrollbars in Chrome.) */
        <div ref={scrollRef} className="daw-scroll overflow-x-scroll overflow-y-hidden">
          <div className="relative h-[68px]" style={{ width: contentW }}>
            {/* Bar ruler — the coordinate system and the seek target. */}
            <div
              className="relative h-[18px] border-b border-edge/60 cursor-pointer select-none"
              onMouseDown={onRulerMouseDown}
              title="Click a bar to jump playback there · drag to draw a loop region (Esc clears)"
            >
              {/* Loop-region bracket (committed solid; draft while dragging) */}
              {shownRegion && (
                <div
                  className={`absolute top-0 h-[3px] pointer-events-none rounded-b-sm ${regionDraft ? "bg-accent/40" : "bg-accent/80"}`}
                  style={{
                    left: shownRegion.a * barPx,
                    width: (shownRegion.b - shownRegion.a + 1) * barPx,
                  }}
                />
              )}
              {Array.from({ length: total + 1 }, (_, i) => (
                <div key={i}>
                  <div
                    className="absolute bottom-0 w-px bg-inkMuted/25"
                    style={{ left: i * barPx, height: i % labelEvery === 0 ? 7 : 3 }}
                  />
                  {i % labelEvery === 0 && (
                    <span
                      className="absolute top-[1px] text-[8px] font-mono leading-none text-inkMuted/50 tabular-nums"
                      style={{ left: i * barPx + 3 }}
                    >
                      {i + 1}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Loop-region tint across the ruler + blocks */}
            {shownRegion && (
              <div
                className="absolute top-0 bottom-0 bg-accent/10 pointer-events-none z-[5]"
                style={{
                  left: shownRegion.a * barPx,
                  width: (shownRegion.b - shownRegion.a + 1) * barPx,
                }}
              />
            )}

            {/* Section blocks — true scale (width = bars × barPx), touching,
                border-separated. Labels and coverage dots only render when
                the block is wide enough to read them. */}
            <div className="relative flex h-[34px]">
              {spans.map((span, i) => {
                const prev = i > 0 ? spans[i - 1] : null;
                return (
                  <SpineBlock
                    key={`${span.sectionId}-${span.occurrenceIndex}-${i}`}
                    span={span}
                    song={song}
                    barPx={barPx}
                    selected={selectedSectionId === span.sectionId}
                    live={liveIndex === i}
                    onSelect={(e) => {
                      setSelectedSectionId(span.sectionId);
                      playGrow(e.currentTarget as HTMLElement, roleStyle(span.section.role).bg);
                    }}
                    onMenu={(e) => openMenu(e, span)}
                    onResize={(e, side) => onResizeStart(e, span, side)}
                    canResizeLeft={!!prev && prev.sectionId !== span.sectionId}
                    canResizeRight
                  />
                );
              })}
            </div>

            {/* Chords lane — the harmony element's ARRANGEMENT face (the
                two-faces law): the progression exactly as the section will
                PLAY it, aligned to the same bar axis. This lane deliberately
                runs THE shared resolver — `resolveChordOccurrences`, the same
                call midiExport / live MIDI out / the Ableton bridge make — not
                a naive one-pass of `section.chords`: the chord list is a
                repeating CELL, so a section longer than the cell loops it
                (the last pass truncated at the section end), and a section
                whose timing is outline-driven advances chords on the outline's
                onsets. Drawing the raw list here was the "dead air after the
                chords" bug: the lane disagreed with playback the moment a
                drag grew the section past one pass. Cells starting a NEW LAP
                of the cell get accent styling (tick cells: brighter fill;
                text cells: accent left border) so a wrap is visible at a
                glance. Width-aware: text cells once they fit, ticks below,
                nothing when even a tick wouldn't fit. Spacing stays authored
                (no bend-density re-timing) — at overview scale the bend's
                spacing delta is sub-pixel, and a stable lane is worth more
                than re-jiggling the map every time a Mix/Bend slider moves. */}
            <div className="relative h-[16px] border-t border-edge/50 overflow-hidden">
              {spans.map((span, i) => {
                const chords = span.section.chords;
                if (chords.length === 0) return null;
                const bpb = beatsPerBarOf(span);
                const endX = (span.startBar + span.bars) * barPx;
                const rawKey = span.section.key ?? song.key;
                const effKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
                const occs = resolveChordOccurrences(span.section, span.durationBeats);
                return occs.map((occ, oi) => {
                  const x = (span.startBar + occ.startTime / bpb) * barPx;
                  const w = Math.min((occ.duration / bpb) * barPx, endX - x);
                  if (w < 1.5) return null; // beyond even ticks — zoom in
                  const showText = w >= 11;
                  // Both loopChordsToFill and loopChordsOnOutline emit
                  // occurrences in strict chord order, so occurrence oi is
                  // chord oi % n — an index landing on 0 mid-list is a wrap.
                  const seam = oi > 0 && oi % chords.length === 0;
                  return (
                    <button
                      key={`${span.sectionId}-${span.occurrenceIndex}-${i}-${oi}`}
                      type="button"
                      className={`absolute top-0 bottom-0 truncate hover:bg-panelAlt/40 ${
                        showText
                          ? `border-l px-0.5 text-left text-[8px] font-mono leading-[16px] text-inkMuted/80 hover:text-ink ${
                              seam ? "border-accent/40" : "border-edge/40"
                            }`
                          : seam
                            ? "bg-accent/40"
                            : "bg-inkMuted/30"
                      }`}
                      style={{ left: x, width: showText ? w : Math.max(1.5, Math.min(2.5, w)) }}
                      title={`${occ.chord.romanNumeral} — ${chordDisplayName(pitchClass(occ.chord.root), occ.chord.quality, effKey)}`}
                      onClick={() => {
                        setSelectedSectionId(span.sectionId);
                        setSelectedChordId(occ.chord.id);
                        useInspectorStore.getState().engage("harmony");
                      }}
                    >
                      {showText ? occ.chord.romanNumeral : ""}
                    </button>
                  );
                });
              })}
            </div>

            {/* Playhead — spans the ruler and the blocks. */}
            {playheadPx != null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-20"
                style={{ left: playheadPx, boxShadow: "0 0 4px 1px #E8B54A" }}
              />
            )}
          </div>
        </div>
      )}

      {/* Context palette — right-click on a block (placement law tier 3:
          selection-scoped floats). Fixed-positioned so the timeline's
          overflow can't clip it. */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[170px] rounded border border-edge bg-panel shadow-lg py-1"
          style={{ left: menu.x, top: menu.y }}
        >
          <p className="px-2.5 py-0.5 text-3xs font-mono uppercase tracking-widest text-inkMuted/60 truncate">
            {menu.span.section.name}
          </p>
          <button
            className={MENU_ITEM}
            onClick={() => {
              const span = menu.span;
              setMenu(null);
              setRegion(null);
              void playSectionLoop(song, span.sectionId).then((ok) => {
                if (ok) setLoopOn(true);
              });
            }}
          >
            ⟳ Loop this section
          </button>
          <button
            className={MENU_ITEM}
            onClick={() => {
              const span = menu.span;
              setMenu(null);
              setSelectedSectionId(span.sectionId);
              zoomToSection(span.sectionId);
            }}
          >
            ↑↑ Zoom to section
          </button>
          <div className="my-1 border-t border-edge/60" />
          <button
            className={MENU_ITEM}
            onClick={() => {
              const span = menu.span;
              setMenu(null);
              const withNew = addSection(song, "verse");
              const fresh = withNew.sections[withNew.sections.length - 1];
              const at = song.sections.findIndex((x) => x.id === span.sectionId);
              updateCurrentSong(() => (at >= 0 ? reorderSections(withNew, withNew.sections.length - 1, at + 1) : withNew));
              setSelectedSectionId(fresh.id);
            }}
          >
            ＋ Insert section after
          </button>
          <button
            className={`${MENU_ITEM} disabled:opacity-30`}
            disabled={menuIdx <= 0}
            onClick={() => {
              const i = menuIdx;
              setMenu(null);
              updateCurrentSong((s) => reorderSections(s, i, i - 1));
            }}
          >
            ← Move left
          </button>
          <button
            className={`${MENU_ITEM} disabled:opacity-30`}
            disabled={menuIdx < 0 || menuIdx >= song.sections.length - 1}
            onClick={() => {
              const i = menuIdx;
              setMenu(null);
              updateCurrentSong((s) => reorderSections(s, i, i + 1));
            }}
          >
            → Move right
          </button>
          <button
            className="w-full text-left px-2.5 py-1 font-mono text-[11px] text-inkMuted/70 hover:text-danger hover:bg-panelAlt/60"
            onClick={async () => {
              const span = menu.span;
              setMenu(null);
              if (!(await askConfirm({ title: "Delete section", message: `Delete "${span.section.name}"?`, confirmLabel: "Delete", danger: true }))) return;
              updateCurrentSong((s) => removeSection(s, span.sectionId));
              if (selectedSectionId === span.sectionId) setSelectedSectionId(null);
            }}
          >
            ✕ Delete section
          </button>
          <div className="my-1 border-t border-edge/60" />
          <button
            className={MENU_ITEM}
            onClick={() => {
              setMenu(null);
              navigate(`/song/${id}/structure`);
            }}
          >
            Open in Structure…
          </button>
        </div>
      )}
    </section>
  );
}

/** The ladder's transition flourish (original brainstorm: "the clicked
 *  card grows into the Section workspace"): a translucent clone of the
 *  clicked block flies to the section workspace's header
 *  (`data-section-header`) — the sheet of paper leaving the arrangement
 *  and landing on the desk. Pure DOM, no state, self-cleaning; a no-op
 *  when the header isn't on the page (every view except the workbench,
 *  where the dive happens in place anyway) and under
 *  prefers-reduced-motion. */
function playGrow(fromEl: HTMLElement, bg: string) {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = document.querySelector("[data-section-header]") as HTMLElement | null;
    if (!target) return;
    const from = fromEl.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (to.width <= 0 || to.height <= 0 || from.width <= 0) return;
    const clone = document.createElement("div");
    clone.style.cssText = [
      "position:fixed",
      `left:${from.left}px`,
      `top:${from.top}px`,
      `width:${from.width}px`,
      `height:${from.height}px`,
      "border-radius:4px",
      `background:${bg}`,
      "opacity:0.85",
      "pointer-events:none",
      "z-index:60",
      "transition:left .22s ease,top .22s ease,width .22s ease,height .22s ease,opacity .22s ease",
    ].join(";");
    document.body.appendChild(clone);
    requestAnimationFrame(() => {
      clone.style.left = `${to.left}px`;
      clone.style.top = `${to.top}px`;
      clone.style.width = `${to.width}px`;
      clone.style.height = `${to.height}px`;
      clone.style.opacity = "0";
    });
    setTimeout(() => clone.remove(), 280);
  } catch {
    /* flourish only — never let it break selection */
  }
}

/** One section block. True-scale width (bars × barPx — no min-width floor,
 *  which would drift every later bar out of ruler alignment; zoom in for
 *  tiny sections instead). Role-colored like the arrangement timeline; the
 *  coverage dots read authored material at a glance (filled = authored,
 *  hollow = missing — "this bridge has no melody yet") and become
 *  clickable doorways in P3. */
function SpineBlock({
  span,
  song,
  barPx,
  selected,
  live,
  onSelect,
  onMenu,
  onResize,
  canResizeLeft = false,
  canResizeRight = false,
}: {
  span: SectionSpan;
  song: BlueprintSong;
  barPx: number;
  selected: boolean;
  live: boolean;
  onSelect: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onMenu: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onResize?: (e: ReactMouseEvent, side: "left" | "right") => void;
  canResizeLeft?: boolean;
  canResizeRight?: boolean;
}) {
  const style = roleStyle(span.section.role);
  const dots = coverageDots(span.section);
  const missing = dots.filter((d) => !d.present).map((d) => d.label);
  const w = Math.max(1, span.bars * barPx);
  const showName = w >= 40;
  const repeats = repeatsFor(song, span.sectionId);
  // The block's glance facts, disclosed as it widens: bars, then the
  // harmonic rhythm × plays, then the meter — "12b · 4×3 · 4/4"
  // (user's format, 2026-09-21 — this replaced the coverage dots row;
  // the coverage map lives on as the top-edge gauge instead).
  const barsLabel = `${Math.round(span.bars)}b`;
  const rhythmLabel = `${span.section.beatsPerChord}×${repeats}`;
  const tsLabel = `${span.section.timeSignatureNumerator}/${2 ** span.section.timeSignatureDenPower}`;
  const facts =
    w >= 96 ? `${barsLabel} · ${rhythmLabel} · ${tsLabel}` : w >= 64 ? `${barsLabel} · ${rhythmLabel}` : w >= 26 ? barsLabel : "";
  // Edge zones narrow with the block (30% per side, 1..5px): a fixed 5px
  // pair fully covered a 1-bar block at the default zoom — every click
  // landed on a resize zone, so the section could not be SELECTED (and
  // could not be deleted), and any grab near its middle hit an edge you
  // didn't mean. 30% keeps a centre window on even the smallest blocks.
  const edgeW = Math.min(5, Math.max(1, w * 0.3));
  return (
    <button
      type="button"
      className={`relative shrink-0 h-full flex flex-col justify-center items-start overflow-hidden text-left border-r border-black/25 ${[
        selected ? "ring-1 ring-accent ring-inset z-10" : "hover:brightness-110"
      ]}`}
      style={{ width: w, background: style.bg, color: style.text }}
      onClick={onSelect}
      onContextMenu={onMenu}
      title={`${span.section.name} — ${Math.round(span.bars)} bars${missing.length ? ` · missing: ${missing.join(", ")}` : " · all elements sketched"}`}
    >
      {/* Edge zones — drag to resize (window-level gesture, see Spine) */}
      {onResize && (
        <>
          {canResizeLeft && (
            <span
              className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-20 hover:bg-accent/30"
              style={{ width: edgeW }}
              onMouseDown={(e) => onResize(e, "left")}
              title="Drag to move this boundary — the previous section grows/shrinks"
            />
          )}
          {canResizeRight && (
            <span
              className="absolute right-0 top-0 bottom-0 cursor-ew-resize z-20 hover:bg-accent/30"
              style={{ width: edgeW }}
              onMouseDown={(e) => onResize(e, "right")}
              title="Drag to resize this section"
            />
          )}
        </>
      )}
      {/* Coverage gauge — the authored-material map as a cue IN the block:
          four segments along the top edge, one per element in
          coverageDots order (chords · drums · melody · lyrics), lit when
          authored. 2px of edge instead of a text row (user, 2026-09-21);
          the block's own tooltip still names what's missing. */}
      <span className="absolute top-0 inset-x-0 h-[2px] flex pointer-events-none">
        {dots.map((d) => (
          <span key={d.label} className={`flex-1 ${d.present ? "bg-current opacity-60" : "bg-current opacity-15"}`} />
        ))}
      </span>
      <span className="w-full truncate px-1.5 text-[10px] leading-tight font-medium">
        {showName ? span.section.name : ""}
        {showName && span.variation ? <span className="opacity-60"> ({span.variation})</span> : null}
      </span>
      {facts && (
        <span
          className="px-1.5 mt-0.5 text-[9px] font-mono opacity-70 tabular-nums truncate"
          title={`${span.section.beatsPerChord} beats per chord · plays ×${repeats} · ${tsLabel} meter`}
        >
          {facts}
        </span>
      )}
      {live && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent opacity-80" title="Now playing" />}
    </button>
  );
}

/** Authored-material presence for a section — the spine's coverage map,
 *  rendered as the block's top-edge gauge. "Authored" is deliberately
 *  literal: an inferred/auto groove doesn't count as drums you've placed,
 *  a genre recipe doesn't count as chords. */
function coverageDots(section: BlueprintSection): { label: string; present: boolean }[] {
  const drums =
    section.drumPattern != null && section.drumPattern !== "none"
      ? true
      : !!section.drumMeterOutline || (section.drumBlocks?.length ?? 0) > 0;
  return [
    { label: "chords", present: section.chords.length > 0 },
    { label: "drums", present: drums },
    { label: "melody", present: (section.melody?.notes?.length ?? 0) > 0 },
    { label: "lyrics", present: !!section.lyrics?.trim() },
  ];
}

/** Re-export so the workbench can render the ribbon later without a second
 *  import path. */
export type { SectionSpan };
