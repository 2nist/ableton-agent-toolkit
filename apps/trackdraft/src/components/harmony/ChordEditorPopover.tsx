import { pitchClass, noteName } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord } from "../../types/blueprint";
import { getSubstitutionMenu } from "../../lib/harmony/substitutions";
import { chordDisplayName, CHORD_QUALITIES } from "../../lib/harmony/chordBuilder";

// Chromatic subs (tritone/secondary-dominant) aren't diatonic, so there's no
// scale degree to label them with — derive a key-relative roman numeral from
// the semitone offset, matching honeycombWalk's chromatic degree convention.
const CHROMATIC_DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
function chromaticDegreeLabel(keyPc: number, rootPc: number): string {
  return CHROMATIC_DEGREES[(((rootPc - keyPc) % 12) + 12) % 12];
}

interface ChordEditorPopoverProps {
  chord: Chord;
  keyName: NoteName;
  scale: ScaleType;
  onChange: (chord: Chord) => void;
  onRemove: () => void;
  /** Deselects the chord — the dock falls back to song/section controls. */
  onDeselect: () => void;
}

/** The selected chord's editor — the dock's "tools" content whenever a chord
 *  is selected (HoneycombWheel or ProgressionEditor). The right menu reads
 *  top-to-bottom: selection/remove → Beats → Quality → Substitutions.
 *  Performance effects are edited in the progression's effect row instead
 *  (each chord's own effect slot). Substitution options are compact chips
 *  with their theory explanation moved to a `title` tooltip. */
export default function ChordEditorPopover({
  chord,
  keyName,
  scale,
  onChange,
  onRemove,
  onDeselect,
}: ChordEditorPopoverProps) {
  const keyPc = pitchClass(keyName);
  const rootPc = pitchClass(chord.root);
  const menu = getSubstitutionMenu(scale, chord.romanNumeral, rootPc);
  const isNonDiatonic = menu.modeAware.length === 0;

  return (
    <div className="p-2 text-xs h-full flex flex-col gap-2">
      <div className="flex items-baseline justify-between shrink-0">
        <div className="flex items-center gap-1">
          <p className="font-medium text-sm">
            {chord.romanNumeral}
            <span className="text-inkMuted font-normal ml-1.5">
              {chordDisplayName(rootPc, chord.quality, keyName)}
            </span>
          </p>
          <button
            className="w-5 h-5 rounded border border-edge text-[10px] text-inkMuted hover:text-ink hover:border-inkMuted font-mono leading-none flex items-center justify-center"
            title="Flatten root (♭)"
            onClick={() => {
              const newRootPc = ((rootPc - 1) % 12 + 12) % 12;
              onChange({
                ...chord,
                root: noteName(newRootPc, keyName),
                romanNumeral: chromaticDegreeLabel(keyPc, newRootPc),
                isSubstitution: true,
                substitutedFrom: chord.romanNumeral,
              });
            }}
          >
            −
          </button>
          <button
            className="w-5 h-5 rounded border border-edge text-[10px] text-inkMuted hover:text-ink hover:border-inkMuted font-mono leading-none flex items-center justify-center"
            title="Sharpen root (♯)"
            onClick={() => {
              const newRootPc = (rootPc + 1) % 12;
              onChange({
                ...chord,
                root: noteName(newRootPc, keyName),
                romanNumeral: chromaticDegreeLabel(keyPc, newRootPc),
                isSubstitution: true,
                substitutedFrom: chord.romanNumeral,
              });
            }}
          >
            +
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="text-[11px] text-inkMuted hover:text-red-400" onClick={onRemove}>
            Remove chord
          </button>
          <button className="text-inkMuted hover:text-ink" onClick={onDeselect} aria-label="Deselect">✕</button>
        </div>
      </div>

      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
        {/* Beats */}
        <div>
          <p className="text-3xs text-inkMuted uppercase tracking-wide mb-1">Beats</p>
          <div className="flex items-center gap-1.5">
            <button
              className="w-5 h-5 rounded border border-edge text-inkMuted hover:text-ink"
              onClick={() => onChange({ ...chord, beats: Math.max(0.5, chord.beats - 0.5) })}
            >
              –
            </button>
            <span className="font-mono text-2xs min-w-[46px] text-center">{chord.beats} beats</span>
            <button
              className="w-5 h-5 rounded border border-edge text-inkMuted hover:text-ink"
              onClick={() => onChange({ ...chord, beats: chord.beats + 0.5 })}
            >
              +
            </button>
          </div>
        </div>

        {/* Quality */}
        <div>
          <p className="text-3xs text-inkMuted uppercase tracking-wide mb-1">Quality</p>
          <div className="flex flex-wrap gap-1">
            {CHORD_QUALITIES.map((q) => (
              <button
                key={q}
                className={`font-mono text-2xs rounded px-1.5 py-0.5 border ${
                  chord.quality === q
                    ? "border-accent text-accent bg-accent/10"
                    : "border-edge text-inkMuted hover:text-ink"
                }`}
                onClick={() => onChange({ ...chord, quality: q, extendedSuffix: undefined })}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Substitutions */}
        <div>
          <p className="text-3xs text-inkMuted uppercase tracking-wide mb-1">Substitutions</p>
          {isNonDiatonic && (
            <p className="text-3xs text-inkMuted mb-1">Non-diatonic — chromatic/borrowed still apply.</p>
          )}
          <div className="flex flex-wrap gap-1">
            {menu.modeAware.map((sub) => (
              <button
                key={sub.degreeLabel}
                className="text-2xs border border-edge rounded px-1.5 py-0.5 hover:bg-panelAlt hover:border-inkMuted"
                title={sub.explanation}
                onClick={() =>
                  onChange({
                    ...chord,
                    root: noteName((keyPc + sub.root) % 12, keyName),
                    quality: sub.quality,
                    romanNumeral: sub.degreeLabel,
                    isSubstitution: true,
                    substitutedFrom: chord.romanNumeral,
                  })
                }
              >
                {sub.degreeLabel} · {chordDisplayName((keyPc + sub.root) % 12, sub.quality, keyName)}
              </button>
            ))}
            {menu.chromatic.map((sub) => (
              <button
                key={sub.label}
                className="text-2xs border border-edge rounded px-1.5 py-0.5 hover:bg-panelAlt hover:border-inkMuted"
                title={sub.explanation}
                onClick={() =>
                  onChange({
                    ...chord,
                    root: noteName(sub.root, keyName),
                    quality: sub.quality,
                    romanNumeral: chromaticDegreeLabel(keyPc, sub.root),
                    isSubstitution: true,
                    substitutedFrom: chord.romanNumeral,
                  })
                }
              >
                {sub.label} — {chordDisplayName(sub.root, sub.quality, keyName)}
              </button>
            ))}
            {menu.borrowed.map((candidate) => (
              <button
                key={`${candidate.sourceMode}-${candidate.degree}`}
                className="text-2xs border border-accent/50 text-accent rounded px-1.5 py-0.5 hover:bg-accent/10"
                title={`from ${candidate.sourceMode}`}
                onClick={() =>
                  onChange({
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
      </div>
    </div>
  );
}
