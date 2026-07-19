import { useEffect, useState } from "react";
import { pitchClass } from "@music-theory/core";
import type { ScaleType, ChordQuality } from "@music-theory/core";
import { useSongStore } from "../../store/songStore";
import { updateSection } from "../../lib/sections";
import { chordFromDegree } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer, chordToFreqs } from "../../lib/harmony/audioPreview";
import KeySelector from "./KeySelector";
import ProgressionBuilder from "./ProgressionBuilder";
import ChordInspector from "./ChordInspector";
import PresetPicker from "./PresetPicker";
import HexWheel from "./HexWheel";

export default function HarmonyView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedChordId, setSelectedChordId] = useState<string | null>(null);

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  // Reset chord selection whenever the active section changes — a
  // selected-chord id from the previous section means nothing here.
  useEffect(() => {
    setSelectedChordId(null);
  }, [activeSection?.id]);

  const selectedChord = activeSection?.chords.find((c) => c.id === selectedChordId) ?? null;

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <KeySelector
        activeKey={song.key}
        activeScale={song.scale}
        onChangeKey={(key) => updateCurrentSong((s) => ({ ...s, key }))}
        onChangeScale={(scale: ScaleType) => updateCurrentSong((s) => ({ ...s, scale }))}
      />

      {song.sections.length === 0 ? (
        <p className="text-inkMuted text-sm">
          Add sections in the Structure tab first, then come back here to build chord progressions.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            {song.sections.map((section) => (
              <button
                key={section.id}
                className={`text-sm px-3 py-1 rounded border ${
                  activeSection?.id === section.id
                    ? "border-accent text-accent"
                    : "border-edge text-inkMuted hover:text-ink"
                }`}
                onClick={() => setSelectedSectionId(section.id)}
              >
                {section.name}
              </button>
            ))}
          </div>

          {activeSection && (
            <div className="grid grid-cols-[1fr_280px] gap-4">
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-inkMuted uppercase tracking-wide mb-1">Harmony wheel</p>
                  <HexWheel
                    keyName={song.key}
                    scale={song.scale}
                    usedDegrees={new Set(activeSection.chords.map((c) => c.romanNumeral))}
                    onSelectDegree={(degree, relativeRoot, quality) => {
                      const chord = chordFromDegree(
                        pitchClass(song.key),
                        song.key,
                        degree,
                        quality as ChordQuality,
                        relativeRoot,
                        activeSection.beatsPerChord,
                      );
                      updateCurrentSong((s) =>
                        updateSection(s, activeSection.id, (sec) => ({ ...sec, chords: [...sec.chords, chord] })),
                      );
                      getPreviewPlayer().playChord(chordToFreqs(chord), 1);
                    }}
                  />
                </div>

                <PresetPicker
                  keyName={song.key}
                  beatsPerChord={activeSection.beatsPerChord}
                  hasChords={activeSection.chords.length > 0}
                  sectionName={activeSection.name}
                  onApply={(chords) =>
                    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })))
                  }
                />

                {/* Keyed by section id so switching sections fully resets
                    play/selection state rather than leaving a stale "Stop"
                    button pointed at a progression that already stopped. */}
                <ProgressionBuilder
                  key={activeSection.id}
                  section={activeSection}
                  keyName={song.key}
                  scale={song.scale}
                  bpm={song.bpm}
                  selectedChordId={selectedChordId}
                  onSelectChord={setSelectedChordId}
                  onChangeChords={(chords) =>
                    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })))
                  }
                />
              </div>

              <div>
                <ChordInspector
                  chord={selectedChord}
                  keyName={song.key}
                  scale={song.scale}
                  onChange={(updated) =>
                    updateCurrentSong((s) =>
                      updateSection(s, activeSection.id, (sec) => ({
                        ...sec,
                        chords: sec.chords.map((c) => (c.id === updated.id ? updated : c)),
                      })),
                    )
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
