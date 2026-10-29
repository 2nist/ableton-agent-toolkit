import type { BlueprintSection, DrumLaneId } from "../../../types/blueprint";
import { sectionDurationBeats } from "../../../types/blueprint";
import { laneFigureBlock } from "../../../lib/drums/laneFigure";
import { DRUM_LANE_VOICES, voiceOf, type KitVoice } from "@drum/library";
import type { PackedVariant } from "@drum/library";
import { upsertModeBlocks } from "./selectionMath";

/**
 * A lane pick: replace ONE drum with the chosen figure, keep the rest of the
 * beat.
 *
 * The feel lens can be scoped to a single drum, which is the only way to
 * assemble a groove lane by lane — kick from one pattern, snare from another.
 * `applyDrumBlocks` gives the mechanism (`spliceLane` replaces one lane family
 * inside a block's range and leaves every other lane alone), so the write is a
 * section-wide `steps` block for that lane. The section's `drumPattern` is
 * deliberately untouched: the base groove it names still supplies every lane
 * the writer has not overridden.
 */
export function withLaneFigure(
  section: BlueprintSection,
  args: { lane: DrumLaneId; variant: PackedVariant },
): BlueprintSection {
  const { lane, variant } = args;
  const laneVoices = DRUM_LANE_VOICES[lane] as readonly KitVoice[];
  const figure = (variant.notes ?? [])
    .map(([beat, pitch, velocity]) => ({ beat, voice: voiceOf(pitch), velocity }))
    .filter((note): note is { beat: number; voice: KitVoice; velocity: number } =>
      note.voice !== null && laneVoices.includes(note.voice),
    );
  const duration = sectionDurationBeats(section);
  const block = laneFigureBlock({
    lane,
    notes: figure,
    lengthBeats: variant.lengthBeats,
    durationBeats: duration,
  });
  if (!block) return section;
  return {
    ...section,
    drumBlocks: upsertModeBlocks(section.drumBlocks, 0, duration, [block]),
  };
}
