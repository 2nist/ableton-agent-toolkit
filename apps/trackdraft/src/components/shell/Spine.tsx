import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { addSection, reorderSections, updateSection } from "../../lib/sections";
import { NOTE_TO_PC, pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { resolveChordOccurrences } from "@drum/library";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import IconBtn from "../common/IconBtn";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { pauseSong, playLoopRegion, playSectionLoop, playSong, resumeUnlooped, seekTo, stopSong } from "../../lib/playback/transportControl";
import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { beatsPerBar, type BlueprintSection, type BlueprintSong } from "../../types/blueprint";

/** Zoom presets in px per BAR. Bar-linear on purpose: every bar is the
 *  same width — 7/8 bars included — because the bars are the axis (a
 *  time-linear scale would make odd-meter bars narrower than their
 *  neighbours and break "this section is an 8, that one's a 16"). The
 *  blocks-view lesson applies: zoom must be able to GROW — the ladder runs
 *  4→80 with 10 the default; the mouse wheel and − / + walk it. */
const BAR_PX_STEPS = [4, 6, 8, 10, 14, 20, 28, 40, 56, 80] as const;

/** Rows for the block context palette (placement law tier 3:
 *  selection-scoped floats — the drums selection control is the first
 *  citizen, this is the second). */
const MENU_ITEM =
  "w-full text-left px-2.5 py-1 font-mono text-[11px] text-inkMuted hover:text-ink hover:bg-panelAlt/60";

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
  const clockSource = useSongStore((s) => s.clockSource);
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const [tick, setTick] = useState<TransportTick | null>(null);
  const [barPx, setBarPx] = useState<number>(10);
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

  if (spans.length === 0) return null;

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

  /** Bar index for a client X position, clamped to the song. */
  function barFromClientX(clientX: number, el: HTMLElement): number {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(total, Math.floor((clientX - rect.left) / barPx)));
  }

  /** Seek to a bar (bar-quantized) — the ruler's plain-click gesture.
   *  Playing keeps playing from there; paused/stopped auditions from there.
   *  No-op under the Ableton clock (Live is the master). */
  function seekBar(bar: number) {
    const span = spans.find((s) => bar >= s.startBar && bar < s.startBar + s.bars);
    if (!span) return;
    setRegion(null); // a plain seek is not the region loop
    const beat = span.startBeat + (bar - span.startBar) * beatsPerBar(span.section);
    void seekTo(song, clockSource, beat);
  }

  /** Draw-loop the bars a..b (inclusive): bar b ends where bar b+1 begins. */
  function applyRegion(a: number, b: number) {
    const startSpan = spans.find((s) => a >= s.startBar && a < s.startBar + s.bars);
    const endSpan = spans.find((s) => b >= s.startBar && b < s.startBar + s.bars);
    if (!startSpan || !endSpan) return;
    const startBeat = startSpan.startBeat + (a - startSpan.startBar) * beatsPerBar(startSpan.section);
    const endBeat = endSpan.startBeat + (b + 1 - endSpan.startBar) * beatsPerBar(endSpan.section);
    setRegion({ a, b });
    setLoopOn(false);
    void playLoopRegion(song, startBeat, endBeat);
  }

  /** Ruler gesture: press = remember the bar; drag = draw a loop region
   *  (shown live as a draft); release without moving = seek. Window-level
   *  listeners so the gesture survives re-renders (the Knob lesson). */
  function onRulerMouseDown(e: ReactMouseEvent<HTMLDivElement>) {
    if (e.button !== 0 || clockSource === "ableton") return;
    const el = e.currentTarget;
    const startX = e.clientX;
    const startBar = barFromClientX(startX, el);
    rulerDrag.current = { startBar, startX, moved: false };
    function move(ev: MouseEvent) {
      const d = rulerDrag.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientX - d.startX) > 4) d.moved = true;
      if (d.moved) {
        const bar = barFromClientX(ev.clientX, el);
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
      const bar = barFromClientX(ev.clientX, el);
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
      if (!sc) return;
      const bar = barFromClientX(ev.clientX, sc);
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
          This row is the seed of P2's collapsed header — no controls sit at
          the timeline's left or right ends. */}
      <div className="flex items-center gap-1 px-2 h-7 border-b border-edge/60">
        <IconBtn title="Play" disabled={tick?.isPlaying === true} onClick={() => void togglePlay()}>
          ▶
        </IconBtn>
        <IconBtn title="Pause" disabled={tick?.isPlaying !== true} onClick={pausePlayback}>
          ❚❚
        </IconBtn>
        <IconBtn title="Stop — reset to the top" disabled={tick?.isPlaying !== true && !isPaused} onClick={stopPlayback}>
          ■
        </IconBtn>
        <IconBtn
          title={loopOn ? "Looping this section — click to stop" : "Loop a section — the one playing, or the one selected on the spine"}
          disabled={clockSource === "ableton"}
          active={loopOn}
          onClick={() => void toggleLoop()}
        >
          ⟳
        </IconBtn>
        <span className="w-px h-3.5 bg-edge/80 mx-1" />
        <IconBtn title="Undo" disabled={!canUndo} onClick={() => undo()}>
          ↶
        </IconBtn>
        <IconBtn title="Redo" disabled={!canRedo} onClick={() => redo()}>
          ↷
        </IconBtn>
        <span className="flex-1" />
        <IconBtn title={`Zoom out — fewer pixels per bar (now ${barPx}px)`} onClick={() => stepZoom(-1)}>
          −
        </IconBtn>
        <IconBtn title={`Zoom in — more pixels per bar (now ${barPx}px)`} onClick={() => stepZoom(1)}>
          +
        </IconBtn>
        <IconBtn title="Fit the whole song in view" onClick={fitZoom}>
          {"><"}
        </IconBtn>
        <IconBtn title="Zoom to the selected section — fills the view with it" onClick={zoomToSection}>
          ↑↑
        </IconBtn>
        <IconBtn
          title={follow ? "Following the playhead — click to stop" : "Follow the playhead while playing"}
          active={follow}
          onClick={toggleFollow}
        >
          |→
        </IconBtn>
      </div>

      {/* The timeline — fixed scale, scrolls inside the full-bleed band.
          A song shorter than the viewport leaves an honest empty tail.
          overflow-x: SCROLL (not auto): the scrollbar strip's space stays
          reserved even when the song fits, so nothing jumps up/down by its
          height. (`scrollbar-gutter: stable` does not cover horizontal
          scrollbars in Chrome.) */}
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
                    onSelect={() => setSelectedSectionId(span.sectionId)}
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
                const bpb = beatsPerBar(span.section);
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
                      onClick={() => setSelectedSectionId(span.sectionId)}
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
  onSelect: () => void;
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
  const showBars = w >= 24;
  const showDots = w >= 56;
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
              className="absolute left-0 top-0 bottom-0 w-[5px] cursor-ew-resize z-20 hover:bg-accent/30"
              onMouseDown={(e) => onResize(e, "left")}
              title="Drag to resize the previous section"
            />
          )}
          {canResizeRight && (
            <span
              className="absolute right-0 top-0 bottom-0 w-[5px] cursor-ew-resize z-20 hover:bg-accent/30"
              onMouseDown={(e) => onResize(e, "right")}
              title="Drag to resize this section"
            />
          )}
        </>
      )}
      <span className="w-full truncate px-1.5 text-[10px] leading-tight font-medium">
        {showName ? span.section.name : ""}
        {showName && span.variation ? <span className="opacity-60"> ({span.variation})</span> : null}
      </span>
      {(showBars || showDots) && (
        <span className="flex items-center gap-1 px-1.5 mt-0.5">
          {showBars && <span className="text-[9px] font-mono opacity-70 tabular-nums">{Math.round(span.bars)}b</span>}
          {showDots &&
            dots.map((d) => (
              <span
                key={d.label}
                className={`w-1.5 h-1.5 rounded-full ${d.present ? "bg-current opacity-70" : "border border-current opacity-40"}`}
                title={`${d.label}: ${d.present ? "authored" : "not yet"}`}
              />
            ))}
        </span>
      )}
      {live && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent opacity-80" title="Now playing" />}
    </button>
  );
}

/** Authored-material presence for a section — the spine's coverage map.
 *  "Authored" is deliberately literal: an inferred/auto groove doesn't
 *  count as drums you've placed, a genre recipe doesn't count as chords. */
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
