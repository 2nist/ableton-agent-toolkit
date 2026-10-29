import { useMemo } from "react";
import { noteName, pitchClass } from "@music-theory/core";
import type { BlueprintSong, Chord } from "../../../types/blueprint";
import { eventLabel, type HarmonyEvent } from "../../../lib/harmony/analysis";
import {
  layoutChart,
  positionInChart,
  type ChartBar,
} from "../../../lib/harmony/chartLayout";
import type { HarmonyDisplay } from "../../../store/harmonyWorkspaceStore";

/** Cuts the symbol down when the player asked for triads only. */
function simplifyName(name: string): string {
  return name.replace(/(maj7|m7♭5|7♭5|m7|7|°|sus4)$/u, "");
}

/**
 * The chart a player puts on the stand: the whole tune, four bars to a line,
 * section letters in the margin, repeat brackets with their count, `%` where
 * a bar repeats the one before it, and a cursor that follows the transport.
 *
 * Read-only by design — Rehearse never edits the song, and this is the reason
 * the desk exists. Everything positional comes from `layoutChart`, so the
 * layout itself is tested without a DOM.
 */
export default function StudioChart({
  song,
  display,
  keyName,
  scale,
  activeBeat,
  focusedSectionId,
  onFocusSection,
  barsPerSystem = 4,
  beats = true,
}: {
  song: BlueprintSong;
  display: HarmonyDisplay;
  keyName: BlueprintSong["key"];
  scale: BlueprintSong["scale"];
  /** Song-relative transport beat while playing, or the focused section's
   *  first beat when not. Null hides the cursor. */
  activeBeat: number | null;
  focusedSectionId: string | null;
  onFocusSection: (sectionId: string) => void;
  /** Bars per line — four is the convention, eight fits a wide screen. */
  barsPerSystem?: number;
  /** Draw one column per beat, with slashes where a chord is held. */
  beats?: boolean;
}) {
  /** Capo is subtracted: the player's shapes sit `capo` semitones below the
   *  sounding key, which is the whole point of a capo. */
  const shapeShift = display.transpose - display.capo;
  const shapeKey =
    shapeShift === 0
      ? keyName
      : noteName((pitchClass(keyName) + shapeShift + 12) % 12, keyName);

  const sections = useMemo(() => {
    const label = (event: HarmonyEvent | null) =>
      event
        ? eventLabel(event, {
            nashville: display.nashville,
            simplify: display.simplify,
          })
        : "—";
    const absolute = (chord: Chord, event: HarmonyEvent | null) => {
      const name = event?.absoluteName ?? chord.root;
      return display.simplify ? simplifyName(name) : name;
    };
    return layoutChart(song, {
      keyName: shapeKey,
      scale,
      transpose: shapeShift,
      label,
      absolute,
      barsPerSystem,
    });
  }, [
    song,
    shapeKey,
    shapeShift,
    scale,
    display.simplify,
    display.nashville,
    barsPerSystem,
  ]);

  const position = useMemo(
    () => (activeBeat === null ? null : positionInChart(sections, activeBeat)),
    [sections, activeBeat],
  );

  const soundingKey =
    display.transpose === 0
      ? keyName
      : noteName((pitchClass(keyName) + display.transpose + 12) % 12, keyName);
  const totalBars = sections.reduce(
    (sum, entry) => sum + entry.bars * entry.repeats,
    0,
  );

  return (
    <div className="studio-chart rounded border border-edge bg-panel">
      {/* The header a chart carries: what tune, what key, what tempo. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge px-3 py-2">
        <span className="hand-value text-xl leading-none text-ink">
          {song.title}
        </span>
        {song.artist && !/^unknown$/i.test(song.artist) && (
          <span className="font-mono text-[10px] text-inkMuted">
            {song.artist}
          </span>
        )}
        <span className="font-mono text-[10px] text-inkMuted/70">
          {soundingKey} {scale} · {song.bpm} bpm · {song.timeSignatureNumerator}
          /{song.timeSignatureDenominator}
        </span>
        <span className="ml-auto font-mono text-[9px] text-inkMuted/60">
          {sections.length} sections · {totalBars} bars
          {display.capo > 0 ? ` · capo ${display.capo}` : ""}
        </span>
      </div>

      <div className="px-2 py-2">
        {sections.map((entry) => {
          const here = entry.sectionId === focusedSectionId;
          return (
            <div
              key={`${entry.entryIndex}-${entry.sectionId}`}
              className="mb-1.5 last:mb-0"
            >
              <div className="flex items-baseline gap-2 px-1">
                <button
                  type="button"
                  onClick={() => onFocusSection(entry.sectionId)}
                  title={`Focus ${entry.name}'s section in the other desks`}
                  className={`rounded px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${
                    here
                      ? "bg-accent/15 text-accent"
                      : "text-inkMuted hover:text-ink"
                  }`}
                >
                  {entry.letter}
                </button>
                <span className="hand-value text-[13px] leading-none text-ink">
                  {entry.name}
                </span>
                <span className="font-mono text-[9px] text-inkMuted/60">
                  {entry.bars} bars
                  {entry.repeats > 1 ? ` · ×${entry.repeats}` : ""}
                  {entry.returns ? " · returns" : ""}
                </span>
                {entry.repeats > 1 && (
                  <span
                    className="font-mono text-[11px] text-inkMuted"
                    title={`Repeat this section ${entry.repeats} times — written as a bracket, not printed ${entry.repeats} times`}
                  >
                    𝄆 𝄇
                  </span>
                )}
              </div>

              <div
                className={
                  entry.repeats > 1 ? "border-x-2 border-accent/40 px-0.5" : ""
                }
              >
                {entry.systems.map((system, systemIndex) => (
                  <div key={systemIndex} className="flex items-stretch">
                    <span className="w-6 shrink-0 pt-1 text-right font-mono text-[8px] text-inkMuted/50">
                      {system.bars[0]?.number}
                    </span>
                    <div
                      className="chart-grid grid min-w-0 flex-1 border-t border-b border-edge/60"
                      style={{
                        gridTemplateColumns: `repeat(${barsPerSystem}, minmax(0, 1fr))`,
                      }}
                    >
                      {system.bars.map((bar, barIndex) => {
                        const current =
                          position !== null &&
                          position.barNumber === bar.number;
                        const endsSystem = barIndex === system.bars.length - 1;
                        return (
                          <ChartCell
                            key={bar.number}
                            bar={bar}
                            beats={beats}
                            compact={barsPerSystem > 4}
                            current={current}
                            endsSystem={endsSystem}
                            endsChart={
                              endsSystem &&
                              entry.entryIndex ===
                                sections[sections.length - 1]?.entryIndex
                            }
                            onSelect={() => onFocusSection(entry.sectionId)}
                          />
                        );
                      })}
                      {Array.from({
                        length: barsPerSystem - system.bars.length,
                      }).map((_, index) => (
                        <span key={`pad-${index}`} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type BeatItem = {
  col: number;
  span: number;
  chord?: ChartBar["chords"][number];
};

/** Split a bar into beat columns: the chord on each beat it starts, and a
 *  slash for every beat it is still sounding through. That is what makes a
 *  chart readable at tempo — the eye counts beats, not boxes. */
function beatItems(bar: ChartBar, compact: boolean): BeatItem[] {
  const columns = Math.max(1, Math.round(bar.beats));
  const byColumn = new Map<number, ChartBar["chords"][number]>();
  for (const chord of bar.chords)
    byColumn.set(Math.max(0, chord.beat - 1), chord);

  const items: BeatItem[] = [];
  let column = 0;
  while (column < columns) {
    const chord = byColumn.get(column);
    const nextChange =
      [...byColumn.keys()]
        .filter((beat) => beat > column)
        .sort((a, b) => a - b)[0] ?? columns;
    if (chord) {
      // A symbol hangs over the beats it holds — up to three columns for a
      // chord that owns the bar, two otherwise — but never across the beat
      // where the next chord starts.
      // A wide line (four bars) has room for the symbol in its own column and
      // the slashes evenly after it; a packed line (eight bars) lets the
      // symbol hang over the beats it holds so it is never clipped.
      const room = Math.min(nextChange - column, columns - column);
      const span = compact
        ? Math.max(1, Math.min(room, Math.round(chord.beats) >= 4 ? 3 : 2))
        : 1;
      items.push({ col: column, span, chord });
      column += span;
    } else {
      items.push({ col: column, span: 1 });
      column += 1;
    }
  }
  return items;
}

function ChartCell({
  bar,
  beats,
  compact,
  current,
  endsSystem,
  endsChart,
  onSelect,
}: {
  bar: ChartBar;
  beats: boolean;
  compact: boolean;
  current: boolean;
  /** Last bar of its line: the system closes with a barline. */
  endsSystem: boolean;
  /** Last bar of the tune: a double barline, as a chart ends. */
  endsChart: boolean;
  onSelect: () => void;
}) {
  const columns = Math.max(1, Math.round(bar.beats));
  const items = beats ? beatItems(bar, compact) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`Bar ${bar.number}${bar.meter ? ` · ${bar.meter}` : ""}`}
      className={`relative min-h-[42px] border-l border-edge/60 py-1 pl-0.5 text-left transition-colors print:border-edge ${
        endsChart
          ? "border-r-[3px] border-double border-ink/70"
          : endsSystem
            ? "border-r border-edge/60"
            : ""
      } ${current ? "bg-accent/15 ring-1 ring-inset ring-accent" : "hover:bg-panelAlt/60"}`}
    >
      {bar.meter && (
        <span className="absolute right-1 top-0 font-mono text-[8px] font-semibold text-inkMuted">
          {bar.meter}
        </span>
      )}
      {items ? (
        <span
          className="grid h-full items-baseline"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {items.map((item, index) =>
            item.chord ? (
              <span
                key={`c-${index}`}
                className="flex min-w-0 flex-col justify-center pl-1"
                style={{ gridColumn: `${item.col + 1} / span ${item.span}` }}
                title={`${item.chord.absolute} — beat ${item.chord.beat}`}
              >
                <b
                  className={`whitespace-nowrap font-mono text-[13px] font-semibold leading-none ${
                    item.chord.carried || bar.sustained
                      ? "text-inkMuted/75"
                      : "text-ink"
                  }`}
                >
                  {bar.repeatsPrevious && index === 0
                    ? "%"
                    : item.chord.absolute}
                </b>
                <span className="whitespace-nowrap text-[8px] leading-none text-accent/90">
                  {item.chord.label}
                </span>
              </span>
            ) : (
              <span
                key={`s-${index}`}
                className="text-center font-mono text-[10px] text-inkMuted/50"
                style={{ gridColumn: item.col + 1 }}
              >
                /
              </span>
            ),
          )}
        </span>
      ) : (
        <span className="flex flex-wrap items-baseline gap-x-1.5 pl-1">
          {bar.repeatsPrevious ? (
            <span className="font-mono text-[13px] leading-none text-inkMuted">
              %
            </span>
          ) : (
            bar.chords.map((chord, index) => (
              <span
                key={`${chord.absolute}-${index}`}
                className="flex items-baseline gap-1"
              >
                <b
                  className={`font-mono text-[13px] font-semibold leading-none ${bar.sustained ? "text-inkMuted/70" : "text-ink"}`}
                >
                  {chord.absolute}
                </b>
                <span className="text-[8px] leading-none text-accent/90">
                  {chord.label}
                </span>
              </span>
            ))
          )}
        </span>
      )}
    </button>
  );
}
