import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { removeSection, repeatsFor, updateRepeats, updateSection } from "../../lib/sections";
import { DRUM_PATTERN_OPTIONS, variantCount } from "../../lib/playback/drumPreview";
import DrumNecklacePreview from "../structure/DrumNecklacePreview";
import FitStatus from "../harmony/FitStatus";
import type { BlueprintSection, DrumPattern, SectionRole, VelocityPreset } from "../../types/blueprint";

const ROLES: SectionRole[] = [
  "intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom",
];
const VELOCITIES: VelocityPreset[] = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];
const DENOMINATOR_OPTIONS = [2, 4, 8, 16];

/**
 * Structure edits for the focused section — the SectionCard editor ported
 * into the workspace rail (docs/design/workspace.md: the rail is the
 * focused object's panel). This is arrangement-editing v1: the form
 * fields; v2 mirrors these same writes from direct manipulation on the
 * spine blocks, so the gestures and the form stay two doors to one room.
 *
 * Writes go through the same lib/sections helpers the Structure tab uses
 * (`updateSection`/`updateRepeats`/`removeSection`), so the two editors
 * can never disagree — and both stay undoable via the song store.
 */
export default function SectionStructurePanel() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);

  if (!currentSong) return null;
  const song = currentSong;
  const section: BlueprintSection | null =
    song.sections.find((s) => s.id === selectedSectionId) ?? song.sections[0] ?? null;

  if (!section) {
    return (
      <p className="text-2xs font-mono text-inkMuted/60 italic">
        No sections yet — mint one from a map in the library.
      </p>
    );
  }

  const repeats = repeatsFor(song, section.id);
  /** Whether an outline (the harmony's own, or the drums' when the section
   *  follows them) drives chord timing — mirrors resolveChordOccurrences'
   *  precedence exactly. The fit readout below describes the per-chord-
   *  beats path only, so it's hidden while an outline is in charge (the
   *  outline readout further down covers that shape instead). */
  const outlineDriven = !!(
    section.harmonyMeterOutline ??
    (section.harmonyFollowsDrums === false ? null : section.drumMeterOutline)
  );
  const onChange = (updater: (s: BlueprintSection) => BlueprintSection) =>
    updateCurrentSong((s) => updateSection(s, section.id, updater));
  const onChangeRepeats = (n: number) => updateCurrentSong((s) => updateRepeats(s, section.id, n));
  const onDelete = () => {
    if (!window.confirm(`Delete "${section.name}"?`)) return;
    updateCurrentSong((s) => removeSection(s, section.id));
    setSelectedSectionId(null);
  };

  return (
    <div className="space-y-2">
      {/* Identity: name · role · delete */}
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 min-w-0 bg-panelAlt border border-edge rounded px-1.5 py-1 text-xs text-ink font-medium"
          value={section.name}
          onChange={(e) => onChange((s) => ({ ...s, name: e.target.value }))}
          title="Section name"
        />
        <select
          className="bg-panelAlt border border-edge rounded px-1 py-1 text-xs text-ink"
          value={section.role}
          onChange={(e) => onChange((s) => ({ ...s, role: e.target.value as SectionRole }))}
          title="Section role — drives drum inference, transitions, and the timeline colour"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          className="shrink-0 text-2xs font-mono text-inkMuted/70 hover:text-red-400 border border-edge rounded px-1.5 py-1"
          onClick={onDelete}
          title="Delete this section"
        >
          ✕
        </button>
      </div>

      {/* Numbers: time sig · bars · beats/chord · repeats */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5 text-2xs text-inkMuted font-mono">
        <label className="flex items-center gap-1" title="Time signature">
          <span className="uppercase tracking-wide text-3xs">TS</span>
          <input
            type="number"
            min={1}
            max={32}
            className="w-9 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink text-center"
            value={section.timeSignatureNumerator}
            onChange={(e) => onChange((s) => ({ ...s, timeSignatureNumerator: Number(e.target.value) || 1 }))}
          />
          <span>/</span>
          <select
            className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
            value={2 ** section.timeSignatureDenPower}
            onChange={(e) => onChange((s) => ({ ...s, timeSignatureDenPower: Math.log2(Number(e.target.value)) }))}
          >
            {DENOMINATOR_OPTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1" title="Section length in bars">
          <span className="uppercase tracking-wide text-3xs">Bars</span>
          <input
            type="number"
            min={1}
            className="w-11 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink text-center"
            value={section.bars}
            onChange={(e) => onChange((s) => ({ ...s, bars: Number(e.target.value) || 1 }))}
          />
        </label>
        <label
          className="flex items-center gap-1"
          title="The default chord rhythm used when BUILDING or importing chords — each chord also carries its own length, and an existing chord's length wins wherever set (edit per-chord timing in the harmony editor)"
        >
          <span className="uppercase tracking-wide text-3xs">Bts/ch</span>
          <input
            type="number"
            min={1}
            className="w-11 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink text-center"
            value={section.beatsPerChord}
            onChange={(e) => onChange((s) => ({ ...s, beatsPerChord: Number(e.target.value) || 1 }))}
          />
        </label>
        <label className="flex items-center gap-1" title="How many times this section plays in a row here — 0 skips it without deleting">
          <span className="uppercase tracking-wide text-3xs">Rpt</span>
          <input
            type="number"
            min={0}
            className="w-10 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink text-center"
            value={repeats}
            onChange={(e) => onChangeRepeats(Number(e.target.value))}
          />
        </label>
      </div>

      {/* Progression-vs-length, honestly: the exact arithmetic the export
          loops the chord cell with (whole passes + partial tail), plus the
          one-click "make it a clean loop" action. Hidden in outline mode —
          the fit math describes the per-chord-beats path only. */}
      {!outlineDriven && (
        <FitStatus section={section} onSetBars={(bars) => onChange((s) => ({ ...s, bars }))} />
      )}

      {/* Drums: outline readout or pattern + variant */}
      {section.drumMeterOutline ? (
        <p className="text-2xs text-inkMuted font-mono" title="Odd-meter outline — edit it in the drums editor">
          Drums <span className="text-accent">outline · {section.drumMeterOutline.label}</span>
        </p>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            className="flex-1 min-w-0 bg-panelAlt border border-edge rounded px-1 py-1 text-xs text-ink"
            value={section.drumPattern ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              onChange((s) => ({
                ...s,
                drumPattern: val ? (val as DrumPattern) : undefined,
                drumVariantIndex: val ? 0 : undefined,
              }));
            }}
            title="Override the heuristic drum pattern — empty = automatic from role, velocity and meter"
          >
            <option value="">drums: auto</option>
            {DRUM_PATTERN_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {section.drumPattern && (
            <span className="shrink-0 flex items-center gap-0.5 text-2xs text-inkMuted font-mono" title="Which variant of the selected pattern to use">
              <button
                className="px-1 hover:text-ink select-none"
                onClick={() => {
                  const total = variantCount(section.drumPattern);
                  const cur = section.drumVariantIndex ?? 0;
                  if (total > 1) onChange((s) => ({ ...s, drumVariantIndex: Math.max(0, cur - 1) }));
                }}
              >
                ◂
              </button>
              <span className="tabular-nums min-w-[3ch] text-center">
                {(section.drumVariantIndex ?? 0) + 1}/{variantCount(section.drumPattern)}
              </span>
              <button
                className="px-1 hover:text-ink select-none"
                onClick={() => {
                  const total = variantCount(section.drumPattern);
                  const cur = section.drumVariantIndex ?? 0;
                  if (total > 1) onChange((s) => ({ ...s, drumVariantIndex: Math.min(total - 1, cur + 1) }));
                }}
              >
                ▸
              </button>
            </span>
          )}
        </div>
      )}

      {/* Velocity */}
      <label className="flex items-center gap-1 text-2xs text-inkMuted font-mono">
        <span className="uppercase tracking-wide text-3xs">Velocity</span>
        <select
          className="flex-1 bg-panelAlt border border-edge rounded px-1 py-0.5 text-ink"
          value={section.velocity}
          onChange={(e) => onChange((s) => ({ ...s, velocity: e.target.value as VelocityPreset }))}
          title="Dynamics — also drives drum density inference"
        >
          {VELOCITIES.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </label>

      {/* Harmony customization readout — edited in the element, noted here */}
      {(section.harmonyMeterOutline || section.harmonyFollowsDrums || section.syncopationOffset) && (
        <p className="text-2xs text-inkMuted font-mono" title="Chord rhythm is customized — edit it in the harmony editor">
          Harmony{" "}
          {section.harmonyMeterOutline ? (
            <span className="text-accent">outline · {section.harmonyMeterOutline.label}</span>
          ) : section.harmonyFollowsDrums ? (
            <span className="text-accent">follows drums</span>
          ) : null}
          {section.syncopationOffset ? (
            <span className="text-accent"> push {Math.round(section.syncopationOffset * 4)}/16</span>
          ) : null}
        </p>
      )}

      {section.drumPattern && (
        <DrumNecklacePreview pattern={section.drumPattern} variantIndex={section.drumVariantIndex} />
      )}

      <textarea
        className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-inkMuted resize-y"
        rows={2}
        placeholder="Transition into this section…"
        value={section.transitionNote ?? ""}
        onChange={(e) => onChange((s) => ({ ...s, transitionNote: e.target.value }))}
      />
    </div>
  );
}
