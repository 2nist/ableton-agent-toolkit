import { pitchClass, noteName } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import type { Chord, ChordPerformanceEffect } from "../../types/blueprint";
import { getSubstitutionMenu } from "../../lib/harmony/substitutions";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import { getPreviewPlayer } from "../../lib/harmony/audioPreview";

const PERFORMANCE_STYLES: ChordPerformanceEffect["style"][] = ["strum", "pulse", "arp"];

interface ChordInspectorProps {
  chord: Chord | null;
  keyName: NoteName;
  scale: ScaleType;
  onChange: (chord: Chord) => void;
}

// Chromatic subs (tritone/secondary-dominant) aren't diatonic, so there's no
// scale degree to label them with — but the honeycomb still needs *some*
// key-relative roman numeral to plot their hex position, so we derive one
// from the semitone offset off the key root, same accidental convention as
// honeycombWalk's own chromatic degree labels ("♭II — Neapolitan", etc).
const CHROMATIC_DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];

function chromaticDegreeLabel(keyPc: number, rootPc: number): string {
  const offset = (((rootPc - keyPc) % 12) + 12) % 12;
  return CHROMATIC_DEGREES[offset];
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
    getPreviewPlayer().playChordObject(next, 1);
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

      {/* Performance */}
      <div className="border-t border-edge pt-3">
        <p className="text-[11px] text-inkMuted uppercase tracking-wide mb-1.5">Performance</p>
        <div className="flex flex-wrap gap-1 mb-2">
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
              onClick={() => {
                const next = { ...chord, performance: { style } };
                onChange(next);
                getPreviewPlayer().playChordObject(next, 1);
              }}
            >
              {style}
            </button>
          ))}
        </div>
        {chord.performance && (
          <PerformanceParams
            chord={chord}
            onChange={onChange}
            onAudition={() => getPreviewPlayer().playChordObject(chord, 1)}
          />
        )}
      </div>
    </div>
  );
}

/** Slider for a performance parameter. */
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
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-inkMuted w-28 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 accent-accent"
      />
      <span className="font-mono text-[10px] text-inkMuted w-10 text-right">{value}</span>
    </div>
  );
}

function PerformanceParams({
  chord,
  onChange,
  onAudition,
}: {
  chord: Chord;
  onChange: (chord: Chord) => void;
  onAudition: () => void;
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
        onChange={(v) => { setParam("strumMs", v); onAudition(); }}
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
        onChange={(v) => { setParam("subdivision", v); onAudition(); }}
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
      onChange={(v) => { setParam("subdivision", v); onAudition(); }}
    />
  );
}