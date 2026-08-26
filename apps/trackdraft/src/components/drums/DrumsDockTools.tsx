import { useState, useEffect } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { updateSection } from "../../lib/sections";
import { DRUM_PATTERN_OPTIONS, variantCount } from "../../lib/playback/drumPreview";
import { TRANSITION_COLOR, TRANSITION_LABEL, TRANSITION_MODELS } from "./transitionStyle";
import type { DrumPattern, DrumTransitionModel, DrumCellVoice, MeterOutline } from "../../types/blueprint";
import { numerator as outlineNumerator, countLabel, buildEuclideanOutline, twoThreeCellCounts, euclideanCells } from "@drum/library";
import DrumNecklacePreview from "../structure/DrumNecklacePreview";
import OutlineTimeline from "./OutlineTimeline";

type DrumMode = "auto" | "preset" | "outline";
const OUTLINE_DENOMINATORS = [8, 16];
const CELL_VOICES: DrumCellVoice[] = ["kick", "snare", "hat"];
const CELL_VOICE_LABEL: Record<DrumCellVoice, string> = { kick: "Kick", snare: "Snare", hat: "Hat" };
const CELL_VOICE_COLOR: Record<DrumCellVoice, string> = { kick: "#E8B54A", snare: "#D96459", hat: "#8B94A1" };

function modeOf(drumPattern: DrumPattern | undefined, drumMeterOutline: MeterOutline | undefined): DrumMode {
  if (drumMeterOutline) return "outline";
  if (drumPattern) return "preset";
  return "auto";
}

/** Which rotation (if any) of `euclideanCells(numeratorValue, cellCount, r)`
 *  matches the outline's current cells — so the Rotation stepper can show
 *  a real number instead of a guess. Manual cell edits (toggle/insert/
 *  remove) can knock an outline out of alignment with any pure rotation;
 *  that's reported as "custom" (-1) rather than snapped to the nearest
 *  match, since silently relabeling a hand edit as some rotation would
 *  misrepresent what's actually there. */
function inferRotation(outline: MeterOutline, numeratorValue: number, cellCount: number): number {
  if (!twoThreeCellCounts(numeratorValue).includes(cellCount)) return -1;
  for (let r = 0; r < cellCount; r++) {
    const cells = euclideanCells(numeratorValue, cellCount, r);
    if (cells.length === outline.cells.length && cells.every((c, i) => c === outline.cells[i])) return r;
  }
  return -1;
}

/** The named corpus/synth presets that already cover a given meter —
 *  surfaced as a nudge so a user authoring 7/8 or 6/8 from scratch in the
 *  Euclidean editor sees that a real, human-played take already exists
 *  for it, rather than only finding that out by switching modes to look. */
function presetForMeter(numeratorValue: number, denominator: number): DrumPattern | null {
  if (denominator !== 8) return null;
  if (numeratorValue === 6) return "68";
  if (numeratorValue === 7) return "78";
  if (numeratorValue === 10) return "54";
  return null;
}

/** The Drums tab's dock content — registered once by DrumsView, reads
 *  `useSongStore` + `useDrumsSelectionStore` directly (same reasoning as
 *  `HarmonyDockTools`), so clicking a different section on the timeline
 *  updates this panel without DrumsView re-pushing fresh JSX into the
 *  dock on every click.
 *
 *  A section's drums are one of three mutually exclusive modes — auto
 *  (heuristic), a named preset+variant, or a freeform odd-meter outline
 *  — mirroring exactly the priority `drumClips.ts`'s real export already
 *  uses (`drumMeterOutline` beats `drumPattern` beats the heuristic), so
 *  switching modes here always writes a combination of fields the export
 *  will interpret the same way this panel just previewed. */
export default function DrumsDockTools() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);

  // Which outline cell is being edited — local to this panel (not shared
  // song data), so it resets whenever the selected *section* changes;
  // within one section it self-clamps as cells are added/removed rather
  // than needing its own reset for that.
  const [selectedCellIndex, setSelectedCellIndex] = useState(0);
  useEffect(() => {
    setSelectedCellIndex(0);
  }, [selectedSectionId]);

  if (!currentSong) return null;
  const song = currentSong;
  const section = song.sections.find((s) => s.id === selectedSectionId) ?? null;

  if (!section) {
    return (
      <div className="p-3">
        <p className="text-xs text-inkMuted">Click a section on the timeline to edit its drums.</p>
      </div>
    );
  }

  const mode = modeOf(section.drumPattern, section.drumMeterOutline);

  function setMode(next: DrumMode) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => {
        if (next === "auto") return { ...sec, drumPattern: undefined, drumVariantIndex: undefined, drumMeterOutline: undefined };
        if (next === "preset") return { ...sec, drumMeterOutline: undefined, drumPattern: sec.drumPattern ?? "standard", drumVariantIndex: sec.drumPattern ? sec.drumVariantIndex : 0 };
        return { ...sec, drumPattern: undefined, drumVariantIndex: undefined, drumMeterOutline: buildEuclideanOutline(7, 8, twoThreeCellCounts(7)[0]!, 0) };
      }),
    );
  }

  function setPattern(val: string) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => ({
        ...sec,
        drumPattern: val ? (val as DrumPattern) : undefined,
        drumVariantIndex: val ? 0 : undefined,
      })),
    );
  }

  function stepVariant(delta: number) {
    const total = variantCount(section!.drumPattern);
    if (total <= 1) return;
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => {
        const cur = sec.drumVariantIndex ?? 0;
        return { ...sec, drumVariantIndex: Math.max(0, Math.min(total - 1, cur + delta)) };
      }),
    );
  }

  /** The one place that regenerates `cells` from scratch — unlike the old
   *  numerator/denominator/grouping pickers (which regenerated silently as
   *  a side effect of what looked like independent choices), every caller
   *  of this is a control whose entire job is "pick a different meter/
   *  pulse arrangement," so a fresh set of cells is the expected result,
   *  not a surprise that wipes manual voicing underneath you. */
  function applyEuclidean(numeratorValue: number, denominator: number, cellCount: number, rotation: number) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => ({
        ...sec,
        drumMeterOutline: buildEuclideanOutline(numeratorValue, denominator, cellCount, rotation),
      })),
    );
    setSelectedCellIndex(0);
  }

  function setNumerator(delta: number) {
    const o = section!.drumMeterOutline;
    if (!o) return;
    const denominator = Math.round(4 / o.cellBeats);
    const next = Math.max(2, outlineNumerator(o) + delta);
    const cellCount = twoThreeCellCounts(next)[0]!;
    applyEuclidean(next, denominator, cellCount, 0);
  }

  function setCellCount(count: number) {
    const o = section!.drumMeterOutline;
    if (!o) return;
    const denominator = Math.round(4 / o.cellBeats);
    applyEuclidean(outlineNumerator(o), denominator, count, 0);
  }

  function setRotation(delta: number) {
    const o = section!.drumMeterOutline;
    if (!o) return;
    const denominator = Math.round(4 / o.cellBeats);
    const num = outlineNumerator(o);
    const count = o.cells.length;
    const base = inferRotation(o, num, count);
    const start = base === -1 ? 0 : base;
    const next = ((start + delta) % count + count) % count;
    applyEuclidean(num, denominator, count, next);
  }

  function usePresetInstead(pattern: DrumPattern) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => ({
        ...sec,
        drumMeterOutline: undefined,
        drumPattern: pattern,
        drumVariantIndex: 0,
      })),
    );
  }

  function updateOutline(updater: (o: MeterOutline) => MeterOutline) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => (sec.drumMeterOutline ? { ...sec, drumMeterOutline: updater(sec.drumMeterOutline) } : sec)),
    );
  }

  function setDenominator(denominator: number) {
    updateOutline((o) => ({ ...o, cellBeats: 4 / denominator }));
  }

  function toggleCell(i: number) {
    updateOutline((o) => {
      const cells = o.cells.slice();
      cells[i] = cells[i] === 2 ? 3 : 2;
      return { ...o, cells, label: countLabel(cells) };
    });
  }

  function setCellVoice(i: number, voice: DrumCellVoice) {
    updateOutline((o) => {
      const voices = (o.cellVoices ?? o.cells.map(() => "hat" as DrumCellVoice)).slice();
      voices[i] = voice;
      return { ...o, cellVoices: voices };
    });
  }

  /** Inserts a fresh cell right after `afterIndex` (`-1` to insert at the
   *  very start) rather than only ever appending at the end — a repeating
   *  odd-meter figure is usually easiest to build by growing it from
   *  wherever you're already looking, not by always jumping to the tail
   *  and re-finding your place. */
  function insertCell(afterIndex: number) {
    updateOutline((o) => {
      const at = afterIndex + 1;
      const cells = [...o.cells.slice(0, at), 2 as const, ...o.cells.slice(at)];
      const cellVoices = o.cellVoices
        ? [...o.cellVoices.slice(0, at), "hat" as DrumCellVoice, ...o.cellVoices.slice(at)]
        : undefined;
      return { ...o, cells, cellVoices, label: countLabel(cells) };
    });
    setSelectedCellIndex(afterIndex + 1);
  }

  function removeCell(i: number) {
    updateOutline((o) => {
      if (o.cells.length <= 1) return o; // never empty out entirely
      const cells = o.cells.filter((_, idx) => idx !== i);
      const cellVoices = o.cellVoices ? o.cellVoices.filter((_, idx) => idx !== i) : undefined;
      return { ...o, cells, cellVoices, label: countLabel(cells) };
    });
    setSelectedCellIndex((cur) => Math.max(0, Math.min(cur, i === cur ? i - 1 : cur)));
  }

  function setTransitionModel(model: DrumTransitionModel | null) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => ({
        ...sec,
        drumTransitionModel: model ?? undefined,
        drumTransitionBars: model ? (sec.drumTransitionBars ?? 1) : undefined,
      })),
    );
  }

  function setTransitionBars(bars: number) {
    updateCurrentSong((s) =>
      updateSection(s, section!.id, (sec) => ({ ...sec, drumTransitionBars: Math.max(1, bars) })),
    );
  }

  const total = variantCount(section.drumPattern);
  const outline = section.drumMeterOutline;
  const currentDenominator = outline ? Math.round(4 / outline.cellBeats) : 8;
  const currentNumerator = outline ? outlineNumerator(outline) : 7;
  const currentCellCount = outline ? outline.cells.length : 3;
  const cellCountOptions = outline ? twoThreeCellCounts(currentNumerator) : [];
  const currentRotation = outline ? inferRotation(outline, currentNumerator, currentCellCount) : -1;
  const presetMatch = outline ? presetForMeter(currentNumerator, currentDenominator) : null;
  const selectedCell = outline ? Math.max(0, Math.min(selectedCellIndex, outline.cells.length - 1)) : null;

  return (
    <div className="p-3 space-y-3">
      <div>
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Section</span>
        <p className="text-sm font-medium">{section.name}</p>
      </div>

      <div>
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Mode</span>
        <div className="flex gap-1">
          {(["auto", "preset", "outline"] as const).map((m) => (
            <button
              key={m}
              className={`flex-1 font-mono text-2xs rounded px-2 py-1 border ${
                mode === m ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
              }`}
              onClick={() => setMode(m)}
              title={
                m === "auto" ? "Infer a pattern from role, velocity and meter"
                : m === "preset" ? "Pick a named corpus/synth pattern"
                : "Euclidean odd-meter authoring — k/n/rotation, Ferguson's apple/galloping cells"
              }
            >
              {m === "outline" ? "euclid" : m}
            </button>
          ))}
        </div>
      </div>

      {mode === "preset" && (
        <>
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Pattern</span>
            <select
              className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-sm text-ink"
              value={section.drumPattern ?? ""}
              onChange={(e) => setPattern(e.target.value)}
            >
              {DRUM_PATTERN_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Variant</span>
            <div className="flex items-center gap-2 text-sm">
              <button
                className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink disabled:opacity-30"
                onClick={() => stepVariant(-1)}
                disabled={total <= 1}
              >
                ◂
              </button>
              <span className="font-mono tabular-nums min-w-[3ch] text-center">
                {((section.drumVariantIndex ?? 0) + 1)}/{total}
              </span>
              <button
                className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink disabled:opacity-30"
                onClick={() => stepVariant(1)}
                disabled={total <= 1}
              >
                ▸
              </button>
            </div>
          </div>

          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Preview</span>
            <DrumNecklacePreview pattern={section.drumPattern} variantIndex={section.drumVariantIndex} />
          </div>
        </>
      )}

      {mode === "outline" && outline && (
        <>
          <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block -mb-1">
            Euclidean rhythm — E(k, n)
          </span>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span
                className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
                title="Total pulses in the bar (Euclidean E(k,n) — this is n)."
              >
                Numerator
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink disabled:opacity-30"
                  onClick={() => setNumerator(-1)}
                  disabled={currentNumerator <= 2}
                >
                  ◂
                </button>
                <span className="font-mono tabular-nums flex-1 text-center text-sm">{currentNumerator}</span>
                <button
                  className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
                  onClick={() => setNumerator(1)}
                >
                  ▸
                </button>
              </div>
            </div>

            <div>
              <span
                className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
                title="How many 2s/3s cells to spread the pulses across — this is k in E(k,n)."
              >
                Cells (k)
              </span>
              <div className="flex flex-wrap gap-1">
                {cellCountOptions.map((c) => (
                  <button
                    key={c}
                    className={`font-mono text-xs rounded px-1.5 py-1 border ${
                      currentCellCount === c ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
                    }`}
                    onClick={() => setCellCount(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span
                className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
                title="Cyclically shifts which cell starts the bar — the same pulses read from a different point in their own cycle."
              >
                Rotation
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
                  onClick={() => setRotation(-1)}
                >
                  ◂
                </button>
                <span className="font-mono tabular-nums flex-1 text-center text-sm">
                  {currentRotation === -1 ? "custom" : currentRotation}
                </span>
                <button
                  className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
                  onClick={() => setRotation(1)}
                >
                  ▸
                </button>
              </div>
            </div>
          </div>

          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">Denominator</span>
            <div className="flex gap-1">
              {OUTLINE_DENOMINATORS.map((d) => (
                <button
                  key={d}
                  className={`flex-1 font-mono text-xs rounded px-1 py-1 border ${
                    currentDenominator === d ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
                  }`}
                  onClick={() => setDenominator(d)}
                >
                  /{d}
                </button>
              ))}
            </div>
          </div>

          {presetMatch && (
            <div className="border border-edge rounded p-2 text-2xs text-inkMuted">
              {currentNumerator}/{currentDenominator} already has a real, human-played preset.{" "}
              <button
                className="text-ink underline hover:no-underline"
                onClick={() => usePresetInstead(presetMatch)}
              >
                Use "{presetMatch}" instead
              </button>
            </div>
          )}

          <div>
            <span
              className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
              title="Ferguson's own counting mnemonic for this grouping — derived from the cells, not editable directly."
            >
              Ferguson grouping — {outline.label}
            </span>
            <span
              className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
              title="Click a cell to select it, then set what it plays below. The number toggles 2⇄3 (apple/galloping)."
            >
              Cells
            </span>
            <div className="flex flex-wrap gap-1">
              {outline.cells.map((cell, i) => {
                const voice = outline.cellVoices?.[i] ?? "hat";
                const isSelected = i === selectedCell;
                return (
                  <button
                    key={i}
                    className="flex flex-col items-center gap-0.5 rounded border px-1.5 py-1"
                    style={{ borderColor: isSelected ? "#F5E7C8" : "#2E2E34", backgroundColor: isSelected ? "#232838" : "transparent" }}
                    onClick={() => setSelectedCellIndex(i)}
                    title={`Cell ${i + 1}: ${cell} beats, plays ${voice}`}
                  >
                    <span className="font-mono text-sm text-ink leading-none">{cell}</span>
                    <span
                      className="w-3 h-1.5 rounded-full"
                      style={{ backgroundColor: CELL_VOICE_COLOR[voice] }}
                    />
                  </button>
                );
              })}
              <button
                className="rounded border border-dashed border-edge text-inkMuted hover:text-ink px-2"
                onClick={() => insertCell(outline.cells.length - 1)}
                title="Add a cell at the end"
              >
                +
              </button>
            </div>
          </div>

          {selectedCell !== null && (
            <div className="border border-edge rounded p-2 space-y-2 bg-panelAlt">
              <div className="flex items-center justify-between">
                <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">
                  Cell {selectedCell + 1} of {outline.cells.length}
                </span>
                <button
                  className="font-mono text-3xs text-inkMuted hover:text-ink"
                  onClick={() => toggleCell(selectedCell)}
                  title="Toggle 2 ⇄ 3 beats"
                >
                  {outline.cells[selectedCell]} beats ⇄
                </button>
              </div>

              <div className="flex gap-1">
                {CELL_VOICES.map((v) => {
                  const active = (outline.cellVoices?.[selectedCell] ?? "hat") === v;
                  const color = CELL_VOICE_COLOR[v];
                  return (
                    <button
                      key={v}
                      className="flex-1 font-mono text-xs rounded px-2 py-1.5 border"
                      style={{
                        borderColor: active ? color : "#2E2E34",
                        color: active ? "#12161D" : color,
                        backgroundColor: active ? color : "transparent",
                      }}
                      onClick={() => setCellVoice(selectedCell, v)}
                    >
                      {CELL_VOICE_LABEL[v]}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <button
                  className="font-mono text-3xs text-inkMuted hover:text-ink"
                  onClick={() => insertCell(selectedCell)}
                >
                  + insert after
                </button>
                <button
                  className="font-mono text-3xs text-inkMuted hover:text-red-400 disabled:opacity-30 disabled:hover:text-inkMuted"
                  onClick={() => removeCell(selectedCell)}
                  disabled={outline.cells.length <= 1}
                >
                  remove this cell
                </button>
              </div>
            </div>
          )}

          <div>
            <span
              className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
              title="What actually plays, beat by beat — the real end result, not the ring diagram."
            >
              Timeline
            </span>
            <OutlineTimeline outline={outline} />
          </div>
        </>
      )}

      <div className="border-t border-edge pt-3">
        <span
          className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1.5"
          title="Replaces this section's own final bars with a named transition. Overrides the automatic handoff fill for those bars — it doesn't stack with it."
        >
          Transition (this section's ending)
        </span>
        <div className="flex flex-wrap gap-1 mb-2">
          <button
            className={`font-mono text-2xs rounded px-2 py-1 border ${
              !section.drumTransitionModel ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
            }`}
            onClick={() => setTransitionModel(null)}
          >
            none
          </button>
          {TRANSITION_MODELS.map((model) => {
            const active = section.drumTransitionModel === model;
            const color = TRANSITION_COLOR[model];
            return (
              <button
                key={model}
                className="font-mono text-2xs rounded px-2 py-1 border"
                style={{
                  borderColor: active ? color : "#2E2E34",
                  color: active ? color : "#8B94A1",
                  backgroundColor: active ? `${color}1a` : "transparent",
                }}
                onClick={() => setTransitionModel(model)}
              >
                {TRANSITION_LABEL[model]}
              </button>
            );
          })}
        </div>

        {section.drumTransitionModel && (
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono text-3xs text-inkMuted">Bars</span>
            <button
              className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
              onClick={() => setTransitionBars((section.drumTransitionBars ?? 1) - 1)}
            >
              −
            </button>
            <span className="font-mono tabular-nums min-w-[2ch] text-center">{section.drumTransitionBars ?? 1}</span>
            <button
              className="w-6 h-6 rounded border border-edge text-inkMuted hover:text-ink"
              onClick={() => setTransitionBars((section.drumTransitionBars ?? 1) + 1)}
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
