import { pitchClass, noteName } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord, ChordPerformanceEffect } from "../../types/blueprint";
import { getSubstitutionMenu } from "../../lib/harmony/substitutions";
import { chordDisplayName, CHORD_QUALITIES } from "../../lib/harmony/chordBuilder";

// Chromatic subs (tritone/secondary-dominant) aren't diatonic, so there's no
// scale degree to label them with — derive a key-relative roman numeral from
// the semitone offset, matching honeycombWalk's chromatic degree convention.
const CHROMATIC_DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
function chromaticDegreeLabel(keyPc: number, rootPc: number): string {
  return CHROMATIC_DEGREES[(((rootPc - keyPc) % 12) + 12) % 12];
}

const PERFORMANCE_STYLES: ChordPerformanceEffect["style"][] = ["strum", "pulse", "arp"];

interface ChordEditorPopoverProps {
  chord: Chord;
  keyName: NoteName;
  scale: ScaleType;
  onChange: (chord: Chord) => void;
  onRemove: () => void;
  /** Deselects the chord — the dock falls back to song/section controls. */
  onDeselect: () => void;
}

/** Small slider row for a single numeric parameter. */
function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-2xs text-inkMuted w-32 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full accent-accent"
      />
      <span className="font-mono text-2xs text-inkMuted w-9 text-right">{value}</span>
    </div>
  );
}

/** Exposes the active effect's tunable parameters as sliders, writing
 *  them into `chord.performance.params` so the export path reads them
 *  instead of falling back to built-in defaults. */
function PerformanceParams({
  chord,
  onChange,
}: {
  chord: Chord;
  onChange: (chord: Chord) => void;
}) {
  const style = chord.performance!.style;
  const params = chord.performance!.params ?? {};

  function setParam(key: string, value: number) {
    onChange({
      ...chord,
      performance: { style, params: { ...params, [key]: value } },
    });
  }

  if (style === "strum") {
    return (
      <ParamSlider
        label="Strum speed (ms)"
        value={params.strumMs ?? 150}
        min={100}
        max={300}
        step={5}
        onChange={(v) => setParam("strumMs", v)}
      />
    );
  }

  if (style === "pulse") {
    return (
      <ParamSlider
        label="Subdivision"
        value={params.subdivision ?? 4}
        min={1}
        max={16}
        step={1}
        onChange={(v) => setParam("subdivision", v)}
      />
    );
  }

  // arp
  return (
    <ParamSlider
      label="Subdivision"
      value={params.subdivision ?? 4}
      min={1}
      max={16}
      step={1}
      onChange={(v) => setParam("subdivision", v)}
    />
  );
}

/** The selected chord's editor — the dock's "tools" content whenever a chord
 *  is selected (HoneycombWheel or ProgressionTrack). Used to be an
 *  anchored floating popover; now a plain panel filling the dock's tools
 *  area, laid out as horizontal bands (Substitutions | Quality+Beats |
 *  Performance) instead of one narrow stacked column, since the dock is
 *  wide and short rather than the other way around. Substitution options
 *  are compact chips with their theory explanation moved to a `title`
 *  tooltip — the old two-line label+explanation stack doesn't fit ~180px
 *  of height for more than one or two options. */
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

        {/* Quality + Beats */}
        <div className="space-y-2">
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
        </div>

        {/* Performance */}
        <div>
          <p className="text-3xs text-inkMuted uppercase tracking-wide mb-1">Performance</p>
          <div className="flex flex-wrap gap-1 mb-1.5">
            <button
              className={`font-mono text-2xs rounded px-1.5 py-0.5 border ${
                !chord.performance ? "border-accent text-accent bg-accent/10" : "border-edge text-inkMuted hover:text-ink"
              }`}
              onClick={() => onChange({ ...chord, performance: undefined })}
            >
              none
            </button>
            {PERFORMANCE_STYLES.map((style) => (
              <button
                key={style}
                className={`font-mono text-2xs rounded px-1.5 py-0.5 border ${
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
          {chord.performance && <PerformanceParams chord={chord} onChange={onChange} />}
        </div>
      </div>
    </div>
  );
}
