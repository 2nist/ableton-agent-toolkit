import { useMemo } from "react";
import type { SectionSpan } from "../../../lib/arrangement";
import type { BlueprintSong } from "../../../types/blueprint";
import { planColorStem } from "../../../lib/colorStem";
import StemFace from "./StemFace";
import { usePalette } from "../../../theme/palette";

/** The color layer's arrangement face: the bi-tonal Color Chord notes that
 *  sit above the block chords, for this section's pass. Flavor and register
 *  come from the row's controls (`colorFlavor` / `colorOctave`). */
export default function ColorFace({
  section,
  song,
  span,
  onOpen,
}: {
  section: SectionSpan["section"];
  song: BlueprintSong;
  span: SectionSpan;
  onOpen: () => void;
}) {
  const P = usePalette();
  const { startBeat } = span;
  const notes = useMemo(
    () =>
      planColorStem([span], song).map((note) => ({
        ...note,
        startTime: note.startTime - startBeat,
      })),
    // See BassFace: the span object churns, the numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, song, startBeat, span.durationBeats],
  );

  return (
    <StemFace
      notes={notes}
      color={P.hues[5].rim}
      empty="No color notes — pick a flavor, or add chords for it to sit above."
      onOpen={onOpen}
    />
  );
}
