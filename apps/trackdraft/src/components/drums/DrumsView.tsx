import { useEffect } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { useDockStore } from "../../store/dockStore";
import { sectionSpans, totalBars, type SectionSpan } from "../../lib/arrangement";
import {
  resolveSectionVoiceNecklaces,
  resolveSectionVariant,
  inferPatternForSection,
  velocityNumber,
  type VoiceNecklace,
} from "../../lib/playback/drumPreview";
import { VOICE_COLOR, VOICE_LABEL, VOICE_ORDER } from "./voiceStyle";
import { TRANSITION_COLOR, TRANSITION_LABEL } from "./transitionStyle";
import { SECTION_ROLE_COLOR } from "./sectionRoleStyle";
import NecklaceGlyph from "./NecklaceGlyph";
import DrumsDockTools from "./DrumsDockTools";
import { planSectionHandoffFills, FILL_DATA, type HandoffSectionInput, type KitVoice } from "@drum/library";
import type { BlueprintSection } from "../../types/blueprint";

/** A stable identity for a section's *resolved* drum content — same
 *  preset+variant, or same outline cells/voicing, means literally the
 *  same note data, not just a similar-looking pattern. Drives whether a
 *  voice's necklace repeats on the timeline or the line just continues. */
function sectionDrumKey(section: BlueprintSection): string {
  if (section.drumMeterOutline) {
    const o = section.drumMeterOutline;
    return `outline::${o.cellBeats}::${o.cells.join(",")}::${(o.cellVoices ?? []).join(",")}`;
  }
  const pattern = section.drumPattern ?? inferPatternForSection(section);
  return `${pattern}::${section.drumVariantIndex ?? 0}`;
}

const X0 = 140;
const BAR_PX = 26;
const LANE_H = 46;
const TOP_PAD = 34;
const BOTTOM_PAD = 26;
const NECK_R = 15;

function barToX(bar: number): number {
  return X0 + bar * BAR_PX;
}

interface ResolvedSpan {
  span: SectionSpan;
  /** Identity of the resolved groove — same preset *and* same variant
   *  means literally the same note data, so two spans sharing this key
   *  are provably the same pattern, not just similar-looking. Drives
   *  whether a voice's necklace repeats or the line just continues. */
  key: string;
  necklaces: VoiceNecklace[] | null;
}

/** Whole-song drum arrangement view: every section laid out left to
 *  right (real `sectionSpans` timing, so a repeated Chorus shows as
 *  separate blocks, matching what Ableton will actually get), one lane
 *  per drum voice actually used anywhere in the song, and one
 *  rhythm-necklace glyph per section per voice — the section's real,
 *  resolved groove, not a name in a dropdown. Section boundaries show
 *  what actually happens at the handoff: an explicit named transition
 *  (`drumTransitionModel`) if one's chosen, or the automatic fill every
 *  long-enough section gets by default (`planSectionHandoffFills`, the
 *  same real function `trackdraft-bridge`'s export uses) otherwise.
 *
 *  This is the first real home for the drum-arrangement concept explored
 *  separately; `structure/DrumNecklacePreview.tsx` is the same idea
 *  scoped to one section, living next to the picker that controls it.
 *  Clicking a section selects it (shared via `drumsSelectionStore`, same
 *  pattern as Harmony's canvas/dock split) — its pattern + variant + the
 *  transition into the *next* section then edit from the dock's Tools
 *  panel via `DrumsDockTools`, not inline on the canvas, so the timeline
 *  itself stays a clean read of the whole song. */
export default function DrumsView() {
  const song = useSongStore((s) => s.currentSong());
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useDrumsSelectionStore((s) => s.setSelectedSectionId);
  const setTools = useDockStore((s) => s.setTools);

  // Registered once — DrumsDockTools reads the shared selection store
  // itself and re-renders on its own, same reasoning as HarmonyDockTools.
  useEffect(() => {
    setTools(<DrumsDockTools />);
    return () => setTools(null);
  }, [setTools]);

  if (!song) return null;

  const spans = sectionSpans(song);

  if (spans.length === 0) {
    return (
      <div className="p-6 max-w-3xl">
        <p className="text-inkMuted text-sm">No sections yet — add some in Structure first.</p>
      </div>
    );
  }

  const resolved: ResolvedSpan[] = spans.map((span) => ({
    span,
    key: sectionDrumKey(span.section),
    necklaces: resolveSectionVoiceNecklaces(span.section),
  }));

  // Real handoff-fill planning — the same function trackdraft-bridge's
  // export calls, so "would this boundary get an automatic fill" here
  // means the same thing it means at export time, not a guess.
  const handoffInputs: HandoffSectionInput[] = spans.map((span) => ({
    sectionId: span.sectionId,
    occurrenceIndex: span.occurrenceIndex,
    variant: resolveSectionVariant(span.section),
    durationBeats: span.durationBeats,
    velocityTarget: velocityNumber(span.section.velocity),
  }));
  const handoffPlans = planSectionHandoffFills(handoffInputs, FILL_DATA);

  const usedVoices: KitVoice[] = VOICE_ORDER.filter((v) =>
    resolved.some((r) => r.necklaces?.some((n) => n.voice === v && n.count > 0)),
  );

  const bars = totalBars(spans);
  const width = barToX(bars) + 40;
  const laneStackHeight = Math.max(1, usedVoices.length) * LANE_H;
  const height = TOP_PAD + laneStackHeight + BOTTOM_PAD;

  return (
    <div className="p-6 space-y-3">
      <div>
        <h2 className="font-medium text-sm">Drums</h2>
        <p className="text-xs text-inkMuted">
          The whole song's resolved groove, one lane per voice — a repeat of the exact same pattern+variant just
          continues the line instead of redrawing its necklace. Click a section to edit its pattern and its
          transition into the next one, in the dock.
        </p>
      </div>

      {usedVoices.length === 0 ? (
        <p className="text-inkMuted text-sm">No drum voices resolve for this song yet.</p>
      ) : (
        <div className="overflow-x-auto border border-edge rounded bg-panel">
          <svg width={width} height={height} className="block">
            {/* section bands — click any occurrence to select its section
                (all occurrences of the same section highlight together,
                since they share one underlying section to edit) */}
            {resolved.map((r, i) => {
              const x = barToX(r.span.startBar);
              const w = barToX(r.span.startBar + r.span.bars) - x;
              const isSelected = r.span.section.id === selectedSectionId;
              const roleColor = SECTION_ROLE_COLOR[r.span.section.role] ?? SECTION_ROLE_COLOR.custom;
              return (
                <g
                  key={`band-${i}`}
                  onClick={() => setSelectedSectionId(r.span.section.id)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={x}
                    y={TOP_PAD - 8}
                    width={w}
                    height={laneStackHeight + 8}
                    fill={roleColor.fill}
                    stroke={isSelected ? "#E8B54A" : roleColor.rim}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeOpacity={isSelected ? 1 : 0.5}
                  />
                  <text
                    x={x + w / 2}
                    y={TOP_PAD - 14}
                    textAnchor="middle"
                    fontSize={10}
                    fontFamily="'IBM Plex Mono', monospace"
                    fill={isSelected ? "#E8B54A" : roleColor.rim}
                  >
                    {r.span.section.name}
                    {r.span.occurrenceIndex > 0 ? ` ·${r.span.occurrenceIndex + 1}` : ""}
                  </text>
                </g>
              );
            })}

            {/* lane labels + baselines */}
            {usedVoices.map((voice, li) => {
              const y = TOP_PAD + li * LANE_H + LANE_H / 2;
              return (
                <g key={`lane-${voice}`}>
                  <text x={X0 - 16} y={y + 3} textAnchor="end" fontSize={9} fontFamily="'IBM Plex Mono', monospace" fill={VOICE_COLOR[voice] ?? "#8B94A1"}>
                    {VOICE_LABEL[voice]}
                  </text>
                  <line x1={barToX(0)} y1={y} x2={barToX(bars)} y2={y} stroke="#2E2E34" strokeWidth={1} />
                </g>
              );
            })}

            {/* one necklace per section per voice, skipping exact repeats */}
            {usedVoices.map((voice, li) => {
              const y = TOP_PAD + li * LANE_H + LANE_H / 2;
              let lastKey: string | null = null;
              return resolved.map((r, i) => {
                const n = r.necklaces?.find((v) => v.voice === voice && v.count > 0);
                if (!n) {
                  lastKey = null;
                  return null;
                }
                const sameAsPrev = lastKey === r.key;
                lastKey = r.key;
                if (sameAsPrev) return null; // provably identical resolved data — the line just continues
                const cx = barToX(r.span.startBar) + (barToX(r.span.startBar + r.span.bars) - barToX(r.span.startBar)) / 2;
                return (
                  <NecklaceGlyph
                    key={`glyph-${voice}-${i}`}
                    cx={cx}
                    cy={y}
                    radius={NECK_R}
                    hits={n.hits}
                    color={VOICE_COLOR[voice] ?? "#8B94A1"}
                    backdrop="#12161D"
                  />
                );
              });
            })}

            {/* section-boundary handoffs — an explicit named transition if
                the section has one chosen, else the automatic handoff fill
                every long-enough section gets by default. The last span
                never gets either: there's nothing after it to hand off to,
                same as the real export. */}
            {resolved.slice(0, -1).map((r, i) => {
              const model = r.span.section.drumTransitionModel;
              const hasAutoFill = handoffPlans[i]?.fillStart !== null;
              if (!model && !hasAutoFill) return null;

              const x = barToX(r.span.startBar + r.span.bars);
              const yTop = TOP_PAD - 8;
              const yBottom = TOP_PAD - 8 + laneStackHeight + 8;
              const color = model ? TRANSITION_COLOR[model] : "#565F70";

              return (
                <g key={`handoff-${i}`}>
                  <line
                    x1={x} y1={yTop} x2={x} y2={yBottom}
                    stroke={color}
                    strokeWidth={model ? 2 : 1.4}
                    strokeDasharray={model ? undefined : "2 3"}
                    opacity={model ? 0.9 : 0.6}
                  />
                  <text x={x} y={yBottom + 12} textAnchor="middle" fontSize={8} fontFamily="'IBM Plex Mono', monospace" fill={color}>
                    {model ? TRANSITION_LABEL[model].toUpperCase() : "FILL"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
