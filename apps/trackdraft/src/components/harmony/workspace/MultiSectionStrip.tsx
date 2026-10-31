import { useEffect, useMemo, useRef, useState } from "react";
import { meanBeatsPerBar, type BlueprintSection, type BlueprintSong } from "../../../types/blueprint";
import { analyzeSection } from "../../../lib/harmony/analysis";
import { floorBars } from "../../../lib/harmony/floorLayout";
import { stripLayout } from "../../../lib/harmony/stripLayout";
import { repeatsFor } from "../../../lib/sections";
import { sectionSpans } from "../../../lib/arrangement";
import ComposeDesk from "./ComposeDesk";
import type { HarmonyDeskBandProps } from "./types";

/**
 * Several sections on one bar grid, left to right — the harmony answer to the
 * drums view's combined canvas.
 *
 * Why it exists: a progression is judged by what it does *into* the next one.
 * One section at a time hides every transition, which is the whole question
 * when you are deciding whether a chorus earns the verse before it.
 *
 * Every band is a real `ComposeDesk`, so editing is not a second
 * implementation: drag a chord, place one from the ladder, sweep a bar range,
 * split, transpose — exactly as in the single-section view, scoped to the band
 * you touched. Bands are forced to show all their bars, because a band that
 * pages its own window can't share a grid with its neighbour.
 *
 * Bands render `compact`: the floor and its header, no toolbar and no foot
 * band. In a 200px band the full toolbar wrapped into itself and the foot band
 * covered a third of the plate, so thirty bands' worth of chrome was competing
 * with the one thing the strip exists to show. Per-section tools live in the
 * focused section — clicking a band's name switches to it.
 *
 * Not supported (and not pretended otherwise): dragging a chord *between*
 * bands. That is a section edit, not a chord edit, and it belongs with the
 * split/merge verbs.
 */
export default function MultiSectionStrip({
  song,
  bands,
  activeSectionId,
  onFocus,
}: {
  song: BlueprintSong;
  /** One entry per selected section, in song order, with its props already
   *  built for that section. */
  bands: { section: BlueprintSection; props: HarmonyDeskBandProps }[];
  activeSectionId: string | null;
  onFocus: (sectionId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setWidth(host.clientWidth || 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Widths come from the bars the FLOOR will draw, not the authored `bars`:
  // the floor pads a short section out to two bars of drop room, and a band
  // sized for 1 bar that renders 2 would break the shared grid.
  const layout = useMemo(
    () =>
      stripLayout(
        bands.map((band) => ({
          id: band.section.id,
          bars: floorBars(band.section.chords, band.section),
        })),
        width,
      ),
    [bands, width],
  );
  const byId = useMemo(
    () => new Map(bands.map((band) => [band.section.id, band])),
    [bands],
  );
  /** The song's own bar number where each section starts — taken from the
   *  spans, so a band reads "bar 8" rather than restarting at 1 (and a
   *  non-adjacent selection doesn't imply a continuity the song lacks). */
  const barOffsets = useMemo(() => {
    const offsets = new Map<string, number>();
    for (const span of sectionSpans(song)) {
      if (!offsets.has(span.sectionId)) offsets.set(span.sectionId, span.startBar);
    }
    return offsets;
  }, [song]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-inkMuted/70">
        <span className="rounded border border-edge px-1.5 py-0.5 text-accent">
          {bands.length} sections · one grid
        </span>
        <span>
          {layout.totalBars} bars · {layout.pxPerBar.toFixed(0)} px/bar
        </span>
        <span className="text-inkMuted/50">
          edits apply to the band you touch · click a section name to focus it
        </span>
        {layout.contentWidth > width + 1 && (
          <span className="ml-auto text-inkMuted/50">scroll →</span>
        )}
      </div>

      <div ref={hostRef} className="overflow-x-auto rounded border border-edge bg-deep/40">
        <div className="flex items-stretch" style={{ minWidth: layout.contentWidth }}>
          {layout.bands.map((band, index) => {
            const entry = byId.get(band.id);
            if (!entry) return null;
            const section = entry.section;
            const meter = `${
              section.drumMeterOutline
                ? "drums"
                : `${section.timeSignatureNumerator}/${2 ** section.timeSignatureDenPower}`
            }`;
            const focused = section.id === activeSectionId;
            return (
              <div
                key={band.id}
                style={{ width: band.widthPx }}
                className={`shrink-0 ${index > 0 ? "border-l border-edge" : ""} ${
                  focused ? "bg-panel/40" : ""
                }`}
                data-strip-band={band.id}
              >
                <button
                  type="button"
                  onClick={() => onFocus(section.id)}
                  title={
                    focused
                      ? "This band is the focused section"
                      : "Focus this section (the dock and the other desks follow it)"
                  }
                  className={`flex w-full items-center gap-1.5 border-b px-1.5 py-1 text-left font-mono text-[9px] ${
                    focused
                      ? "border-accent/50 bg-accent/10 text-accent"
                      : "border-edge/60 text-inkMuted hover:bg-panelAlt/40 hover:text-ink"
                  }`}
                >
                  <span className="truncate font-semibold uppercase tracking-[0.1em]">
                    {section.name || "Untitled"}
                  </span>
                  <span className="ml-auto shrink-0 text-inkMuted/60">
                    {Math.round(section.bars)}b · {meter} · ×{repeatsFor(song, section.id)}
                  </span>
                </button>
                <BandDesk
                  section={section}
                  props={entry.props}
                  barOffset={barOffsets.get(section.id) ?? 0}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One band's desk. Owns its own analysis, memoised on the section object —
 *  the store replaces the object only when that section actually changed, so a
 *  strip of eight sections re-analyses one band, not eight, on every edit. */
function BandDesk({
  section,
  props,
  barOffset,
}: {
  section: BlueprintSection;
  props: HarmonyDeskBandProps;
  barOffset: number;
}) {
  const beatsPerBar = Math.max(1, meanBeatsPerBar(section));
  const analysis = useMemo(
    () =>
      analyzeSection(section.chords, {
        key: props.keyName,
        scale: props.scale,
        regions: props.regions,
        beatsPerBar,
      }),
    [section.chords, props.keyName, props.scale, props.regions, beatsPerBar],
  );
  return (
    <ComposeDesk
      {...props}
      analysis={analysis}
      barsPerView="all"
      barOffset={barOffset}
      compact
    />
  );
}
