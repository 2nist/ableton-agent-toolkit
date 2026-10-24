import { planSectionTransitions, type TransitionModel } from "@drum/library";
import { beatsPerBar, type BlueprintSection } from "../../../types/blueprint";
import { velocityNumber } from "../../../lib/playback/drumPreview";

/** A section-relative beat window. */
export interface MarkerRange {
  startBeat: number;
  endBeat: number;
}

export interface TransitionMarker extends MarkerRange {
  model: TransitionModel;
  /** True when `drumTransitionModel` is authored — otherwise the role plan. */
  manual: boolean;
  bars: number;
}

export interface SectionMarkers {
  /** The handoff gesture occupying the section's last bar(s). */
  transition: TransitionMarker | null;
  /** The authored detour window (`drumVariationOutline` + start/bars). */
  detour: MarkerRange | null;
}

export interface MarkerSpan {
  sectionId: string;
  occurrenceIndex: number;
  durationBeats: number;
  section: BlueprintSection;
  /** False when the section resolves to no groove at all. */
  hasVariant: boolean;
}

/**
 * The drum view's marker rail, read from the SAME plan `midiExport` applies
 * (`planSectionTransitions`) so a marker can never claim a handoff the export
 * won't play. Detour windows follow the export's convention:
 * `drumVariationStartBeat ?? section end − span`, clamped inside the section.
 */
export function sectionMarkers(spans: MarkerSpan[]): SectionMarkers[] {
  const auto = planSectionTransitions(
    spans.map((s) => ({
      sectionId: s.sectionId,
      occurrenceIndex: s.occurrenceIndex,
      role: s.section.role ?? null,
      durationBeats: s.durationBeats,
      beatsPerBar: beatsPerBar(s.section),
      velocityTarget: velocityNumber(s.section.velocity),
      manualModel: s.section.drumTransitionModel != null,
      hasVariation: s.section.drumVariationOutline != null,
    })),
  );

  return spans.map((s, i) => {
    const bpb = Math.max(1e-6, beatsPerBar(s.section));
    const duration = s.durationBeats;
    const maxBars = Math.max(1, Math.floor(duration / bpb));

    const manual = s.section.drumTransitionModel ?? null;
    const model = manual ?? (s.hasVariant ? auto[i].model : null);
    const bars = Math.min(maxBars, Math.max(1, manual ? (s.section.drumTransitionBars ?? 1) : auto[i].bars));
    const transition: TransitionMarker | null = model
      ? {
          model,
          manual: manual != null,
          bars,
          startBeat: Math.max(0, duration - bars * bpb),
          endBeat: duration,
        }
      : null;

    let detour: MarkerRange | null = null;
    if (s.section.drumVariationOutline) {
      const span = Math.min(Math.max(1, s.section.drumVariationBars ?? 1) * bpb, duration);
      const start = Math.max(0, Math.min(s.section.drumVariationStartBeat ?? duration - span, duration - span));
      detour = { startBeat: start, endBeat: start + span };
    }

    return { transition, detour };
  });
}
