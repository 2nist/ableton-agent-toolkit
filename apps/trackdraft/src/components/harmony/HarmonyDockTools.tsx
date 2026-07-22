import { pitchClass, NOTE_TO_PC } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { useSongStore } from "../../store/songStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { updateSection } from "../../lib/sections";
import { transposeChords } from "../../lib/harmony/honeycombWalk";
import FloatingToolbar from "./FloatingToolbar";
import ChordEditorPopover from "./ChordEditorPopover";
import InstrumentPanel from "./InstrumentPanel";

/** The Harmony tab's dock content — registered once by HarmonyView and
 *  fully self-sufficient from there (reads `useSongStore` +
 *  `useHarmonySelectionStore` directly, the same way `SongInfoPanel` reads
 *  `useSongStore` directly), so it re-renders on its own whenever the
 *  song or selection changes rather than HarmonyView having to push
 *  freshly-computed JSX into the dock on every change. Shows the selected
 *  chord's editor when one is selected; otherwise song/section key+scale
 *  and progression presets — the same "select something, see its tools,
 *  otherwise see general settings" split as Ableton's Device Chain. */
export default function HarmonyDockTools() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useHarmonySelectionStore((s) => s.selectedSectionId);
  const selectedChordId = useHarmonySelectionStore((s) => s.selectedChordId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);

  if (!currentSong) return null;
  const song = currentSong;
  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;
  if (!activeSection) return null;

  const rawKey = activeSection.key ?? song.key;
  const effectiveKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const effectiveScale = activeSection.scale ?? song.scale;

  function updateChords(chords: Chord[]) {
    updateCurrentSong((s) => updateSection(s, activeSection!.id, (sec) => ({ ...sec, chords })));
  }

  function handleRekey(newKey: NoteName | undefined, newScale: ScaleType | undefined) {
    const rawResolvedKey = newKey ?? song.key;
    const resolvedKey: NoteName = rawResolvedKey in NOTE_TO_PC ? (rawResolvedKey as NoteName) : "C";
    const resolvedScale = newScale ?? song.scale;
    updateCurrentSong((s) =>
      updateSection(s, activeSection!.id, (sec) => ({
        ...sec,
        key: newKey,
        scale: newScale,
        chords: transposeChords(sec.chords, pitchClass(resolvedKey), resolvedKey, resolvedScale),
      })),
    );
  }

  const editorChord = selectedChordId ? activeSection.chords.find((c) => c.id === selectedChordId) ?? null : null;

  return (
    <div className="flex flex-col">
      {/* Playback-wide, not song data — stays visible across both branches
         below rather than living inside either one, so switching voices
         mid-edit doesn't require deselecting the chord you're working on. */}
      <div className="p-3 border-b border-edge">
        <InstrumentPanel />
      </div>
      {editorChord ? (
        <ChordEditorPopover
          chord={editorChord}
          keyName={effectiveKey}
          scale={effectiveScale}
          onChange={(updated) => updateChords(activeSection!.chords.map((c) => (c.id === updated.id ? updated : c)))}
          onRemove={() => {
            updateChords(activeSection!.chords.filter((c) => c.id !== editorChord.id));
            setSelectedChordId(null);
          }}
          onDeselect={() => setSelectedChordId(null)}
        />
      ) : (
        <FloatingToolbar
          songKey={song.key}
          songScale={song.scale}
          onChangeSongKey={(key) => updateCurrentSong((s) => ({ ...s, key: key as NoteName }))}
          onChangeSongScale={(scale) => updateCurrentSong((s) => ({ ...s, scale }))}
          presetKeyName={effectiveKey}
          beatsPerChord={activeSection.beatsPerChord}
          hasChords={activeSection.chords.length > 0}
          sectionName={activeSection.name}
          onApplyPreset={updateChords}
          sectionKeyOverride={activeSection.key}
          sectionScaleOverride={activeSection.scale}
          onRekeySection={handleRekey}
        />
      )}
    </div>
  );
}
