import { useEffect, useState } from "react";
import { pitchClass, noteName, KEY_ROOTS } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { useSongStore } from "../../store/songStore";
import { updateSection } from "../../lib/sections";
import { parseToken, MODE_TO_SCALE_KEY, SCALE_INTERVALS } from "../../lib/harmony/honeycombWalk";
import KeySelector from "./KeySelector";
import ProgressionBuilder from "./ProgressionBuilder";
import ChordInspector from "./ChordInspector";
import PresetPicker from "./PresetPicker";
import HoneycombWheel from "./HoneycombWheel";

const SCALES: ScaleType[] = ["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];

/** Re-roots a section's chords to a new key/scale — root pitch only,
 *  preserving each chord's authored quality/roman-numeral label so a
 *  deliberate substitution isn't silently overwritten by a key change.
 *  Unparseable roman numerals (shouldn't normally happen) are left
 *  untouched rather than guessed at. */
function transposeChords(chords: Chord[], newKeyPc: number, newKeyName: NoteName, newScale: ScaleType): Chord[] {
  const scaleKey = MODE_TO_SCALE_KEY[newScale as keyof typeof MODE_TO_SCALE_KEY] ?? "major";
  const intervals = SCALE_INTERVALS[scaleKey];
  return chords.map((c) => {
    const step = parseToken(c.romanNumeral);
    if (!step) return c;
    const rootPc = ((newKeyPc + intervals[step.deg] + step.acc) % 12 + 12) % 12;
    return { ...c, root: noteName(rootPc, newKeyName) };
  });
}

export default function HarmonyView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedChordId, setSelectedChordId] = useState<string | null>(null);

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  useEffect(() => {
    setSelectedChordId(null);
  }, [activeSection?.id]);

  const selectedChord = activeSection?.chords.find((c) => c.id === selectedChordId) ?? null;

  // A section can override the song's key/scale (modulation) — everything
  // downstream of the tab strip reads/writes against this effective value,
  // never song.key/song.scale directly, so a modulated section is edited
  // correctly without touching the song-wide default.
  const effectiveKey = activeSection?.key ?? song.key;
  const effectiveScale = activeSection?.scale ?? song.scale;

  function handleRekey(newKey: NoteName | undefined, newScale: ScaleType | undefined) {
    if (!activeSection) return;
    const resolvedKey = newKey ?? song.key;
    const resolvedScale = newScale ?? song.scale;
    updateCurrentSong((s) =>
      updateSection(s, activeSection.id, (sec) => ({
        ...sec,
        key: newKey,
        scale: newScale,
        chords: transposeChords(sec.chords, pitchClass(resolvedKey), resolvedKey, resolvedScale),
      })),
    );
  }

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
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-inkMuted uppercase tracking-wide">Harmony wheel</p>
                    <div className="flex items-center gap-1 text-xs text-inkMuted">
                      <span>Section key:</span>
                      <select
                        className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
                        value={activeSection.key ?? ""}
                        onChange={(e) => handleRekey(e.target.value || undefined, activeSection.scale)}
                        title="Override this section's key — modulates it independently of the song key, transposing its chords"
                      >
                        <option value="">(song: {song.key})</option>
                        {KEY_ROOTS.map((k) => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                      <select
                        className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
                        value={activeSection.scale ?? ""}
                        onChange={(e) => handleRekey(activeSection.key, (e.target.value || undefined) as ScaleType | undefined)}
                        title="Override this section's mode"
                      >
                        <option value="">(song: {song.scale})</option>
                        {SCALES.map((sc) => (
                          <option key={sc} value={sc}>{sc}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <HoneycombWheel
                    keyName={effectiveKey}
                    scale={effectiveScale}
                    chords={activeSection.chords}
                    beatsPerChord={activeSection.beatsPerChord}
                    selectedChordId={selectedChordId}
                    onSelectChord={setSelectedChordId}
                    onChangeChords={(chords) =>
                      updateCurrentSong((s) =>
                        updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })),
                      )
                    }
                  />
                </div>

                <PresetPicker
                  keyName={effectiveKey}
                  beatsPerChord={activeSection.beatsPerChord}
                  hasChords={activeSection.chords.length > 0}
                  sectionName={activeSection.name}
                  onApply={(chords) =>
                    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })))
                  }
                />

                <ProgressionBuilder
                  key={activeSection.id}
                  section={activeSection}
                  keyName={effectiveKey}
                  scale={effectiveScale}
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
                  keyName={effectiveKey}
                  scale={effectiveScale}
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
