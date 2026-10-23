import { useMemo, useState } from "react";
import { sectionSpans } from "../../../lib/arrangement";
import { resolveSectionLaneHits } from "../../../lib/timeline/drumLaneHits";
import { beatsPerBarOf } from "../../../lib/timeline/beatMap";
import { useSongStore } from "../../../store/songStore";
import { useStudioSelectionStore } from "../../../store/studioSelectionStore";
import { updateSection } from "../../../lib/sections";
import { usePalette } from "../../../theme/palette";
import { handCell } from "../../../theme/handDrawn";
import { DRUM_LANES, laneColor } from "../laneStyle";
import { withToggledStep } from "../blocks/stepToggle";
import type { DrumLaneId } from "@drum/library";

/**
 * The Steps view — a plain 16-box sequencer for one bar, the way a drum
 * machine has always shown it. It exists because the other two surfaces
 * answer different questions: Classic draws the whole song as necklaces and
 * detours, Blocks draws every step of every section at once and pairs each
 * with a value box. Neither says "these are the sixteen steps of this bar,
 * press them".
 *
 * Cells are hand-drawn with the recipe the prototype used — seeded corner
 * radii, a hair of lean, a second offset outline, pencil hatch on a hit —
 * `.hand-cell` in theme/themes.css, driven by `handCell()`. The seed is per
 * (lane, step), so the grid never shimmers while the transport runs.
 *
 * Writes go through `withToggledStep`, the helper the Blocks view also uses:
 * one meaning of "toggle this step", so the views can't disagree about how a
 * pattern is stored.
 */
const STEPS = 16;

export default function DrumStepsView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const P = usePalette();
  const [barIndex, setBarIndex] = useState(0);

  const song = currentSong;
  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);

  /** step index → the loudest velocity on it, per lane, for this bar. */
  const hitsByLane = useMemo(() => {
    const map = new Map<string, Map<number, number>>();
    if (!song || spans.length === 0) return map;
    const span = spans.find((s) => s.section.id === selectedSectionId) ?? spans[0];
    const bpb = beatsPerBarOf(span);
    const stepBeats = bpb / STEPS;
    const barStart = Math.min(barIndex, Math.max(1, Math.round(span.bars)) - 1) * bpb;
    const tol = Math.max(0.02, stepBeats * 0.35);
    const hits = resolveSectionLaneHits(span.section, song, span.occurrenceIndex);
    for (const lane of DRUM_LANES) {
      const byStep = new Map<number, number>();
      for (const hit of hits.get(lane.key as DrumLaneId) ?? []) {
        const idx = Math.round((hit.beat - barStart) / stepBeats);
        if (idx < 0 || idx >= STEPS) continue;
        if (Math.abs(hit.beat - (barStart + idx * stepBeats)) > tol) continue;
        byStep.set(idx, Math.max(byStep.get(idx) ?? 0, hit.velocity));
      }
      map.set(lane.key, byStep);
    }
    return map;
  }, [song, spans, selectedSectionId, barIndex]);

  if (!song || spans.length === 0) {
    return <p className="text-inkMuted text-xs p-3">No sections yet — add some in Structure first.</p>;
  }

  const span = spans.find((s) => s.section.id === selectedSectionId) ?? spans[0];
  const bars = Math.max(1, Math.round(span.bars));
  const bar = Math.min(barIndex, bars - 1);
  const bpb = beatsPerBarOf(span);
  const stepBeats = bpb / STEPS;
  const barStartBeat = bar * bpb;

  const toggle = (laneKey: DrumLaneId, step: number) => {
    updateCurrentSong((s) =>
      updateSection(s, span.section.id, (sec) =>
        withToggledStep(sec, {
          section: span.section,
          song: s,
          occurrenceIndex: span.occurrenceIndex,
          laneKey,
          beat: barStartBeat + step * stepBeats,
          stepSize: stepBeats,
        }),
      ),
    );
    setSelectedSectionId(span.section.id);
  };

  return (
    <div className="space-y-2">
      {/* Which section, which bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {spans.map((s) => (
          <button
            key={`${s.section.id}-${s.occurrenceIndex}`}
            className={`font-mono text-2xs rounded px-2 py-1 border ${
              s.section.id === span.section.id
                ? "border-track text-track bg-track/10"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => {
              setSelectedSectionId(s.section.id);
              setBarIndex(0);
            }}
            title={`${s.section.name} — ${s.bars} bars`}
          >
            {s.section.name}
            {s.occurrenceIndex > 0 ? ` ·${s.occurrenceIndex + 1}` : ""}
          </button>
        ))}
        <span className="flex-1" />
        <span className="flex items-center gap-1 font-mono text-2xs text-inkMuted">
          <button
            className="px-1.5 py-0.5 border border-edge rounded hover:text-ink disabled:opacity-30"
            onClick={() => setBarIndex(Math.max(0, bar - 1))}
            disabled={bar === 0}
            title="Previous bar"
          >
            ◂
          </button>
          <span className="tabular-nums w-[7ch] text-center">
            bar {bar + 1}/{bars}
          </span>
          <button
            className="px-1.5 py-0.5 border border-edge rounded hover:text-ink disabled:opacity-30"
            onClick={() => setBarIndex(Math.min(bars - 1, bar + 1))}
            disabled={bar >= bars - 1}
            title="Next bar"
          >
            ▸
          </button>
        </span>
      </div>

      {/* The grid: frozen voice names, sixteen boxes per lane */}
      <div className="flex items-stretch border border-edge rounded bg-deep overflow-hidden">
        <div className="shrink-0 border-r border-edge/60 bg-deep" style={{ width: 62 }}>
          <div className="h-5" />
          {DRUM_LANES.map((lane) => (
            <div
              key={`lbl-${lane.key}`}
              className="flex items-center justify-end pr-1.5 h-7"
              style={{ color: laneColor(lane, P) }}
            >
              <span className="font-mono text-2xs font-semibold tracking-wider">{lane.label}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0 overflow-x-auto">
          <div style={{ minWidth: STEPS * 20 }}>
            {/* step numbers — a readout, so the mono voice, with the accents a
                drummer counts to */}
            <div className="flex h-5 items-end">
              {Array.from({ length: STEPS }).map((_, i) => (
                <span
                  key={`n-${i}`}
                  className={`flex-1 text-center font-mono text-[9px] tabular-nums ${
                    i === 0 ? "text-ink" : i % 4 === 0 ? "text-inkMuted" : "text-inkMuted/40"
                  }`}
                >
                  {i + 1}
                </span>
              ))}
            </div>
            {DRUM_LANES.map((lane) => {
              const on = hitsByLane.get(lane.key) ?? new Map<number, number>();
              const colour = laneColor(lane, P);
              return (
                <div key={`row-${lane.key}`} className="flex h-7 items-center gap-[3px] px-[1px]">
                  {Array.from({ length: STEPS }).map((_, i) => {
                    const velocity = on.get(i);
                    const isOn = velocity !== undefined;
                    return (
                      <button
                        key={`c-${lane.key}-${i}`}
                        className={`relative flex-1 h-5 rounded-[2px] border ${
                          P.handDrawn ? (isOn ? "hand-cell hand-cell--on" : "hand-cell") : ""
                        }`}
                        style={{
                          borderColor: isOn ? "rgba(38,34,27,0.62)" : "rgba(62,54,42,0.5)",
                          background: isOn ? colour : P.handDrawn ? "rgba(255,255,255,0.35)" : P.well,
                          ...(P.handDrawn
                            ? { ...handCell(lane.key.charCodeAt(0) * 31 + i * 7 + 1), "--hatch": `${40 + ((i + lane.label.length) % 4) * 3}deg` }
                            : null),
                        }}
                        onClick={() => toggle(lane.key as DrumLaneId, i)}
                        title={`${lane.label} · step ${i + 1}${isOn ? ` · velocity ${velocity}` : ""}`}
                        aria-label={`${lane.label} step ${i + 1}`}
                        aria-pressed={isOn}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-2xs text-inkMuted">
        Click a box to add or remove that step · the pencil hatch marks a played step ·
        per-step velocities live in Blocks, where every step has a value box
      </p>
    </div>
  );
}
