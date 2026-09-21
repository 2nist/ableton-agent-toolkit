import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { seekTo } from "../../lib/playback/transportControl";
import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { beatsPerBar, type BlueprintSection, type BlueprintSong } from "../../types/blueprint";

/** Zoom presets in px per BAR. Bar-linear on purpose: every bar is the
 *  same width — 7/8 bars included — because the bars are the axis (a
 *  time-linear scale would make odd-meter bars narrower than their
 *  neighbours and break "this section is an 8, that one's a 16"). The
 *  blocks-view lesson applies: zoom must be able to GROW, so 20 is the top
 *  step and 10 the default. */
const BAR_PX_STEPS = [6, 10, 14, 20] as const;

/** The controls-gutter button style — tiny, mono, quiet. */
const GUTTER_BTN = "text-[9px] font-mono text-inkMuted hover:text-ink border border-edge rounded px-1 py-0.5 leading-none";

/**
 * The Spine — the workspace's full-width top band (docs/design/workspace.md §2).
 *
 * Timeline v2 (user-specified 2026-09-21): fixed scale (px per BAR, default
 * 10), horizontally scrollable inside the full-bleed band, a bar ruler on
 * top that doubles as the seek control, a pixel-exact playhead with
 * auto-follow while playing, and zoom (6/10/14/20 + fit) in a left gutter
 * that never scrolls or covers the ruler. Blocks are TRUE scale — a short
 * song leaves an honest empty tail, it is never stretched to fit.
 *
 * Selection is the same `studioSelectionStore.selectedSectionId` the
 * arrangement timeline and the Mix/Bend panel already share, so the spine
 * re-targets them for free.
 */
export default function Spine({ song, hint }: { song: BlueprintSong; hint?: string }) {
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const clockSource = useSongStore((s) => s.clockSource);
  const [tick, setTick] = useState<TransportTick | null>(null);
  const [barPx, setBarPx] = useState<number>(10);
  /** Auto-follow the playhead while playing; drops off on manual scroll. */
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => getSongTransport().onTick(setTick), []);

  const spans = useMemo(() => sectionSpans(song), [song]);
  const total = useMemo(() => totalBars(spans), [spans]);
  const liveIndex =
    tick?.isPlaying && tick.sectionIndex >= 0 && tick.sectionIndex < spans.length ? tick.sectionIndex : null;

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

  /** Ruler click = seek to that bar (bar-quantized). Playing keeps playing
   *  from there; paused/stopped starts from there — an audition gesture.
   *  No-op under the Ableton clock (Live is the master). */
  function onRulerClick(e: ReactMouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const bar = Math.min(total, Math.floor(Math.max(0, e.clientX - rect.left) / barPx));
    const span = spans.find((s) => bar >= s.startBar && bar < s.startBar + s.bars);
    if (!span) return;
    const beat = span.startBeat + (bar - span.startBar) * beatsPerBar(span.section);
    void seekTo(song, clockSource, beat);
  }

  return (
    <section
      className="shrink-0 border-b border-edge bg-panel"
      aria-label="Song spine"
      title={hint ?? "The Spine — click a section to target it, the ruler to seek; ←→ walks sections"}
    >
      <div className="flex items-stretch h-[52px]">
        {/* Controls gutter — zoom · fit · follow. Outside the scroll area:
            it never covers the ruler and never scrolls away. */}
        <div className="shrink-0 w-[84px] border-r border-edge flex flex-col items-center justify-center gap-1">
          <div className="flex items-center gap-0.5">
            <button type="button" className={GUTTER_BTN} onClick={() => stepZoom(-1)} title="Zoom out — fewer pixels per bar">
              −
            </button>
            <span className="w-9 text-center text-[9px] font-mono text-inkMuted tabular-nums" title="Scale — pixels per bar">
              {barPx}px
            </span>
            <button type="button" className={GUTTER_BTN} onClick={() => stepZoom(1)} title="Zoom in — more pixels per bar">
              +
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className={GUTTER_BTN} onClick={fitZoom} title="Fit the whole song in view">
              fit
            </button>
            <button
              type="button"
              className={`${GUTTER_BTN} ${follow ? "border-accent/60 text-accent" : ""}`}
              onClick={toggleFollow}
              title={follow ? "Following the playhead — click to stop following" : "Follow the playhead while playing"}
            >
              follow
            </button>
          </div>
        </div>

        {/* The timeline — fixed scale, scrolls inside the full-bleed band.
            A song shorter than the viewport leaves an honest empty tail. */}
        <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden" onWheel={() => setFollow(false)}>
          <div className="relative h-full" style={{ width: contentW }}>
            {/* Bar ruler — the coordinate system and the seek target. */}
            <div
              className="relative h-[18px] border-b border-edge/60 cursor-pointer select-none"
              onClick={onRulerClick}
              title="Click a bar to jump playback there"
            >
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

            {/* Section blocks — true scale (width = bars × barPx), touching,
                border-separated. Labels and coverage dots only render when
                the block is wide enough to read them. */}
            <div className="relative flex h-[34px]">
              {spans.map((span, i) => (
                <SpineBlock
                  key={`${span.sectionId}-${span.occurrenceIndex}-${i}`}
                  span={span}
                  song={song}
                  barPx={barPx}
                  selected={selectedSectionId === span.sectionId}
                  live={liveIndex === i}
                  onSelect={() => setSelectedSectionId(span.sectionId)}
                />
              ))}
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
      </div>
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
}: {
  span: SectionSpan;
  song: BlueprintSong;
  barPx: number;
  selected: boolean;
  live: boolean;
  onSelect: () => void;
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
      title={`${span.section.name} — ${Math.round(span.bars)} bars${missing.length ? ` · missing: ${missing.join(", ")}` : " · all elements sketched"}`}
    >
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
