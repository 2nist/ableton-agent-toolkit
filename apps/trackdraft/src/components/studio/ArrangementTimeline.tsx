import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { classifySong } from "../../lib/classification";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { drumFamilyLabel } from "../../lib/playback/drumPreview";
import type { BlueprintSong } from "../../types/blueprint";

const PX_PER_BEAT = 2;
// Wide enough for the per-section readout strip (harmony/drums/melody)
// beneath each block to stay legible — this is a glance-at-the-song view.
const MIN_BLOCK_WIDTH = 64;
// Tailwind's `gap-0.5` (0.125rem at the default 16px root) — the block
// row's own gap, needed here too so the playhead's pixel math accounts
// for the same spacing between blocks, not just their widths.
const BLOCK_GAP_PX = 2;

/** Left-edge pixel offset of each span, honoring the same
 *  MIN_BLOCK_WIDTH-clamped width every block actually renders at — a
 *  playhead computed from raw `beat * PX_PER_BEAT` would drift out of
 *  alignment with the blocks themselves as soon as any section is short
 *  enough to hit the floor. */
function blockLefts(spans: SectionSpan[]): number[] {
  const lefts: number[] = [];
  let cursor = 0;
  for (const span of spans) {
    lefts.push(cursor);
    const width = Math.max(MIN_BLOCK_WIDTH, span.durationBeats * PX_PER_BEAT);
    cursor += width + BLOCK_GAP_PX;
  }
  return lefts;
}

/** The playhead's x position for the current tick, interpolated within
 *  whichever span it falls in — null when stopped or the tick's beat
 *  doesn't land in any span (e.g. a moment before playback fully starts). */
function playheadX(spans: SectionSpan[], lefts: number[], tick: TransportTick | null): number | null {
  if (!tick || !tick.isPlaying || tick.sectionIndex < 0) return null;
  const span = spans[tick.sectionIndex];
  if (!span) return null;
  const width = Math.max(MIN_BLOCK_WIDTH, span.durationBeats * PX_PER_BEAT);
  const progress = span.durationBeats > 0 ? (tick.beat - span.startBeat) / span.durationBeats : 0;
  return lefts[tick.sectionIndex] + Math.max(0, Math.min(1, progress)) * width;
}

/** Compact, click-to-reveal form indicator in the timeline's own header —
 *  not a separate static panel. Restating "your structure is kind of like
 *  this other structure" back at the user (the previous FormBadge's
 *  skeleton/evidence/runner-up text) had no informational value; the one
 *  thing the taxonomy engine knows that the user can't already see on
 *  this same screen is which *real, named songs* share this exact shape —
 *  so that's the only thing the disclosure reveals. */
function FormDisclosure({ song }: { song: BlueprintSong }) {
  const { form, label, isNewForm, match } = classifySong(song);
  const exemplars = form?.exemplars ?? [];
  const support = form?.provenance.derivedFrom?.support;

  if (isNewForm || exemplars.length === 0) {
    return <span className="text-[10.5px] text-inkMuted/70 font-mono">{label}</span>;
  }

  return (
    <details className="text-[10.5px] font-mono text-inkMuted/70 group">
      <summary className="cursor-pointer select-none hover:text-inkMuted list-none marker:hidden">
        {label} · {Math.round(match.score * 100)}%{" "}
        <span className="text-inkMuted/40 group-open:hidden">▸</span>
        <span className="text-inkMuted/40 hidden group-open:inline">▾</span>
      </summary>
      <p className="mt-1 text-[10.5px] text-inkMuted/80 normal-case">
        Also shaped like: {exemplars.map((e) => e.title).join(", ")}
        {support !== undefined && ` — ${support} known songs share this shape`}
      </p>
    </details>
  );
}

/** A section's actual chord progression as display text — the "data from
 *  hovering" the timeline blocks didn't show before (only a name/bar-range
 *  browser tooltip). Validates the effective key the same defensive way
 *  HarmonyView does: a stale malformed key (e.g. "E major" sitting in
 *  localStorage from before parseImportedSong existed) falls back to "C"
 *  instead of crashing pitchClass() deep in a hover handler. */
function progressionText(span: SectionSpan, song: BlueprintSong): string {
  if (span.section.chords.length === 0) return "No chords yet.";
  const rawKey = span.section.key ?? song.key;
  const keyName: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  return span.section.chords
    .map((c) => `${c.romanNumeral} (${chordDisplayName(pitchClass(c.root), c.quality, keyName)})`)
    .join("  ·  ");
}

/** The first visualization of `sectionSpans` anywhere in the app — the
 *  beat-accurate arrangement layout every "one clip/cue per section"
 *  Ableton generator already computes, but that no component has ever
 *  imported. A repeated section (e.g. three Chorus passes) renders as
 *  three separate blocks, exactly as it becomes three separate clips. */
export default function ArrangementTimeline({ song }: { song: BlueprintSong }) {
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const spans = sectionSpans(song);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tick, setTick] = useState<TransportTick | null>(null);

  useEffect(() => getSongTransport().onTick(setTick), []);

  if (spans.length === 0) return null;

  const hovered = hoveredIndex !== null ? spans[hoveredIndex] : null;
  const lefts = blockLefts(spans);
  const playheadLeft = playheadX(spans, lefts, tick);

  return (
    <div className="border border-edge rounded-lg bg-panel p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] text-inkMuted uppercase tracking-wide">Arrangement</p>
        <FormDisclosure song={song} />
      </div>
      <div className="overflow-x-auto">
        <div className="relative flex gap-0.5" style={{ width: "max-content" }}>
          {playheadLeft !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-10"
              style={{ left: playheadLeft, boxShadow: "0 0 4px 1px #E8B54A" }}
            />
          )}
          {spans.map((span, i) => {
            const style = roleStyle(span.section.role);
            const rawWidth = span.durationBeats * PX_PER_BEAT;
            const width = isFinite(rawWidth) ? Math.max(MIN_BLOCK_WIDTH, rawWidth) : MIN_BLOCK_WIDTH;
            const isSelected = selectedSectionId === span.sectionId;
            const section = span.section;
            const melodyCount = section.melody?.notes?.length ?? 0;
            const harmony = section.chords.length > 0 ? section.chords.map((c) => c.romanNumeral).join(" ") : null;
            const drum = drumFamilyLabel(section, song);
            const jump = (tab: string) => navigate(`/song/${songId}/${tab}?section=${section.id}`);
            return (
              <div
                key={`${span.sectionId}-${span.occurrenceIndex}-${i}`}
                className="shrink-0 flex flex-col"
                style={{ width }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
                onFocus={() => setHoveredIndex(i)}
                onBlur={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
              >
                {/* the select/edit block itself (role-colored) */}
                <button
                  className={`h-12 rounded-[4px] flex flex-col items-start justify-center px-2 overflow-hidden transition-opacity text-left ${
                    isSelected ? "ring-1 ring-accent ring-inset opacity-100" : "hover:opacity-90"
                  }`}
                  style={{ background: style.bg, color: style.text }}
                  onClick={() => setSelectedSectionId(span.sectionId)}
                  onDoubleClick={() => jump("harmony")}
                  title="Click to target its mix · double-click to edit"
                >
                  <span className="text-[10.5px] font-medium leading-tight truncate w-full">{section.name}</span>
                  <span className="text-[9px] opacity-80 font-mono leading-tight">{Math.round(span.bars)} bars</span>
                </button>
                {/* readout strip — harmony / drums / melody, each row jumps
                    into its detail tab for this section */}
                <div className="text-[9px] font-mono leading-tight mt-1 px-0.5 space-y-0.5">
                  <div className="flex items-center gap-1 w-full">
                    {harmony ? (
                      <button
                        className="truncate flex-1 text-left text-inkMuted hover:text-accent"
                        onClick={() => jump("harmony")}
                        title="This section's harmony — edit in Harmony"
                      >
                        {harmony}
                      </button>
                    ) : (
                      <span className="truncate flex-1 text-left text-inkMuted/40">no chords</span>
                    )}
                    {melodyCount > 0 && (
                      <button
                        className="shrink-0 text-inkMuted/80 hover:text-accent"
                        onClick={() => jump("melody")}
                        title={`${melodyCount} melody note(s) — edit in Melody`}
                      >
                        ♪{melodyCount}
                      </button>
                    )}
                  </div>
                  <button
                    className="truncate w-full text-left text-inkMuted hover:text-accent"
                    onClick={() => jump("drums")}
                    title="This section's drums — edit in Drums"
                  >
                    {drum}
                    {song.genre && !section.drumPattern && !section.drumMeterOutline ? (
                      <span className="text-accent/80"> · {song.genre}</span>
                    ) : null}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-[10.5px] font-mono min-h-[16px]">
        {hovered ? (
          <p className="text-inkMuted">
            <span className="text-ink">{hovered.section.name}</span>
            {hovered.variation && ` (${hovered.variation})`}
            <span className="text-inkMuted/50"> — bars {Math.round(hovered.startBar) + 1}–{Math.round(hovered.startBar + hovered.bars)} — </span>
            {progressionText(hovered, song)}
          </p>
        ) : (
          <p className="text-inkMuted/60">
            {Math.round(totalBars(spans))} bars total · click a section to target its mix, double-click to edit
          </p>
        )}
      </div>
    </div>
  );
}
