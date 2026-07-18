import { pitchClass } from "@music-theory/core";
import type { ScaleType, NoteName } from "@music-theory/core";
import type { BlueprintSection, Chord } from "../../types/blueprint";
import { getDiatonicOptions, chordDisplayName, chordFromDegree } from "../../lib/harmony/chordBuilder";
import ChordCard from "./ChordCard";

interface ProgressionBuilderProps {
  section: BlueprintSection;
  keyName: NoteName;
  scale: ScaleType;
  onChangeChords: (chords: Chord[]) => void;
}

export default function ProgressionBuilder({ section, keyName, scale, onChangeChords }: ProgressionBuilderProps) {
  const keyPc = pitchClass(keyName);
  const diatonicOptions = getDiatonicOptions(scale);

  function addChord(option: ReturnType<typeof getDiatonicOptions>[number]) {
    const chord = chordFromDegree(keyPc, keyName, option.degree, option.quality, option.root, section.beatsPerChord);
    onChangeChords([...section.chords, chord]);
  }

  function updateChord(index: number, updated: Chord) {
    onChangeChords(section.chords.map((c, i) => (i === index ? updated : c)));
  }

  function removeChord(index: number) {
    onChangeChords(section.chords.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-inkMuted uppercase tracking-wide mb-1">
          Diatonic chords — click to add to {section.name}
        </p>
        <div className="flex flex-wrap gap-2">
          {diatonicOptions.map((opt) => (
            <button
              key={opt.degree}
              className={`text-xs border rounded px-2 py-1 ${
                opt.isBorrowed
                  ? "border-accent/50 text-accent hover:bg-accent/10"
                  : "border-edge text-inkMuted hover:bg-panelAlt hover:text-ink"
              }`}
              title={opt.func}
              onClick={() => addChord(opt)}
            >
              {opt.degree} · {chordDisplayName((keyPc + opt.root) % 12, opt.quality, keyName)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-inkMuted uppercase tracking-wide mb-1">Progression</p>
        {section.chords.length === 0 ? (
          <p className="text-sm text-inkMuted">No chords yet — add some from the palette above.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {section.chords.map((chord, i) => (
              <ChordCard
                key={chord.id}
                chord={chord}
                keyName={keyName}
                onChange={(updated) => updateChord(i, updated)}
                onRemove={() => removeChord(i)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
