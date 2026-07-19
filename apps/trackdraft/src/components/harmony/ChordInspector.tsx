import { pitchClass, noteName } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { getSubstitutionMenu } from "../../lib/harmony/substitutions";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer, chordToFreqs } from "../../lib/harmony/audioPreview";

interface ChordInspectorProps {
  chord: Chord | null;
  keyName: NoteName;
  scale: ScaleType;
  onChange: (chord: Chord) => void;
}

/** The substitution menu for the selected chord: mode-aware suggestions
 *  (with their theoretical explanation), the two chromatic transforms, and
 *  every borrowed-chord candidate for the scale. Replaces the old 2-option
 *  popover on ChordCard — there's no room to show explanations in a card
 *  that small. */
export default function ChordInspector({ chord, keyName, scale, onChange }: ChordInspectorProps) {
  if (!chord) {
    return (
      <div className="border border-edge rounded bg-panel p-3">
        <p className="text-xs text-inkMuted uppercase tracking-wide mb-1">Substitutions</p>
        <p className="text-sm text-inkMuted">Select a chord to see substitutions.</p>
      </div>
    );
  }

  const keyPc = pitchClass(keyName);
  const rootPc = pitchClass(chord.root);
  const menu = getSubstitutionMenu(scale, chord.romanNumeral, rootPc);
  const isNonDiatonic = menu.modeAware.length === 0;

  function auditionAndApply(next: Chord) {
    onChange(next);
    getPreviewPlayer().playChord(chordToFreqs(next), 1);
  }

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-3">
      <div>
        <p className="text-xs text-inkMuted uppercase tracking-wide">Substitutions for</p>
        <p className="font-medium">{chord.romanNumeral} · {chordDisplayName(rootPc, chord.quality, keyName)}</p>
      </div>

      {isNonDiatonic && (
        <p className="text-[11px] text-inkMuted">
          No mode-aware substitutions for a non-diatonic chord — chromatic and borrowed options still apply.
        </p>
      )}

      {menu.modeAware.length > 0 && (
        <div>
          <p className="text-[11px] text-inkMuted uppercase tracking-wide mb-1">Mode subs</p>
          <div className="space-y-1">
            {menu.modeAware.map((sub) => (
              <button
                key={sub.degreeLabel}
                className="block w-full text-left hover:bg-panelAlt px-2 py-1 rounded text-xs"
                onClick={() =>
                  auditionAndApply({
                    ...chord,
                    root: noteName((keyPc + sub.root) % 12, keyName),
                    quality: sub.quality,
                    romanNumeral: sub.degreeLabel,
                    isSubstitution: true,
                    substitutedFrom: chord.romanNumeral,
                  })
                }
              >
                <span className="font-medium">
                  {sub.degreeLabel} · {chordDisplayName((keyPc + sub.root) % 12, sub.quality, keyName)}
                </span>
                <span className="block text-inkMuted text-[10px]">{sub.explanation}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] text-inkMuted uppercase tracking-wide mb-1">Chromatic</p>
        <div className="space-y-1">
          {menu.chromatic.map((sub) => (
            <button
              key={sub.label}
              className="block w-full text-left hover:bg-panelAlt px-2 py-1 rounded text-xs"
              onClick={() =>
                auditionAndApply({
                  ...chord,
                  root: noteName(sub.root, keyName),
                  quality: sub.quality,
                  isSubstitution: true,
                  substitutedFrom: chord.romanNumeral,
                })
              }
            >
              <span className="font-medium">{sub.label} — {chordDisplayName(sub.root, sub.quality, keyName)}</span>
              <span className="block text-inkMuted text-[10px]">{sub.explanation}</span>
            </button>
          ))}
        </div>
      </div>

      {menu.borrowed.length > 0 && (
        <div>
          <p className="text-[11px] text-inkMuted uppercase tracking-wide mb-1">Borrowed</p>
          <div className="flex flex-wrap gap-1">
            {menu.borrowed.map((candidate) => (
              <button
                key={`${candidate.sourceMode}-${candidate.degree}`}
                className="text-[11px] border border-accent/50 text-accent rounded px-2 py-1 hover:bg-accent/10"
                title={`from ${candidate.sourceMode}`}
                onClick={() =>
                  auditionAndApply({
                    ...chord,
                    root: noteName((keyPc + candidate.root) % 12, keyName),
                    quality: candidate.triad,
                    romanNumeral: candidate.degree,
                    isSubstitution: true,
                    substitutedFrom: chord.romanNumeral,
                  })
                }
              >
                {candidate.degree} · {chordDisplayName((keyPc + candidate.root) % 12, candidate.triad, keyName)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
