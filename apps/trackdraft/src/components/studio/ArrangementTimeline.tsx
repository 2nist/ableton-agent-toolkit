import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import { roleStyle } from "../../lib/roleColors";
import { classifySong } from "../../lib/classification";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import type { BlueprintSong } from "../../types/blueprint";

const PX_PER_BEAT = 2;
const MIN_BLOCK_WIDTH = 32;

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
  const spans = sectionSpans(song);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (spans.length === 0) return null;

  const hovered = hoveredIndex !== null ? spans[hoveredIndex] : null;

  return (
    <div className="border border-edge rounded-lg bg-panel p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-inkMuted uppercase tracking-wide">Arrangement</p>
        <FormDisclosure song={song} />
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-0.5" style={{ width: "max-content" }}>
          {spans.map((span, i) => {
            const style = roleStyle(span.section.role);
            const width = Math.max(MIN_BLOCK_WIDTH, span.durationBeats * PX_PER_BEAT);
            return (
              <button
                key={`${span.sectionId}-${span.occurrenceIndex}-${i}`}
                className="h-14 shrink-0 rounded-[4px] flex flex-col items-start justify-center px-2 overflow-hidden hover:opacity-90 transition-opacity text-left"
                style={{ width, background: style.bg, color: style.text }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
                onFocus={() => setHoveredIndex(i)}
                onBlur={() => setHoveredIndex((cur) => (cur === i ? null : cur))}
                onClick={() => navigate(`/song/${songId}/harmony?section=${span.sectionId}`)}
              >
                <span className="text-[10.5px] font-medium leading-tight truncate w-full">{span.section.name}</span>
                <span className="text-[9px] opacity-80 font-mono leading-tight">{Math.round(span.bars)} bars</span>
              </button>
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
            {Math.round(totalBars(spans))} bars total · hover a section for its progression, click to edit
          </p>
        )}
      </div>
    </div>
  );
}
