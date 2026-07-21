import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { pitchClass, noteName } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord, ChordPerformanceEffect } from "../../types/blueprint";
import { getSubstitutionMenu } from "../../lib/harmony/substitutions";
import { chordDisplayName, CHORD_QUALITIES } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer } from "../../lib/harmony/audioPreview";

// Chromatic subs (tritone/secondary-dominant) aren't diatonic, so there's no
// scale degree to label them with — derive a key-relative roman numeral from
// the semitone offset, matching honeycombWalk's chromatic degree convention.
const CHROMATIC_DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
function chromaticDegreeLabel(keyPc: number, rootPc: number): string {
  return CHROMATIC_DEGREES[(((rootPc - keyPc) % 12) + 12) % 12];
}

const PERFORMANCE_STYLES: ChordPerformanceEffect["style"][] = ["strum", "pulse", "legato"];

interface ChordEditorPopoverProps {
  chord: Chord;
  keyName: NoteName;
  scale: ScaleType;
  /** Viewport point to anchor the panel beside (usually the top-centre of the
   *  clicked hex or chord cell). The panel positions itself to the right, then
   *  flips left / clamps vertically to stay on screen. */
  anchor: { x: number; y: number };
  onChange: (chord: Chord) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** The single per-chord editor — opened from a hex, a progression cell, or an
 *  effect-lane slot, always the same panel anchored beside the click. Replaces
 *  the old split between ChordCard's inline "edit…" dropdown and the pinned
 *  ChordInspector rail, so there's exactly one place a chord's quality,
 *  duration, performance, and substitution are mutated. */
export default function ChordEditorPopover({
  chord,
  keyName,
  scale,
  anchor,
  onChange,
  onRemove,
  onClose,
}: ChordEditorPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const keyPc = pitchClass(keyName);
  const rootPc = pitchClass(chord.root);
  const menu = getSubstitutionMenu(scale, chord.romanNumeral, rootPc);
  const isNonDiatonic = menu.modeAware.length === 0;

  // Anchor beside the click, flipping / clamping to stay within the viewport.
  useLayoutEffect(() => {
    const eln = ref.current;
    if (!eln) return;
    const { width, height } = eln.getBoundingClientRect();
    const gap = 16;
    let left = anchor.x + gap;
    if (left + width > window.innerWidth - 8) left = anchor.x - width - gap;
    if (left < 8) left = 8;
    let top = anchor.y - 24;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [anchor.x, anchor.y, chord.id, menu.modeAware.length]);

  // Dismiss on Escape or a click outside the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  function auditionAndApply(next: Chord) {
    onChange(next);
    getPreviewPlayer().playChordObject(next, 1);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Edit ${chord.romanNumeral}`}
      className="fixed z-50 w-[248px] bg-panel border border-accent rounded-lg shadow-2xl p-3 space-y-3 text-xs"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
    >
      <div className="flex items-baseline justify-between">
        <p className="font-medium text-sm">
          {chord.romanNumeral}
          <span className="text-inkMuted font-normal ml-1.5">
            {chordDisplayName(rootPc, chord.quality, keyName)}
          </span>
        </p>
        <button className="text-inkMuted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {/* Substitutions */}
      <div>
        <p className="text-[10px] text-inkMuted uppercase tracking-wide mb-1">Substitutions</p>
        {isNonDiatonic && (
          <p className="text-[11px] text-inkMuted mb-1">
            Non-diatonic chord — chromatic and borrowed options still apply.
          </p>
        )}
        {menu.modeAware.map((sub) => (
          <button
            key={sub.degreeLabel}
            className="block w-full text-left hover:bg-panelAlt px-2 py-1 rounded"
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
        {menu.chromatic.map((sub) => (
          <button
            key={sub.label}
            className="block w-full text-left hover:bg-panelAlt px-2 py-1 rounded"
            onClick={() =>
              auditionAndApply({
                ...chord,
                root: noteName(sub.root, keyName),
                quality: sub.quality,
                romanNumeral: chromaticDegreeLabel(keyPc, sub.root),
                isSubstitution: true,
                substitutedFrom: chord.romanNumeral,
              })
            }
          >
            <span className="font-medium">{sub.label} — {chordDisplayName(sub.root, sub.quality, keyName)}</span>
            <span className="block text-inkMuted text-[10px]">{sub.explanation}</span>
          </button>
        ))}
        {menu.borrowed.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
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
        )}
      </div>

      {/* Quality */}
      <div className="pt-2 border-t border-edge">
        <p className="text-[10px] text-inkMuted uppercase tracking-wide mb-1.5">Quality</p>
        <div className="flex flex-wrap gap-1">
          {CHORD_QUALITIES.map((q) => (
            <button
              key={q}
              className={`font-mono text-[11px] rounded px-2 py-1 border ${
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

      {/* Beats */}
      <div className="pt-2 border-t border-edge">
        <p className="text-[10px] text-inkMuted uppercase tracking-wide mb-1.5">Beats</p>
        <div className="flex items-center gap-2">
          <button
            className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
            onClick={() => onChange({ ...chord, beats: Math.max(0.5, chord.beats - 0.5) })}
          >
            –
          </button>
          <span className="font-mono min-w-[54px] text-center">{chord.beats} beats</span>
          <button
            className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
            onClick={() => onChange({ ...chord, beats: chord.beats + 0.5 })}
          >
            +
          </button>
        </div>
      </div>

      {/* Performance */}
      <div className="pt-2 border-t border-edge">
        <p className="text-[10px] text-inkMuted uppercase tracking-wide mb-1.5">Performance</p>
        <div className="flex flex-wrap gap-1">
          <button
            className={`font-mono text-[11px] rounded px-2 py-1 border ${
              !chord.performance
                ? "border-accent text-accent bg-accent/10"
                : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => onChange({ ...chord, performance: undefined })}
          >
            none
          </button>
          {PERFORMANCE_STYLES.map((style) => (
            <button
              key={style}
              className={`font-mono text-[11px] rounded px-2 py-1 border ${
                chord.performance?.style === style
                  ? "border-accent text-accent bg-accent/10"
                  : "border-edge text-inkMuted hover:text-ink"
              }`}
              onClick={() => onChange({ ...chord, performance: { style } })}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-edge flex justify-end">
        <button
          className="text-[11px] text-inkMuted hover:text-red-400"
          onClick={onRemove}
        >
          Remove chord
        </button>
      </div>
    </div>
  );
}
