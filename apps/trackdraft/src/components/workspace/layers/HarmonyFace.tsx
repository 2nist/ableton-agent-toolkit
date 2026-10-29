import { pitchClass } from "@music-theory/core";
import type { NoteName } from "@music-theory/core";
import type { BlueprintSection, BlueprintSong } from "../../../types/blueprint";
import { chordDisplayName } from "../../../lib/harmony/chordBuilder";
import { useSectionOccurrences } from "../../../hooks/useActiveChord";
import { FaceFrame, useSectionGrid } from "./LayerGrid";

/** The harmony layer's arrangement face: the progression as it will play,
 *  positioned on the shared section grid. Clicking a chord selects it and
 *  selects its beat span, so the drums/melody rows highlight the same time. */
export default function HarmonyFace({
  section,
  song,
  keyName,
  selectedChordId,
  activeChordId,
  onSelectChord,
  onOpen,
}: {
  section: BlueprintSection;
  song: BlueprintSong | null;
  keyName: NoteName;
  selectedChordId: string | null;
  activeChordId: string | null;
  onSelectChord: (chordId: string) => void;
  onOpen: () => void;
}) {
  const { durationBeats, beatsPerBar, barPx, setRange } = useSectionGrid();
  // The styled, narrative-aware resolution — the same one the playback
  // highlight uses. Drawing from a plain resolution put the boxes on a
  // different grid than the highlight whenever the style re-timed the cycle.
  const occurrences = useSectionOccurrences(section, song, durationBeats);

  if (occurrences.length === 0) {
    return (
      <FaceFrame height={44}>
        <p className="absolute inset-0 flex items-center justify-center text-2xs font-mono italic text-inkMuted/50">
          No chords yet — add a progression in the harmony editor.
        </p>
      </FaceFrame>
    );
  }

  return (
    <FaceFrame height={44}>
      {occurrences.map((occurrence, index) => {
        const left = (occurrence.startTime / beatsPerBar) * barPx;
        const width = Math.max(3, (occurrence.duration / beatsPerBar) * barPx - 1);
        const selected = occurrence.chord.id === selectedChordId;
        const active = occurrence.chord.id === activeChordId;
        const showName = width >= 44;
        const showRoman = width >= 14;
        const name = chordDisplayName(
          pitchClass(occurrence.chord.root),
          occurrence.chord.quality,
          keyName,
        );
        return (
          <button
            key={`${occurrence.chord.id}-${index}`}
            type="button"
            className={`absolute top-1 bottom-1 z-20 overflow-hidden rounded-sm border px-1 text-left ${
              selected
                ? "border-accent bg-accent/20 ring-1 ring-accent"
                : active
                  ? "border-accent/60 bg-accent/10"
                  : "border-edge/70 bg-panelAlt hover:border-inkMuted"
            }`}
            style={{ left, width }}
            title={`${occurrence.chord.romanNumeral} — ${name} (${occurrence.duration} beats)`}
            onClick={() => {
              onSelectChord(occurrence.chord.id);
              setRange(occurrence.startTime, occurrence.startTime + occurrence.duration);
            }}
            onDoubleClick={onOpen}
          >
            {showRoman && (
              <span className="block truncate text-[9px] font-mono leading-none text-inkMuted/80">
                {occurrence.chord.romanNumeral}
              </span>
            )}
            {showName && (
              <span className="block truncate text-[10px] font-medium leading-tight text-ink">{name}</span>
            )}
          </button>
        );
      })}
    </FaceFrame>
  );
}
