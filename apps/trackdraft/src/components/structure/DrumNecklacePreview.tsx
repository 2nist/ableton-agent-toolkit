import { resolveVoiceNecklaces } from "../../lib/playback/drumPreview";
import NecklaceRow from "../drums/NecklaceRow";
import type { DrumPattern } from "../../types/blueprint";

/** Read-only preview of a section's actual resolved preset+variant
 *  groove — real corpus onsets, not a generated Euclidean stand-in.
 *  Thin resolver wrapper around `NecklaceRow` (the shared presentation
 *  piece the Drums editor also uses, for both preset and outline modes).
 *  For the whole-song, cross-section view of this same idea, see
 *  `components/drums/DrumsView.tsx`; this one stays scoped to a single
 *  section, right next to the picker that controls it. */
export default function DrumNecklacePreview({
  pattern,
  variantIndex,
}: {
  pattern: DrumPattern | undefined;
  variantIndex: number | undefined;
}) {
  if (!pattern) return null;
  return <NecklaceRow necklaces={resolveVoiceNecklaces(pattern, variantIndex)} />;
}
