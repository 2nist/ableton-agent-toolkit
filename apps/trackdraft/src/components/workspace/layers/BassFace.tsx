import { useMemo } from "react";
import type { SectionSpan } from "../../../lib/arrangement";
import type { BlueprintSong } from "../../../types/blueprint";
import { planBassStem } from "../../../lib/midiExport";
import StemFace from "./StemFace";

/** The bass layer's arrangement face: the line the exporter and live MIDI
 *  out will actually play, for this section's pass. Shape comes from the
 *  row's controls (`bassProfile`); this only shows the result. */
export default function BassFace({
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
  const { startBeat } = span;
  const notes = useMemo(
    () =>
      planBassStem([span], song).map((note) => ({
        ...note,
        startTime: note.startTime - startBeat,
      })),
    // `span` is rebuilt every render by the arrangement pass; the planner
    // only needs these numbers from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, song, startBeat, span.durationBeats],
  );

  return (
    <StemFace
      notes={notes}
      color="#5B84C4"
      empty="No bass line yet — the row below shapes one from the chords."
      onOpen={onOpen}
    />
  );
}
