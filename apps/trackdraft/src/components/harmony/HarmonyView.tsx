import { useEffect, useState } from "react";
import { pitchClass, noteName } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { useSongStore } from "../../store/songStore";
import { updateSection } from "../../lib/sections";
import { parseToken, MODE_TO_SCALE_KEY, SCALE_INTERVALS } from "../../lib/harmony/honeycombWalk";
import HoneycombWheel from "./HoneycombWheel";
import ProgressionTrack from "./ProgressionTrack";
import FloatingToolbar from "./FloatingToolbar";
import ChordEditorPopover from "./ChordEditorPopover";

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
  // The one chord editor: which chord, and the viewport point to anchor beside.
  const [editor, setEditor] = useState<{ chordId: string; anchor: { x: number; y: number } } | null>(null);

  if (!currentSong) return null;
  const song = currentSong;

  const activeSection = song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  useEffect(() => {
    setSelectedChordId(null);
    setEditor(null);
  }, [activeSection?.id]);

  // A section can override the song's key/scale (modulation) — everything
  // downstream reads/writes against this effective value, never
  // song.key/song.scale directly, so a modulated section is edited correctly
  // without touching the song-wide default.
  const effectiveKey = activeSection?.key ?? song.key;
  const effectiveScale = activeSection?.scale ?? song.scale;

  const editorChord = editor ? activeSection?.chords.find((c) => c.id === editor.chordId) ?? null : null;

  function openEditor(chordId: string, anchor: { x: number; y: number }) {
    setSelectedChordId(chordId);
    setEditor({ chordId, anchor });
  }

  function updateChords(chords: Chord[]) {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, chords })));
  }

  function setSectionBars(bars: number) {
    if (!activeSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, (sec) => ({ ...sec, bars })));
  }

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

  if (song.sections.length === 0) {
    return (
      <div className="p-6 max-w-5xl">
        <p className="text-inkMuted text-sm">
          Add sections in the Structure tab first, then come back here to build chord progressions.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl space-y-4">
      {/* Hex canvas with its floating, collapsible controls overlaid */}
      <div className="relative border border-edge rounded-lg bg-[#0e1218] overflow-hidden min-h-[420px]">
        <FloatingToolbar
          songKey={song.key}
          songScale={song.scale}
          onChangeSongKey={(key) => updateCurrentSong((s) => ({ ...s, key }))}
          onChangeSongScale={(scale) => updateCurrentSong((s) => ({ ...s, scale }))}
          presetKeyName={effectiveKey}
          beatsPerChord={activeSection?.beatsPerChord ?? 4}
          hasChords={(activeSection?.chords.length ?? 0) > 0}
          sectionName={activeSection?.name ?? ""}
          onApplyPreset={updateChords}
          sectionKeyOverride={activeSection?.key}
          sectionScaleOverride={activeSection?.scale}
          onRekeySection={handleRekey}
        />
        <div className="flex justify-center p-4 pt-6">
          {activeSection && (
            <HoneycombWheel
              keyName={effectiveKey}
              scale={effectiveScale}
              chords={activeSection.chords}
              beatsPerChord={activeSection.beatsPerChord}
              selectedChordId={selectedChordId}
              onSelectChord={setSelectedChordId}
              onEditChord={openEditor}
              onChangeChords={updateChords}
            />
          )}
        </div>
      </div>

      {/* One framed panel: three aligned tracks — sections / progression / effects */}
      {activeSection && (
        <div className="border border-edge rounded-lg bg-panel overflow-hidden">
          <div className="grid grid-cols-[96px_1fr] items-stretch">
            <div className="flex flex-col items-end justify-center gap-0.5 px-3 border-r border-edge">
              <span className="font-mono text-[9px] uppercase tracking-wider text-inkMuted">Sections</span>
              <span className="font-mono text-[8.5px] text-inkMuted/70">{song.sections.length}</span>
            </div>
            <div className="px-3 py-2 overflow-x-auto">
              <div className="flex gap-1 flex-wrap">
                {song.sections.map((section) => (
                  <button
                    key={section.id}
                    className={`font-mono text-[11px] whitespace-nowrap rounded-[5px] border px-2.5 py-1 ${
                      activeSection.id === section.id
                        ? "border-accent text-accent bg-accent/10"
                        : "border-edge text-inkMuted hover:text-ink hover:border-inkMuted"
                    }`}
                    onClick={() => setSelectedSectionId(section.id)}
                  >
                    {section.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ProgressionTrack
            key={activeSection.id}
            section={activeSection}
            keyName={effectiveKey}
            scale={effectiveScale}
            bpm={song.bpm}
            selectedChordId={selectedChordId}
            onEditChord={openEditor}
            onChangeChords={updateChords}
            onSetBars={setSectionBars}
          />
        </div>
      )}

      {activeSection && editorChord && editor && (
        <ChordEditorPopover
          chord={editorChord}
          keyName={effectiveKey}
          scale={effectiveScale}
          anchor={editor.anchor}
          onChange={(updated) =>
            updateChords(activeSection.chords.map((c) => (c.id === updated.id ? updated : c)))
          }
          onRemove={() => {
            updateChords(activeSection.chords.filter((c) => c.id !== editorChord.id));
            setEditor(null);
            setSelectedChordId(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
