import { useEffect, useMemo, useState } from "react";
import { sectionSpans, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";

/**
 * The Spine — the workspace's full-width top band (docs/design/workspace.md §2).
 *
 * One time axis for the whole song, rendered edge-to-edge above the zones
 * row so the left browser / right rail can never squeeze it. This is v0 of
 * the "cards ↔ ribbon" spine: section blocks proportional to bars, a
 * playhead that follows the transport, click-to-target, and per-section
 * material coverage dots (chords · drums · melody · lyrics) that double as
 * the future doorways into each element's section face.
 *
 * Selection is the same `studioSelectionStore.selectedSectionId` the
 * arrangement timeline and the Mix/Bend panel already share, so the spine
 * re-targets them for free.
 */
export default function Spine({ song, hint }: { song: BlueprintSong; hint?: string }) {
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const [tick, setTick] = useState<TransportTick | null>(null);

  useEffect(() => getSongTransport().onTick(setTick), []);

  const spans = useMemo(() => sectionSpans(song), [song]);
  if (spans.length === 0) return null;

  const totalBeats = spans.reduce((sum, sp) => sum + sp.durationBeats, 0);
  const liveIndex = tick?.isPlaying && tick.sectionIndex >= 0 && tick.sectionIndex < spans.length ? tick.sectionIndex : null;
  // Percentage math is exact while blocks are pure flex-grow (no gaps) —
  // the min-width floor can introduce a few px of drift on very short
  // sections; acceptable for v0, the ArrangementTimeline pixel math can
  // move in later if it starts to annoy.
  const playheadPct =
    totalBeats > 0 && tick && (tick.isPlaying || tick.beat > 0)
      ? Math.min(100, Math.max(0, (tick.beat / totalBeats) * 100))
      : null;

  return (
    <section
      className="shrink-0 border-b border-edge bg-panel"
      aria-label="Song spine"
      title={hint ?? "The Spine — click a section to target it; ←→ walks sections here"}
    >
      <div className="flex items-stretch h-[52px]">
        {/* The blocks — proportional to bars, touching (border-separated) so
            the playhead's % position stays honest. Song identity deliberately
            lives in the legacy header above for now (a chip here duplicated
            it); the chip returns to the spine's left end in P2, when the
            header folds into the spine. */}
        <div className="flex-1 min-w-0 relative flex">
          {playheadPct !== null && (
            <div
              className="absolute top-0 bottom-0 w-px bg-accent pointer-events-none z-20"
              style={{ left: `${playheadPct}%`, boxShadow: "0 0 4px 1px #E8B54A" }}
            />
          )}
          {spans.map((span, i) => (
            <SpineBlock
              key={`${span.sectionId}-${span.occurrenceIndex}-${i}`}
              span={span}
              song={song}
              selected={selectedSectionId === span.sectionId}
              live={liveIndex === i}
              onSelect={() => setSelectedSectionId(span.sectionId)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** One section block. Role-colored like the arrangement timeline; the
 *  coverage dots read authored material at a glance ("this bridge has no
 *  melody yet") and become clickable doorways in P3. */
function SpineBlock({
  span,
  song,
  selected,
  live,
  onSelect,
}: {
  span: SectionSpan;
  song: BlueprintSong;
  selected: boolean;
  live: boolean;
  onSelect: () => void;
}) {
  const style = roleStyle(span.section.role);
  const dots = coverageDots(span.section);
  const missing = dots.filter((d) => !d.present).map((d) => d.label);
  return (
    <button
      type="button"
      className={`relative flex-1 min-w-0 min-h-0 h-full flex flex-col justify-center items-start px-1.5 text-left overflow-hidden border-r border-black/25 last:border-r-0 transition-opacity ${
        selected ? "ring-1 ring-accent ring-inset z-10 opacity-100" : "hover:opacity-90"
      }`}
      style={{ background: style.bg, color: style.text, flexGrow: Math.max(span.durationBeats, 1), flexBasis: 0, minWidth: 44 }}
      onClick={onSelect}
      title={`${span.section.name} — ${Math.round(span.bars)} bars${missing.length ? ` · missing: ${missing.join(", ")}` : " · all elements sketched"}`}
    >
      <span className="w-full text-[10px] leading-tight font-medium truncate">
        {span.section.name}
        {span.variation ? <span className="opacity-60"> ({span.variation})</span> : null}
      </span>
      <span className="flex items-center gap-1 mt-0.5">
        <span className="text-[9px] font-mono opacity-70 tabular-nums">{Math.round(span.bars)}b</span>
        {dots.map((d) => (
          <span
            key={d.label}
            className={`w-1.5 h-1.5 rounded-full bg-current ${d.present ? "opacity-60" : "opacity-15"}`}
            title={`${d.label}: ${d.present ? "authored" : "not yet"}`}
          />
        ))}
      </span>
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
