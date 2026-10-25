import { useState, type ReactNode } from "react";
import { noteName, pitchClass } from "@music-theory/core";
import { sectionDurationBeats } from "../../../types/blueprint";
import { useHarmonyWorkspaceStore } from "../../../store/harmonyWorkspaceStore";
import { downloadIrealPlaylist } from "../../../lib/exportImport";
import { exportLosses } from "../../../lib/ireal/encodeSong";
import StudioChart from "./StudioChart";
import { useRehearsalTransport } from "./useRehearsalTransport";
import type { HarmonyDeskProps } from "./types";

/** The chart on the stand. Nothing here edits the song: transpose and capo are
 *  view transforms, only "commit" writes, and the transport's click is MIDI —
 *  the app has no synth of its own. */
export default function RehearseDesk({
  song,
  section,
  keyName,
  scale,
  playheadBeat,
  onTransposeSong,
  onSelectChord,
}: HarmonyDeskProps) {
  const display = useHarmonyWorkspaceStore((s) => s.display);
  const setTranspose = useHarmonyWorkspaceStore((s) => s.setTranspose);
  const setCapo = useHarmonyWorkspaceStore((s) => s.setCapo);
  const toggleSimplify = useHarmonyWorkspaceStore((s) => s.toggleSimplify);
  const toggleNashville = useHarmonyWorkspaceStore((s) => s.toggleNashville);
  const resetDisplay = useHarmonyWorkspaceStore((s) => s.resetDisplay);
  const transport = useHarmonyWorkspaceStore((s) => s.transport);
  const setTransportToggle = useHarmonyWorkspaceStore((s) => s.setTransportToggle);
  const chartLayout = useHarmonyWorkspaceStore((s) => s.chartLayout);
  const setChartLayout = useHarmonyWorkspaceStore((s) => s.setChartLayout);

  const [losses, setLosses] = useState<string[] | null>(null);
  const beatsPerBar = Math.max(1, Math.round(song.timeSignatureNumerator || 4));
  const rehearsal = useRehearsalTransport({
    song,
    sectionId: section.id,
    loop: transport.loop,
    click: transport.click,
    countIn: transport.countIn,
    beatsPerBar,
  });

  const soundingKey =
    display.transpose === 0 ? keyName : noteName((pitchClass(keyName) + display.transpose + 12) % 12, keyName);
  const shapeShift = display.transpose - display.capo;
  const shapeKey =
    shapeShift === 0 ? keyName : noteName((pitchClass(keyName) + shapeShift + 12) % 12, keyName);
  const bars = Math.max(1, Math.round(sectionDurationBeats(section) / beatsPerBar));
  const countIn = rehearsal.countInBeat;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-edge bg-panel px-2 py-1.5">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={rehearsal.isPlaying ? rehearsal.stop : rehearsal.play}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
              rehearsal.isPlaying
                ? "border-accent bg-accent/15 text-accent"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            title="Move the playhead through the chart. The app's clock is silent — sound comes from your instrument or from the click."
          >
            {rehearsal.isPlaying ? "■ stop" : "▶ play"}
          </button>
          {countIn !== null && (
            <span className="font-mono text-[13px] font-semibold tabular-nums text-accent" title="Count-in bar">
              {countIn}
            </span>
          )}
        </span>

        <Control label="Before the downbeat">
          <Toggle on={transport.countIn} onClick={() => setTransportToggle("countIn")}>
            count-in
          </Toggle>
          <Toggle
            on={transport.click}
            onClick={() => setTransportToggle("click")}
            title={
              rehearsal.clickReady
                ? "A click on every beat through the selected MIDI output, accented on the downbeat"
                : "Needs a MIDI output — set one in the MIDI panel and the click has somewhere to go"
            }
            muted={!rehearsal.clickReady}
          >
            click
          </Toggle>
          <Toggle
            on={transport.loop}
            onClick={() => setTransportToggle("loop")}
            title={`Repeat ${section.name} until you stop`}
          >
            loop
          </Toggle>
        </Control>

        <Control label="Transpose">
          <Stepper
            value={`${display.transpose >= 0 ? "+" : ""}${display.transpose}`}
            onDecrement={() => setTranspose(display.transpose - 1)}
            onIncrement={() => setTranspose(display.transpose + 1)}
          />
          <button
            type="button"
            disabled={display.transpose === 0}
            onClick={() => {
              onTransposeSong(display.transpose);
              resetDisplay();
            }}
            className="rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] text-inkMuted hover:text-ink disabled:opacity-40"
            title="Write the transposed chords and key to the song (one undo step)"
          >
            commit
          </button>
        </Control>

        <Control label="Capo">
          <Stepper
            value={String(display.capo)}
            onDecrement={() => setCapo(display.capo - 1)}
            onIncrement={() => setCapo(display.capo + 1)}
          />
        </Control>

        <Control label="Reading">
          <Toggle on={display.simplify} onClick={toggleSimplify}>
            simplify
          </Toggle>
          <Toggle on={display.nashville} onClick={toggleNashville}>
            Nashville
          </Toggle>
        </Control>

        <Control label="Chart">
          <span className="flex overflow-hidden rounded border border-edge">
            {[4, 8].map((count) => (
              <button
                key={count}
                type="button"
                aria-pressed={chartLayout.barsPerSystem === count}
                onClick={() => setChartLayout({ barsPerSystem: count as 4 | 8 })}
                title={`${count} bars to a line`}
                className={`px-1.5 py-0.5 font-mono text-[10px] ${
                  chartLayout.barsPerSystem === count ? "bg-accent/15 text-accent" : "text-inkMuted hover:text-ink"
                }`}
              >
                {count}
              </button>
            ))}
          </span>
          <Toggle
            on={chartLayout.beats}
            onClick={() => setChartLayout({ beats: !chartLayout.beats })}
            title="One column per beat, with a slash wherever the chord is held"
          >
            beats
          </Toggle>
        </Control>

        <Control label="Hand off">
          <button
            type="button"
            onClick={() => {
              downloadIrealPlaylist([song]);
              setLosses(exportLosses(song));
            }}
            title="Download an iReal Pro playlist (.html) — drag it onto the iReal Pro app, or open it on iOS to add this chart"
            className="rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] text-inkMuted hover:border-accent hover:text-ink"
          >
            iReal chart
          </button>
        </Control>

        <span className="ml-auto font-mono text-[9px] text-inkMuted/70">
          sounding {soundingKey} {scale} · shapes in {shapeKey} · {section.name} {bars} bars
        </span>
      </div>

      <StudioChart
        song={song}
        display={display}
        keyName={keyName}
        scale={scale}
        activeBeat={playheadBeat ?? null}
        focusedSectionId={section.id}
        onFocusSection={() => onSelectChord(null)}
        barsPerSystem={chartLayout.barsPerSystem}
        beats={chartLayout.beats}
      />

      {losses && (
        <p className="rounded border border-edge/60 bg-panel/60 px-2 py-1 font-mono text-[9px] text-inkMuted">
          {losses.length === 0
            ? "iReal chart written — chords, bars, sections and repeats all made it."
            : `iReal chart written. Not carried: ${losses.join(", ")}.`}
          <button type="button" onClick={() => setLosses(null)} className="ml-2 text-accent hover:underline">
            dismiss
          </button>
        </p>
      )}

      <p className="font-mono text-[9px] text-inkMuted/60">
        Display only: transpose {display.transpose >= 0 ? "+" : ""}
        {display.transpose} · capo {display.capo} · {display.simplify ? "triads" : "full extensions"} ·{" "}
        {display.nashville ? "numbers" : "roman numerals"} — the song is untouched until commit.
      </p>
    </div>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-r border-edge/50 pr-3 last:border-r-0 last:pr-0">
      <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-inkMuted/70">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function Stepper({
  value,
  onDecrement,
  onIncrement,
}: {
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onDecrement}
        className="rounded border border-edge px-1 font-mono text-[10px] text-inkMuted hover:text-ink"
      >
        −
      </button>
      <span className="min-w-[30px] text-center font-mono text-[11px] tabular-nums">{value}</span>
      <button
        type="button"
        onClick={onIncrement}
        className="rounded border border-edge px-1 font-mono text-[10px] text-inkMuted hover:text-ink"
      >
        +
      </button>
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
  title,
  muted,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={title}
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
        on ? "border-accent bg-accent/15 text-accent" : "border-edge text-inkMuted hover:text-ink"
      } ${muted ? "opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}
