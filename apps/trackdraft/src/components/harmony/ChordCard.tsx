import { useState } from "react";
import { pitchClass, noteName } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { tritoneSubstitution, secondaryDominant } from "../../lib/harmony/substitutions";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import type { NoteName } from "@music-theory/core";

interface ChordCardProps {
  chord: Chord;
  keyName: NoteName;
  onChange: (chord: Chord) => void;
  onRemove: () => void;
}

export default function ChordCard({ chord, keyName, onChange, onRemove }: ChordCardProps) {
  const [showSubs, setShowSubs] = useState(false);
  const rootPc = pitchClass(chord.root);

  function applySub(_label: string, root: number, quality: Chord["quality"]) {
    onChange({
      ...chord,
      root: noteName(root, keyName),
      quality,
      isSubstitution: true,
      substitutedFrom: chord.romanNumeral,
    });
    setShowSubs(false);
  }

  const displayName = chordDisplayName(rootPc, chord.quality, keyName);

  return (
    <div className="relative border border-edge rounded bg-panelAlt px-3 py-2 min-w-[84px] text-center">
      <div className="text-xs text-inkMuted">{chord.romanNumeral}</div>
      <div className="font-medium">{displayName}</div>
      <div className="text-[10px] text-inkMuted">{chord.beats} beats</div>
      {chord.isSubstitution && (
        <div className="text-[10px] text-accent">sub of {chord.substitutedFrom}</div>
      )}

      <div className="flex justify-center gap-1 mt-1">
        <button
          className="text-[10px] text-inkMuted hover:text-ink"
          onClick={() => setShowSubs((v) => !v)}
        >
          subs
        </button>
        <button
          className="text-[10px] text-inkMuted hover:text-red-400"
          onClick={onRemove}
        >
          ✕
        </button>
      </div>

      {showSubs && (
        <div className="absolute z-10 top-full left-0 mt-1 bg-panel border border-edge rounded shadow-lg p-2 text-xs text-left w-52 space-y-1">
          {(() => {
            const tritone = tritoneSubstitution(rootPc);
            const secDom = secondaryDominant(rootPc);
            return (
              <>
                <button
                  className="block w-full text-left hover:bg-panelAlt px-1 py-1 rounded"
                  onClick={() => applySub(tritone.label, tritone.root, tritone.quality)}
                >
                  <span className="font-medium">{tritone.label}</span>
                  <span className="text-inkMuted"> — {chordDisplayName(tritone.root, tritone.quality, keyName)}</span>
                </button>
                <button
                  className="block w-full text-left hover:bg-panelAlt px-1 py-1 rounded"
                  onClick={() => applySub(secDom.label, secDom.root, secDom.quality)}
                >
                  <span className="font-medium">{secDom.label}</span>
                  <span className="text-inkMuted"> — {chordDisplayName(secDom.root, secDom.quality, keyName)}</span>
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
