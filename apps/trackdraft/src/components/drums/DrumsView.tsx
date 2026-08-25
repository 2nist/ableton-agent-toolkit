import { useEffect, useRef, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { useDockStore } from "../../store/dockStore";
import { updateSection } from "../../lib/sections";
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
import TransitionPopover from "./TransitionPopover";
import DrumsDockTools from "./DrumsDockTools";
import { planSectionHandoffFills, FILL_DATA, type HandoffSectionInput, type KitVoice } from "@drum/library";
import type { BlueprintSection, DrumTransitionModel } from "../../types/blueprint";

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
// Wide enough that the handoff label (drawn at yBottom+12) clears a real,
// space-reserving horizontal scrollbar (~15-17px on most non-macOS/non-
// overlay-scrollbar setups) — this container scrolls horizontally on any
// song wider than the viewport, so that scrollbar is the common case, not
// an edge case, and 26px of pad left the label sitting right under it.
const BOTTOM_PAD = 44;
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
 *  pattern as Harmony's canvas/dock split) — its pattern + variant then
 *  edit from the dock's Tools panel via `DrumsDockTools`. A boundary's
 *  transition can *also* be set right where it happens — clicking the
 *  handoff line itself opens `TransitionPopover` in place, matching the
 *  design reference's click-the-timeline interaction — rather than only
 *  through the dock's Transition block once a section is selected. Both
 *  write the same `drumTransitionModel`/`drumTransitionBars` fields, so
 *  neither is a fork of the other. */
export default function DrumsView() {
  const song = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useDrumsSelectionStore((s) => s.setSelectedSectionId);
  const setTools = useDockStore((s) => s.setTools);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [transitionPopover, setTransitionPopover] = useState<{ sectionId: string; left: number; top: number } | null>(
    null,
  );

  // Registered once — DrumsDockTools reads the shared selection store
  // itself and re-renders on its own, same reasoning as HarmonyDockTools.
  useEffect(() => {
    setTools(<DrumsDockTools />);
    return () => setTools(null);
  }, [setTools]);

  // Closes the popover on any click outside it or outside a handoff hit
  // target — the hit targets themselves stopPropagation so re-clicking a
  // (possibly different) boundary while one's already open just retargets
  // it instead of closing then needing a second click to reopen.
  useEffect(() => {
    if (!transitionPopover) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-transition-popover]')) return;
      setTransitionPopover(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [transitionPopover]);

  if (!song) return null;

  function setBoundaryTransitionModel(sectionId: string, model: DrumTransitionModel | null) {
    updateCurrentSong((s) =>
      updateSection(s, sectionId, (sec) => ({
        ...sec,
        drumTransitionModel: model ?? undefined,
        drumTransitionBars: model ? (sec.drumTransitionBars ?? 1) : undefined,
      })),
    );
  }

  function setBoundaryTransitionBars(sectionId: string, bars: number) {
    updateCurrentSong((s) => updateSection(s, sectionId, (sec) => ({ ...sec, drumTransitionBars: Math.max(1, bars) })));
  }

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
          continues the line instead of redrawing its necklace. Click a section to edit its pattern in the dock, or
          click a boundary line to set what happens at that handoff, right there.
        </p>
      </div>

      {usedVoices.length === 0 ? (
        <p className="text-inkMuted text-sm">No drum voices resolve for this song yet.</p>
      ) : (
        <div ref={wrapRef} className="relative overflow-x-auto border border-edge rounded bg-panel">
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

            {/* lane labels + baselines — each voice's own color, the way
                the design reference draws it: a faint guide the full
                width of the song (this voice *could* play here), with a
                bold segment laid over just the bars it actually does.
                Matches the reference's "quiet baseline" vs. active
                "lane-baseline" distinction, not a single flat gray line. */}
            {usedVoices.map((voice, li) => {
              const y = TOP_PAD + li * LANE_H + LANE_H / 2;
              const color = VOICE_COLOR[voice] ?? "#8B94A1";
              return (
                <g key={`lane-${voice}`}>
                  <text x={X0 - 16} y={y + 3} textAnchor="end" fontSize={9} fontFamily="'IBM Plex Mono', monospace" fill={color}>
                    {VOICE_LABEL[voice]}
                  </text>
                  <line x1={barToX(0)} y1={y} x2={barToX(bars)} y2={y} stroke={color} strokeWidth={1} strokeOpacity={0.25} />
                  {resolved.map((r, i) => {
                    const active = r.necklaces?.some((n) => n.voice === voice && n.count > 0);
                    if (!active) return null;
                    return (
                      <line
                        key={`active-${voice}-${i}`}
                        x1={barToX(r.span.startBar)}
                        y1={y}
                        x2={barToX(r.span.startBar + r.span.bars)}
                        y2={y}
                        stroke={color}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                      />
                    );
                  })}
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
                same as the real export. Every boundary (not just ones with
                a marker already) carries a wide invisible click target, so
                a silent/auto-fill boundary is exactly as clickable as one
                that already has an explicit transition — clicking opens
                `TransitionPopover` right there to set or change it. */}
            {resolved.slice(0, -1).map((r, i) => {
              const model = r.span.section.drumTransitionModel;
              const hasAutoFill = handoffPlans[i]?.fillStart !== null;
              const sectionId = r.span.section.id;

              const x = barToX(r.span.startBar + r.span.bars);
              const yTop = TOP_PAD - 8;
              const yBottom = TOP_PAD - 8 + laneStackHeight + 8;
              const color = model ? TRANSITION_COLOR[model] : "#565F70";

              return (
                <g key={`handoff-${i}`}>
                  {(model || hasAutoFill) && (
                    <>
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
                    </>
                  )}
                  <rect
                    data-transition-popover
                    x={x - 14}
                    y={yTop}
                    width={28}
                    height={yBottom - yTop}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const wrapEl = wrapRef.current;
                      if (!wrapEl) return;
                      const rect = wrapEl.getBoundingClientRect();
                      setTransitionPopover({
                        sectionId,
                        left: Math.min(e.clientX - rect.left + 12, rect.width - 232),
                        top: Math.max(4, e.clientY - rect.top - 10),
                      });
                    }}
                  />
                </g>
              );
            })}
          </svg>

          {transitionPopover && (() => {
            const activeSection = resolved.find((r) => r.span.section.id === transitionPopover.sectionId)?.span
              .section;
            if (!activeSection) return null;
            return (
              <div data-transition-popover>
                <TransitionPopover
                  sectionName={activeSection.name}
                  currentModel={activeSection.drumTransitionModel}
                  currentBars={activeSection.drumTransitionBars}
                  left={transitionPopover.left}
                  top={transitionPopover.top}
                  onSetModel={(model) => setBoundaryTransitionModel(transitionPopover.sectionId, model)}
                  onSetBars={(bars) => setBoundaryTransitionBars(transitionPopover.sectionId, bars)}
                  onClose={() => setTransitionPopover(null)}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
