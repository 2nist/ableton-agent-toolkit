import { useSongStore } from "../../store/songStore";
import { removeSection, repeatsFor, updateRepeats, updateSection } from "../../lib/sections";
import type { BlueprintSection } from "../../types/blueprint";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import SectionEditor from "../structure/SectionEditor";
import FitStatus from "../harmony/FitStatus";
import { askConfirm } from "../../lib/confirm";

/**
 * Structure edits for the focused section, in the workspace rail
 * (docs/design/workspace.md: the rail is the focused object's panel).
 *
 * The fields themselves are `SectionEditor`'s — this panel only reads the
 * focused section out of the store, binds the writes, and adds the
 * progression-fit readout the rail has room for. Writes go through the same
 * `lib/sections` helpers the Structure page uses, so the two doors open into
 * one room and both stay undoable.
 */
export default function SectionStructurePanel() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);

  if (!currentSong) return null;
  const song = currentSong;
  const section: BlueprintSection | null =
    song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  if (!section) {
    return (
      <p className="text-2xs font-mono text-inkMuted/60 italic">
        No sections yet — add the first one with ＋ on the spine above (or mint a whole form from a map in the workbench's library).
      </p>
    );
  }

  const repeats = repeatsFor(song, section.id);
  /** Whether an outline (the harmony's own, or the drums' when the section
   *  follows them) drives chord timing — mirrors resolveChordOccurrences'
   *  precedence exactly. The fit readout below describes the per-chord-
   *  beats path only, so it's hidden while an outline is in charge (the
   *  outline readout further down covers that shape instead). */
  const outlineDriven = !!(
    section.harmonyMeterOutline ??
    (section.harmonyFollowsDrums === false ? null : section.drumMeterOutline)
  );
  const onChange = (updater: (s: BlueprintSection) => BlueprintSection) =>
    updateCurrentSong((s) => updateSection(s, section.id, updater));
  const onChangeRepeats = (n: number) => updateCurrentSong((s) => updateRepeats(s, section.id, n));
  const onDelete = async () => {
    if (!(await askConfirm({ title: "Delete section", message: `Delete "${section.name}"?`, confirmLabel: "Delete", danger: true }))) return;
    updateCurrentSong((s) => removeSection(s, section.id));
    setSelectedSectionId(null);
  };

  return (
    <SectionEditor
      density="rail"
      section={section}
      repeats={repeats}
      onChange={onChange}
      onChangeRepeats={onChangeRepeats}
      onDelete={() => void onDelete()}
      extra={
        <>
          {/* Progression-vs-length, honestly: the exact arithmetic the export
              loops the chord cell with (whole passes + partial tail), plus the
              one-click "make it a clean loop" action. Hidden in outline mode —
              the fit math describes the per-chord-beats path only. */}
          {!outlineDriven && (
            <FitStatus section={section} onSetBars={(bars) => onChange((s) => ({ ...s, bars }))} />
          )}
        </>
      }
    />
  );
}
