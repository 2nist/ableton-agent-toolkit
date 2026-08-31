import { useEffect, useRef, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useDrumsSelectionStore } from "../../store/drumsSelectionStore";
import { useDrumsDraftStore } from "../../store/drumsDraftStore";
import { updateSection } from "../../lib/sections";
import { sectionSpans } from "../../lib/arrangement";
import {
  DRUM_PATTERN_OPTIONS,
  variantCount,
  resolveSectionVoiceNecklaces,
  resolveOutlineVoiceNecklaces,
  velocityNumber,
} from "../../lib/playback/drumPreview";
import { TRANSITION_COLOR, TRANSITION_LABEL, TRANSITION_MODELS } from "./transitionStyle";
import NecklaceRow from "./NecklaceRow";
import TransitionPreview from "./TransitionPreview";
import { VOICE_LABEL, VOICE_ORDER } from "./voiceStyle";
import { SliderRow, EuclidSliders, StepView, EuclidStepView } from "./euclidEditor";
import {
  buildEuclideanOutline,
  twoThreeCellCounts,
  numerator as outlineNumerator,
  countLabel,
  planSectionTransitions,
  type KitVoice,
} from "@drum/library";
import type { BlueprintSection, DrumPattern, DrumTransitionModel, DrumCellVoice, MeterOutline } from "../../types/blueprint";
import { beatsPerBar } from "../../types/blueprint";

type DrumMode = "auto" | "preset" | "outline";
type ToolTab = "pattern" | "variation" | "transition";

const DEFAULT_DENOM = 8;
const CHIP = "font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink";
const CHIP_ON = "font-mono text-2xs rounded px-2 py-1 border border-accent text-accent bg-accent/10";
const TAB = "flex-1 rounded border border-edge px-2 py-1 font-mono text-2xs uppercase tracking-wider text-inkMuted hover:text-ink";
const TAB_ON = "flex-1 rounded border border-accent px-2 py-1 font-mono text-2xs uppercase tracking-wider text-accent bg-accent/10";

/** The section's meter at an 8th-note grid — the natural outline/variation
 *  numerator for the editor defaults, so a 4/4 song lands on 8 (8 eighths
 *  = 4/4) instead of a hardcoded 7/8. 7/8 stays 7, 3/4 becomes 6, etc. */
function eighthNoteNumerator(sec: Pick<BlueprintSection, "timeSignatureNumerator" | "timeSignatureDenPower">): number {
  const den = 2 ** (sec.timeSignatureDenPower ?? 2);
  return Math.max(1, Math.round(sec.timeSignatureNumerator * (8 / den)));
}

/** Per-cell downbeat voice — the kick/snare/hat a cell's "DA" plays.
 *  Colors match `voiceStyle`'s kick/snare/hat hues. */
const CELL_VOICE_LABEL: Record<DrumCellVoice, string> = { kick: "Kick", snare: "Snare", hat: "Hat" };
const CELL_VOICE_COLOR: Record<DrumCellVoice, string> = { kick: "#E8B54A", snare: "#D96459", hat: "#8B94A1" };

/** Which of the three mutually-exclusive drum-authoring modes a section is
 *  in — same priority the export uses: a Euclidean outline beats a named
 *  preset beats the heuristic. */
function modeOf(sec: BlueprintSection): DrumMode {
  if (sec.drumMeterOutline) return "outline";
  return sec.drumPattern ? "preset" : "auto";
}

/** Which rotation (if any) of `buildEuclideanOutline(n, d, k, r)` matches
 *  the outline's cells — so the Offset slider shows a real number rather
 *  than a guess after manual edits. */
function inferRotation(outline: MeterOutline, n: number, k: number): number {
  if (!twoThreeCellCounts(n).includes(k)) return 0;
  const d = Math.round(4 / outline.cellBeats);
  for (let r = 0; r < k; r++) {
    const cells = buildEuclideanOutline(n, d, k, r).cells;
    if (cells.length === outline.cells.length && cells.every((c, i) => c === outline.cells[i])) return r;
  }
  return 0;
}

/** Free-form Length (n) / Density (k) / Offset (rotation) sliders for a
 *  per-voice Euclidean pattern — Density is freely adjustable 1..n (`k`
 *  onsets spread as evenly as possible across `n` steps). Changing one
 *  slider only touches that value (clamping the others only if they'd
 *  fall out of range). */
function FreeSliders({ n, k, rotation, onChange }: {
  n: number; k: number; rotation: number;
  onChange: (n: number, k: number, r: number) => void;
}) {
  return (
    <div className="space-y-2.5">
      <SliderRow
        label="Length"
        min={2}
        max={16}
        value={n}
        onChange={(v) => onChange(v, Math.min(k, v), Math.min(rotation, v - 1))}
      />
      <SliderRow label="Density" min={1} max={n} value={k} onChange={(v) => onChange(n, v, rotation)} />
      <SliderRow label="Offset" min={0} max={Math.max(0, n - 1)} value={rotation} onChange={(v) => onChange(n, k, v)} />
    </div>
  );
}

/** The Drum tab's dock editor. Clicking a section on the timeline loads it
 *  here; every edit is written to a working draft the timeline previews
 *  live, committed to the song with Apply (undoable) or thrown away with
 *  Optimized for the horizontal bottom dock: the tab row also carries the
 *  section-groove controls (Auto + Euclid + Preset + Variant) — Euclid is
 *  how any section is switched into outline/odd-meter authoring, since a
 *  `drumMeterOutline` is otherwise only editable once it already exists.
 *  The Pattern tab is
 *  Voice-by-Voice first — voice chips | a large Euclidean pattern display |
 *  the Length/Density/Offset sliders — with the whole-section Euclidean
 *  editor tucked at the bottom for genuine outline/odd-meter sections.
 *  Tabs: Pattern · Detour (ending rhythm detour) · Transition.
 *
 *  The Pattern tab's whole-section Euclidean block (genuine outline/odd-meter
 *  sections) is a full editor, not just sliders: Length/Density/Offset plus
 *  the /8 /16 grid, and a cell editor for the 2s/3s grouping — toggle each
 *  cell 2⇄3, insert/remove cells, and assign each cell's downbeat a
 *  kick/snare/hat voice (`cellVoices`), which the export honors.
 *
 *  The Transition tab previews the actual generated material per voice
 *  (`TransitionPreview`), so build/break/cut/drop read differently here and
 *  at export — no more shared placeholder. */
export default function DrumPatternTools() {
  const currentSong = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const selectedSectionId = useDrumsSelectionStore((s) => s.selectedSectionId);
  const draftSectionId = useDrumsDraftStore((s) => s.sectionId);
  const draftSection = useDrumsDraftStore((s) => s.section);
  const setDraft = useDrumsDraftStore((s) => s.setDraft);
  const clearDraft = useDrumsDraftStore((s) => s.clearDraft);
  const [tab, setTab] = useState<ToolTab>("pattern");
  const [voice, setVoice] = useState<KitVoice | null>(null);
  // Which whole-section outline cell is selected for editing — local to this
  // panel (not song data), reset when the selected section changes.
  const [cellIndex, setCellIndex] = useState(0);
  // Which detour cell is selected for editing — local, reset with the section.
  const [vCellIndex, setVCellIndex] = useState(0);
  // The preset to restore when Auto is toggled back off — kept locally so
  // switching to Auto doesn't forget the groove you were just on.
  const lastPresetRef = useRef<DrumPattern | null>(null);

  // Switching sections throws away any uncommitted draft — a draft is a
  // "this section, right now" working surface, not song data.
  useEffect(() => {
    clearDraft();
    setVoice(null);
    setCellIndex(0);
    setVCellIndex(0);
    lastPresetRef.current = null;
  }, [selectedSectionId, clearDraft]);

  if (!currentSong) return null;
  const song = currentSong;
  const section = song.sections.find((s) => s.id === selectedSectionId) ?? null;
  if (!section) {
    return (
      <div className="p-3">
        <p className="text-xs text-inkMuted">Click a section on the timeline to edit its pattern.</p>
      </div>
    );
  }

  // The role-aware auto transition for the selected section — the same
  // plan the export path applies when the user hasn't authored one, shown
  // here so "what's auto-assigned" is visible (and a chip above overrides).
  const spans = sectionSpans(song);
  const autoTransitions = planSectionTransitions(
    spans.map((span) => ({
      sectionId: span.sectionId,
      occurrenceIndex: span.occurrenceIndex,
      role: span.section.role ?? null,
      durationBeats: span.durationBeats,
      beatsPerBar: beatsPerBar(span.section),
      velocityTarget: velocityNumber(span.section.velocity),
      manualModel: span.section.drumTransitionModel != null,
      hasVariation: span.section.drumVariationOutline != null,
    })),
  );
  const autoIndex = spans.findIndex((span) => span.sectionId === section.id);
  const autoPlan = autoIndex >= 0 ? autoTransitions[autoIndex] : null;
  const autoNextName = autoIndex >= 0 && autoIndex + 1 < spans.length ? spans[autoIndex + 1].section.name : null;

  // Non-null alias for use inside the helper closures below (TS narrows
  // `section` in linear code but not inside hoisted function declarations).
  const activeSection = section;

  const isDraft = draftSectionId === section.id && draftSection !== null;
  const eff = isDraft && draftSection ? draftSection : section;
  const mode = modeOf(eff);
  const outline = eff.drumMeterOutline;
  // Default length 8 (eighths) for non-outline sections — it has more than
  // one valid density (3 or 4), so the always-on Euclid sliders are usable
  // the moment a section is picked instead of a locked default.
  const n = outline ? outlineNumerator(outline) : 8;
  const validCounts = twoThreeCellCounts(n);
  const k = outline ? outline.cells.length : (validCounts[0] ?? 3);
  const rotation = outline ? inferRotation(outline, n, k) : 0;
  const baseDenom = outline ? Math.round(4 / outline.cellBeats) : DEFAULT_DENOM;

  const variation = eff.drumVariationOutline;
  const vDenom = variation ? Math.round(4 / variation.cellBeats) : DEFAULT_DENOM;
  // Detour default grid follows the section's meter (8 for 4/4), not a
  // hardcoded 7/8 — most songs are 4/4.
  const vN = variation ? outlineNumerator(variation) : (outline ? outlineNumerator(outline) : eighthNoteNumerator(eff));
  const vValid = twoThreeCellCounts(vN);
  const vK = variation ? variation.cells.length : (vValid[0] ?? 3);
  const vRot = variation ? inferRotation(variation, vN, vK) : 0;

  const necklace = resolveSectionVoiceNecklaces(eff, song.concept);
  const outlineNecklaces = outline ? resolveOutlineVoiceNecklaces(outline) : null;
  // The selected outline cell, self-clamped as cells are added/removed.
  const selectedCell = outline ? Math.min(cellIndex, outline.cells.length - 1) : null;
  // The selected detour cell, self-clamped the same way.
  const vSelectedCell = variation ? Math.min(vCellIndex, variation.cells.length - 1) : null;
  const variantTotal = variantCount(eff.drumPattern);

  // Per-voice override editing — pick ANY voice (not just ones already in
  // the base). Giving rim / crash / toms their own pattern adds them to the
  // timeline, layered on top of the section's base groove.
  const voiceChoices: KitVoice[] = VOICE_ORDER;
  const activeVoice =
    voice && voiceChoices.includes(voice)
      ? voice
      : (voiceChoices.find((v) => eff.drumVoicePatterns?.[v]) ??
         (necklace ? voiceChoices.find((v) => necklace.some((n) => n.voice === v)) : undefined) ??
         voiceChoices[0]);
  const voicePat = activeVoice && eff.drumVoicePatterns ? eff.drumVoicePatterns[activeVoice] : undefined;
  // Voice-pattern default grid follows the section's meter (8 for 4/4), not
  // a hardcoded 7 — so "3 / 7" doesn't show on a 4/4 song's every voice.
  const voiceN = voicePat?.n ?? (outline ? outlineNumerator(outline) : eighthNoteNumerator(eff));
  const voiceK = voicePat?.k ?? Math.min(3, voiceN);
  const voiceRot = voicePat?.rotation ?? 0;
  const voiceHasBase = necklace ? necklace.some((n) => n.voice === activeVoice) : false;

  function draftWith(updater: (sec: BlueprintSection) => BlueprintSection) {
    setDraft(activeSection.id, updater({ ...eff }));
  }

  function apply() {
    if (!isDraft || !draftSection) return;
    updateCurrentSong((s) => updateSection(s, activeSection.id, () => draftSection));
    clearDraft();
  }

  /** Auto toggles: on → let the engine pick the groove; clicking it again
   *  turns it off and restores the last explicit preset (or "standard").
   *  Either way, leaving auto also drops any Euclidean outline. */
  function toggleAuto() {
    if (mode === "auto") {
      const restore = lastPresetRef.current ?? "standard";
      draftWith((sec) => ({
        ...sec,
        drumPattern: restore,
        drumVariantIndex: sec.drumVariantIndex ?? 0,
        drumMeterOutline: undefined,
      }));
    } else {
      if (eff.drumPattern) lastPresetRef.current = eff.drumPattern;
      draftWith((sec) => ({ ...sec, drumPattern: undefined, drumVariantIndex: undefined, drumMeterOutline: undefined }));
    }
  }

  /** Switch the section to Euclidean (outline) authoring — a drum meter
   *  independent of the section's time signature. Starts from the
   *  section's own meter at an 8th-note grid (8 → 4/4, 7 → 7/8, ...); the
   *  Euclid sliders + cell editor reshape it into any 2s/3s grouping. The
   *  current preset is remembered so Auto/Preset can restore it. */
  function enterOutline() {
    if (mode === "outline") return;
    if (eff.drumPattern) lastPresetRef.current = eff.drumPattern;
    // Default the outline to the section's own meter at an 8th-note grid
    // (8 for 4/4) rather than a fixed 7/8 — most songs are 4/4.
    const num = eighthNoteNumerator(eff);
    draftWith((sec) => ({
      ...sec,
      drumPattern: undefined,
      drumVariantIndex: undefined,
      drumMeterOutline: sec.drumMeterOutline ?? buildEuclideanOutline(num, 8, twoThreeCellCounts(num)[0] ?? 3, 0),
    }));
  }

  function setPreset(val: string) {
    draftWith((sec) => ({
      ...sec,
      drumPattern: val ? (val as DrumPattern) : undefined,
      drumVariantIndex: val ? 0 : undefined,
      drumMeterOutline: undefined,
    }));
  }

  function stepVariant(delta: number) {
    const total = variantCount(eff.drumPattern);
    if (total <= 1) return;
    draftWith((sec) => {
      const cur = sec.drumVariantIndex ?? 0;
      return { ...sec, drumVariantIndex: Math.max(0, Math.min(total - 1, cur + delta)) };
    });
  }

  /** Regenerate the whole section's rhythm as a free-form Euclidean meter
   *  outline (odd meters / hand-edited pulses) — shown right away with the
   *  Euclid sliders. Mirrors the export priority: outline beats preset. */
  function setOutline(nv: number, kv: number, rv: number) {
    draftWith((sec) => ({
      ...sec,
      drumMeterOutline: buildEuclideanOutline(nv, baseDenom, kv, rv),
    }));
  }

  // ---- Whole-section outline cell editing — the 2s/3s grouping and each
  // cell's kick/snare/hat downbeat (`cellVoices`), both honored at export.
  // ---- These mutate the outline's cells/voices directly (never silently
  // regenerating them from a slider), keeping manual edits intact.

  function setOutlineDenominator(denom: number) {
    draftWith((sec) =>
      sec.drumMeterOutline
        ? { ...sec, drumMeterOutline: { ...sec.drumMeterOutline, cellBeats: 4 / denom } }
        : sec,
    );
  }

  function toggleOutlineCell(i: number) {
    draftWith((sec) => {
      const o = sec.drumMeterOutline;
      if (!o) return sec;
      const cells = o.cells.slice();
      cells[i] = cells[i] === 2 ? 3 : 2;
      return { ...sec, drumMeterOutline: { ...o, cells, label: countLabel(cells) } };
    });
  }

  function setOutlineCellVoice(i: number, voice: DrumCellVoice) {
    draftWith((sec) => {
      const o = sec.drumMeterOutline;
      if (!o) return sec;
      const cellVoices = (o.cellVoices ?? o.cells.map(() => "hat" as DrumCellVoice)).slice();
      cellVoices[i] = voice;
      return { ...sec, drumMeterOutline: { ...o, cellVoices } };
    });
  }

  /** Inserts a fresh 2-cell right after `afterIndex` (`cells.length - 1`
   *  from the UI appends at the end) rather than only ever appending — a
   *  repeating odd-meter figure is usually easiest to build by growing it
   *  from wherever you're looking. */
  function insertOutlineCell(afterIndex: number) {
    draftWith((sec) => {
      const o = sec.drumMeterOutline;
      if (!o) return sec;
      const at = afterIndex + 1;
      const cells = [...o.cells.slice(0, at), 2 as const, ...o.cells.slice(at)];
      const cellVoices = o.cellVoices
        ? [...o.cellVoices.slice(0, at), "hat" as DrumCellVoice, ...o.cellVoices.slice(at)]
        : undefined;
      return { ...sec, drumMeterOutline: { ...o, cells, cellVoices, label: countLabel(cells) } };
    });
  }

  function removeOutlineCell(i: number) {
    draftWith((sec) => {
      const o = sec.drumMeterOutline;
      if (!o || o.cells.length <= 1) return sec; // never empty out entirely
      const cells = o.cells.filter((_, idx) => idx !== i);
      const cellVoices = o.cellVoices ? o.cellVoices.filter((_, idx) => idx !== i) : undefined;
      return { ...sec, drumMeterOutline: { ...o, cells, cellVoices, label: countLabel(cells) } };
    });
  }


  function setVariation(nv: number, kv: number, rv: number) {
    draftWith((sec) => ({
      ...sec,
      drumVariationOutline: buildEuclideanOutline(nv, vDenom, kv, rv),
      drumVariationBars: sec.drumVariationBars ?? 1,
    }));
  }

  function clearVariation() {
    draftWith((sec) => ({ ...sec, drumVariationOutline: undefined, drumVariationBars: undefined, drumVariationStartBeat: undefined }));
  }

  function setVariationBars(bars: number) {
    draftWith((sec) => ({ ...sec, drumVariationBars: Math.max(1, bars) }));
  }

  /** Move the detour's start to a section-relative beat (clamped so it
   *  never overruns the section edge) — set from the timeline's beat-dot
   *  lane or the Start control here. */
  function setVariationStart(beat: number) {
    draftWith((sec) => {
      const bpb = beatsPerBar(sec);
      const duration = sec.bars * bpb;
      const span = Math.min((sec.drumVariationBars ?? 1) * bpb, duration);
      return { ...sec, drumVariationStartBeat: Math.max(0, Math.min(Math.round(beat), duration - span)) };
    });
  }

  // ---- Detour (variation) cell editing — the same 2s/3s + cellVoices
  // surface as the whole-section outline, so a detour's shape is authored
  // identically (and the export honors `cellVoices` here too).

  function setVariationDenominator(denom: number) {
    draftWith((sec) =>
      sec.drumVariationOutline
        ? { ...sec, drumVariationOutline: { ...sec.drumVariationOutline, cellBeats: 4 / denom } }
        : sec,
    );
  }

  function toggleVariationCell(i: number) {
    draftWith((sec) => {
      const o = sec.drumVariationOutline;
      if (!o) return sec;
      const cells = o.cells.slice();
      cells[i] = cells[i] === 2 ? 3 : 2;
      return { ...sec, drumVariationOutline: { ...o, cells, label: countLabel(cells) } };
    });
  }

  function setVariationCellVoice(i: number, voice: DrumCellVoice) {
    draftWith((sec) => {
      const o = sec.drumVariationOutline;
      if (!o) return sec;
      const cellVoices = (o.cellVoices ?? o.cells.map(() => "hat" as DrumCellVoice)).slice();
      cellVoices[i] = voice;
      return { ...sec, drumVariationOutline: { ...o, cellVoices } };
    });
  }

  function insertVariationCell(afterIndex: number) {
    draftWith((sec) => {
      const o = sec.drumVariationOutline;
      if (!o) return sec;
      const at = afterIndex + 1;
      const cells = [...o.cells.slice(0, at), 2 as const, ...o.cells.slice(at)];
      const cellVoices = o.cellVoices
        ? [...o.cellVoices.slice(0, at), "hat" as DrumCellVoice, ...o.cellVoices.slice(at)]
        : undefined;
      return { ...sec, drumVariationOutline: { ...o, cells, cellVoices, label: countLabel(cells) } };
    });
  }

  function removeVariationCell(i: number) {
    draftWith((sec) => {
      const o = sec.drumVariationOutline;
      if (!o || o.cells.length <= 1) return sec; // never empty out entirely
      const cells = o.cells.filter((_, idx) => idx !== i);
      const cellVoices = o.cellVoices ? o.cellVoices.filter((_, idx) => idx !== i) : undefined;
      return { ...sec, drumVariationOutline: { ...o, cells, cellVoices, label: countLabel(cells) } };
    });
  }

  function setTransitionModel(model: DrumTransitionModel | null) {
    draftWith((sec) => ({
      ...sec,
      drumTransitionModel: model ?? undefined,
      drumTransitionBars: model ? (sec.drumTransitionBars ?? 1) : undefined,
    }));
  }

  function setTransitionBars(bars: number) {
    draftWith((sec) => ({ ...sec, drumTransitionBars: Math.max(1, bars) }));
  }

  function setVoicePattern(v: KitVoice, nv: number, kv: number, rv: number) {
    draftWith((sec) => ({
      ...sec,
      drumVoicePatterns: { ...sec.drumVoicePatterns, [v]: { k: kv, n: nv, rotation: rv } },
    }));
  }

  function clearVoicePattern(v: KitVoice) {
    draftWith((sec) => {
      const o = { ...(sec.drumVoicePatterns ?? {}) };
      delete o[v];
      return { ...sec, drumVoicePatterns: o };
    });
  }

  return (
    <div className="p-2.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Pattern · {section.name}</span>
        {isDraft && (
          <span className="font-mono text-3xs uppercase tracking-wider text-[#E8B54A]">● preview</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <div className="flex gap-1 flex-1 min-w-0">
          {(["pattern", "variation", "transition"] as ToolTab[]).map((t) => (
            <button key={t} className={tab === t ? TAB_ON : TAB} onClick={() => setTab(t)}>
              {t === "variation" ? "Detour" : t === "pattern" ? "Pattern" : "Transition"}
            </button>
          ))}
        </div>
        <button
          className={mode === "auto" ? CHIP_ON : CHIP}
          onClick={toggleAuto}
          title={
            mode === "auto"
              ? "Auto is on — click to switch back to a preset groove"
              : "Let the engine pick this section's groove from role / meter / velocity"
          }
        >
          Auto
        </button>
        <button
          className={mode === "outline" ? CHIP_ON : CHIP}
          onClick={enterOutline}
          title={
            mode === "outline"
              ? "Euclidean mode is on — this section's drums run an outline meter independent of the section's time signature"
              : "Switch to Euclidean odd-meter authoring — a drum meter independent of the section's time signature"
          }
        >
          Euclid
        </button>
        <select
          className="w-40 shrink-0 bg-panelAlt border border-edge rounded px-2 py-1 text-xs text-ink"
          value={mode === "preset" ? (eff.drumPattern ?? "") : ""}
          onChange={(e) => setPreset(e.target.value)}
          title="Named pattern preset for the whole section — Auto defers to the engine"
        >
          <option value="">Preset…</option>
          <optgroup label="Common">
            {["none", "kick_only", "standard", "half_time", "driving", "bridge_sparse", "intense", "dnb"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </optgroup>
          <optgroup label="Odd meter">
            {["78", "68", "54"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </optgroup>
        </select>
        {variantTotal > 1 && (
          <div className="flex items-center gap-1 shrink-0" title="Which variant of this preset to use">
            <button className={CHIP} onClick={() => stepVariant(-1)}>◀</button>
            <span className="font-mono text-2xs tabular-nums text-ink min-w-[44px] text-center">
              {(eff.drumVariantIndex ?? 0) + 1}/{variantTotal}
            </span>
            <button className={CHIP} onClick={() => stepVariant(1)}>▶</button>
          </div>
        )}
        {isDraft && (
          <div className="flex items-center gap-1 shrink-0" title="Commit or discard the working draft">
            <button
              className="font-mono text-2xs rounded px-2 py-1 border border-accent text-accent bg-accent/10 hover:bg-accent/20"
              onClick={apply}
            >
              Apply
            </button>
            <button
              className="font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink"
              onClick={clearDraft}
            >
              Revert
            </button>
          </div>
        )}
      </div>

      {tab === "pattern" && (
        <div className="space-y-2.5">
          {/* Voice by voice — the primary shape editor, always on. All voice
              chips on the left in two columns (7 / 6), the Euclidean pattern
              in the middle, the Length/Density/Offset sliders on the right. */}
          <div className="flex items-start gap-3">
            {/* Left — all 13 voice chips, two columns (7 / 6). */}
            <div className="flex gap-1.5 shrink-0">
              <div className="flex flex-col items-stretch gap-0.5">
                {voiceChoices.slice(0, 7).map((v) => (
                  <button
                    key={v}
                    className={v === activeVoice ? CHIP_ON : CHIP}
                    onClick={() => setVoice(v)}
                    title={eff.drumVoicePatterns?.[v] ? "has its own pattern" : undefined}
                  >
                    {VOICE_LABEL[v] ?? v}
                  </button>
                ))}
              </div>
              <div className="flex flex-col items-stretch gap-0.5">
                {voiceChoices.slice(7).map((v) => (
                  <button
                    key={v}
                    className={v === activeVoice ? CHIP_ON : CHIP}
                    onClick={() => setVoice(v)}
                    title={eff.drumVoicePatterns?.[v] ? "has its own pattern" : undefined}
                  >
                    {VOICE_LABEL[v] ?? v}
                  </button>
                ))}
              </div>
            </div>

            {/* Middle — large Euclidean pattern display, centered in the
                space between the chip columns and the sliders. */}
            {activeVoice && (
              <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
                <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">
                  {VOICE_LABEL[activeVoice]} · pattern
                </span>
                <NecklaceRow large necklaces={necklace ? necklace.filter((n) => n.voice === activeVoice) : null} />
                <EuclidStepView k={voiceK} n={voiceN} rotation={voiceRot} color="#E8B54A" large />
                <p className="font-mono text-2xs text-inkMuted">
                  {voiceK} / {voiceN} · rot {voiceRot}
                </p>
                <p className="text-2xs text-inkMuted/70 text-center">
                  {voicePat
                    ? "This voice's own groove."
                    : voiceHasBase
                      ? "Uses the base pattern — drag a slider to give this voice its own."
                      : "Not in this section's base — drag a slider to add it."}
                </p>
              </div>
            )}

            {/* Right — sliders. */}
            {activeVoice && (
              <div className="w-44 shrink-0">
                <FreeSliders
                  n={voiceN}
                  k={voiceK}
                  rotation={voiceRot}
                  onChange={(nv, kv, rv) => setVoicePattern(activeVoice, nv, kv, rv)}
                />
                {voicePat ? (
                  <button
                    className="w-full font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink mt-2"
                    onClick={() => clearVoicePattern(activeVoice)}
                  >
                    Reset to base
                  </button>
                ) : (
                  <p className="text-2xs text-inkMuted/70 mt-1">Move a slider to give this voice its own pattern.</p>
                )}
              </div>
            )}
          </div>

          {/* Whole-section Euclidean — at the bottom: it's only meaningful
              for genuine outline/odd-meter sections (a named preset isn't
              one k/n). For preset/auto sections just show a compact
              overview of the resolved groove. */}
          {outline ? (
            <div className="border-t border-edge/60 pt-2.5 space-y-2">
              <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block">
                Euclidean · whole section
              </span>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <NecklaceRow necklaces={outlineNecklaces} />
                  <StepView outline={outline} color="#E8B54A" />
                  <p className="font-mono text-2xs text-inkMuted">
                    {k} / {n} · rot {rotation} · {outline.label}
                  </p>
                </div>
                <div className="w-44 shrink-0 space-y-2.5">
                  <EuclidSliders n={n} denom={baseDenom} k={k} rotation={rotation} onChange={setOutline} />
                  {/* Grid — /8 (eighths) vs /16 (sixteenths), the one
                      meter knob the Euclid sliders don't cover. */}
                  <div>
                    <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted mb-0.5 block">Grid</span>
                    <div className="flex gap-1">
                      {[8, 16].map((d) => (
                        <button
                          key={d}
                          className={baseDenom === d ? CHIP_ON : CHIP}
                          onClick={() => setOutlineDenominator(d)}
                          title={d === 8 ? "x/8 meter — cells are half-beats" : "x/16 meter — cells are quarter-beats"}
                        >
                          /{d}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Cell editor — the 2s/3s grouping (Ferguson apple/gallop) and
                  each cell's kick/snare/hat downbeat voice (`cellVoices`),
                  both of which the export honors. */}
              <div className="border-t border-edge/40 pt-2">
                <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
                  Cells · {outline.label}
                </span>
                <div className="flex flex-wrap gap-1 items-center">
                  {outline.cells.map((cell, i) => {
                    const voice = outline.cellVoices?.[i] ?? "hat";
                    const sel = i === selectedCell;
                    return (
                      <button
                        key={i}
                        className="flex flex-col items-center gap-0.5 rounded border px-1.5 py-1"
                        style={{ borderColor: sel ? "#F5E7C8" : "#2E2E34", backgroundColor: sel ? "#232838" : "transparent" }}
                        onClick={() => setCellIndex(i)}
                        title={`Cell ${i + 1}: ${cell} beats, plays ${CELL_VOICE_LABEL[voice]}`}
                      >
                        <span className="font-mono text-sm text-ink leading-none">{cell}</span>
                        <span className="w-3 h-1.5 rounded-full" style={{ backgroundColor: CELL_VOICE_COLOR[voice] }} />
                      </button>
                    );
                  })}
                  <button
                    className="rounded border border-dashed border-edge text-inkMuted hover:text-ink px-2 py-1 text-xs"
                    onClick={() => insertOutlineCell(outline.cells.length - 1)}
                    title="Add a cell at the end"
                  >
                    +
                  </button>
                </div>

                {selectedCell !== null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border border-edge/60 rounded p-1.5 bg-panelAlt">
                    <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">
                      Cell {selectedCell + 1} of {outline.cells.length}
                    </span>
                    <button
                      className={CHIP}
                      onClick={() => toggleOutlineCell(selectedCell)}
                      title="Toggle 2 ⇄ 3 beats (apple / galloping)"
                    >
                      {outline.cells[selectedCell]} ⇄ 2/3
                    </button>
                    <div className="flex gap-1" title="Which voice this cell's downbeat plays">
                      {(["kick", "snare", "hat"] as DrumCellVoice[]).map((v) => {
                        const active = (outline.cellVoices?.[selectedCell] ?? "hat") === v;
                        const color = CELL_VOICE_COLOR[v];
                        return (
                          <button
                            key={v}
                            className="font-mono text-2xs rounded px-1.5 py-0.5 border"
                            style={{
                              borderColor: active ? color : "#2E2E34",
                              color: active ? "#12161D" : color,
                              backgroundColor: active ? color : "transparent",
                            }}
                            onClick={() => setOutlineCellVoice(selectedCell, v)}
                          >
                            {CELL_VOICE_LABEL[v]}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="font-mono text-3xs text-inkMuted hover:text-ink"
                      onClick={() => insertOutlineCell(selectedCell)}
                    >
                      + insert after
                    </button>
                    <button
                      className="font-mono text-3xs text-inkMuted hover:text-red-400 disabled:opacity-30 disabled:hover:text-inkMuted"
                      onClick={() => removeOutlineCell(selectedCell)}
                      disabled={outline.cells.length <= 1}
                    >
                      remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : necklace ? (
            <div className="border-t border-edge/60 pt-2.5">
              <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
                Pattern · whole section
              </span>
              <NecklaceRow necklaces={necklace} />
            </div>
          ) : null}
        </div>
      )}

      {tab === "variation" && (
        <div className="space-y-3">
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Detour · this section's ending rhythm detour
            </span>
            {variation ? (
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <NecklaceRow necklaces={resolveOutlineVoiceNecklaces(variation)} />
                    <StepView outline={variation} color="#D9954A" />
                    <p className="font-mono text-2xs text-inkMuted">{vK} / {vN} · rot {vRot} · {variation.label}</p>
                  </div>
                  <div className="w-44 shrink-0 space-y-2.5">
                    <EuclidSliders n={vN} denom={vDenom} k={vK} rotation={vRot} onChange={setVariation} />
                    {/* Grid — /8 (eighths) vs /16 (sixteenths), same knob as the
                        whole-section outline editor. */}
                    <div>
                      <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted mb-0.5 block">Grid</span>
                      <div className="flex gap-1">
                        {[8, 16].map((d) => (
                          <button
                            key={d}
                            className={vDenom === d ? CHIP_ON : CHIP}
                            onClick={() => setVariationDenominator(d)}
                            title={d === 8 ? "x/8 meter — cells are half-beats" : "x/16 meter — cells are quarter-beats"}
                          >
                            /{d}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detour cells — the 2s/3s grouping + per-cell downbeat voice,
                    same editor as the whole-section outline. */}
                <div className="border-t border-edge/40 pt-2">
                  <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
                    Detour cells · {variation.label}
                  </span>
                  <div className="flex flex-wrap gap-1 items-center">
                    {variation.cells.map((cell, i) => {
                      const voice = variation.cellVoices?.[i] ?? "hat";
                      const sel = i === vSelectedCell;
                      return (
                        <button
                          key={i}
                          className="flex flex-col items-center gap-0.5 rounded border px-1.5 py-1"
                          style={{ borderColor: sel ? "#F5E7C8" : "#2E2E34", backgroundColor: sel ? "#232838" : "transparent" }}
                          onClick={() => setVCellIndex(i)}
                          title={`Cell ${i + 1}: ${cell} beats, plays ${CELL_VOICE_LABEL[voice]}`}
                        >
                          <span className="font-mono text-sm text-ink leading-none">{cell}</span>
                          <span className="w-3 h-1.5 rounded-full" style={{ backgroundColor: CELL_VOICE_COLOR[voice] }} />
                        </button>
                      );
                    })}
                    <button
                      className="rounded border border-dashed border-edge text-inkMuted hover:text-ink px-2 py-1 text-xs"
                      onClick={() => insertVariationCell(variation.cells.length - 1)}
                      title="Add a cell at the end"
                    >
                      +
                    </button>
                  </div>

                  {vSelectedCell !== null && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border border-edge/60 rounded p-1.5 bg-panelAlt">
                      <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">
                        Cell {vSelectedCell + 1} of {variation.cells.length}
                      </span>
                      <button
                        className={CHIP}
                        onClick={() => toggleVariationCell(vSelectedCell)}
                        title="Toggle 2 ⇄ 3 beats (apple / galloping)"
                      >
                        {variation.cells[vSelectedCell]} ⇄ 2/3
                      </button>
                      <div className="flex gap-1" title="Which voice this cell's downbeat plays">
                        {(["kick", "snare", "hat"] as DrumCellVoice[]).map((v) => {
                          const active = (variation.cellVoices?.[vSelectedCell] ?? "hat") === v;
                          const color = CELL_VOICE_COLOR[v];
                          return (
                            <button
                              key={v}
                              className="font-mono text-2xs rounded px-1.5 py-0.5 border"
                              style={{
                                borderColor: active ? color : "#2E2E34",
                                color: active ? "#12161D" : color,
                                backgroundColor: active ? color : "transparent",
                              }}
                              onClick={() => setVariationCellVoice(vSelectedCell, v)}
                            >
                              {CELL_VOICE_LABEL[v]}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        className="font-mono text-3xs text-inkMuted hover:text-ink"
                        onClick={() => insertVariationCell(vSelectedCell)}
                      >
                        + insert after
                      </button>
                      <button
                        className="font-mono text-3xs text-inkMuted hover:text-red-400 disabled:opacity-30 disabled:hover:text-inkMuted"
                        onClick={() => removeVariationCell(vSelectedCell)}
                        disabled={variation.cells.length <= 1}
                      >
                        remove
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Start beat</span>
                  {(() => {
                    const bpb = beatsPerBar(eff);
                    const duration = eff.bars * bpb;
                    const span = Math.min((eff.drumVariationBars ?? 1) * bpb, duration);
                    const maxStart = Math.max(0, duration - span);
                    const activeStart = eff.drumVariationStartBeat ?? maxStart;
                    return (
                      <div className="flex items-center gap-2">
                        <button className={CHIP} onClick={() => setVariationStart(activeStart - 1)} title="Move the detour earlier">−</button>
                        <span className="font-mono text-2xs tabular-nums text-ink">{activeStart}</span>
                        <button className={CHIP} onClick={() => setVariationStart(activeStart + 1)} title="Move the detour later">+</button>
                        <button className={CHIP} onClick={() => draftWith((sec) => ({ ...sec, drumVariationStartBeat: undefined }))} title="Anchor the detour at the section's end">
                          end
                        </button>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Bars</span>
                  <div className="flex items-center gap-2">
                    <button className={CHIP} onClick={() => setVariationBars((eff.drumVariationBars ?? 1) - 1)}>−</button>
                    <span className="font-mono text-2xs tabular-nums text-ink">{eff.drumVariationBars ?? 1}</span>
                    <button className={CHIP} onClick={() => setVariationBars((eff.drumVariationBars ?? 1) + 1)}>+</button>
                  </div>
                </div>
                <button className="w-full font-mono text-2xs rounded px-2 py-1 border border-edge text-inkMuted hover:text-ink" onClick={clearVariation}>
                  Clear variation
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-2xs text-inkMuted">No variation set.</p>
                <button className={CHIP_ON} onClick={() => setVariation(vN, vK, 0)}>
                  Add detour
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "transition" && (
        <div className="space-y-3">
          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Transition · this section's ending
            </span>
            <div className="flex flex-wrap gap-1 mb-2">
              <button className={!eff.drumTransitionModel ? CHIP_ON : CHIP} onClick={() => setTransitionModel(null)}>
                none
              </button>
              {TRANSITION_MODELS.map((m) => {
                const active = eff.drumTransitionModel === m;
                const color = TRANSITION_COLOR[m];
                return (
                  <button
                    key={m}
                    className={CHIP}
                    style={
                      active
                        ? { color, borderColor: color, backgroundColor: `${color}1a` }
                        : undefined
                    }
                    onClick={() => setTransitionModel(m)}
                  >
                    {TRANSITION_LABEL[m]}
                  </button>
                );
              })}
            </div>
            {!eff.drumTransitionModel && autoPlan && autoPlan.model && (
              <div className="mb-2 rounded border border-edge px-2 py-1.5">
                <span className="font-mono text-2xs text-ink">
                  Auto:{" "}
                  <span style={{ color: TRANSITION_COLOR[autoPlan.model] }}>
                    {TRANSITION_LABEL[autoPlan.model]}
                  </span>
                  {" · "}
                  {autoPlan.bars} bar{autoPlan.bars > 1 ? "s" : ""}
                  {autoNextName ? <> into {autoNextName}</> : ""}
                </span>
                <p className="text-2xs text-inkMuted/70">
                  Assigned by role — pick a chip above to override.
                </p>
              </div>
            )}
            {eff.drumTransitionModel && (
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Bars</span>
                <div className="flex items-center gap-2">
                  <button className={CHIP} onClick={() => setTransitionBars((eff.drumTransitionBars ?? 1) - 1)}>−</button>
                  <span className="font-mono text-2xs tabular-nums text-ink">{eff.drumTransitionBars ?? 1}</span>
                  <button className={CHIP} onClick={() => setTransitionBars((eff.drumTransitionBars ?? 1) + 1)}>+</button>
                </div>
              </div>
            )}
            {eff.drumTransitionModel && (
              <div className="border-t border-edge/40 pt-2">
                <TransitionPreview
                  section={eff}
                  concept={song.concept}
                  model={eff.drumTransitionModel}
                  transitionBars={eff.drumTransitionBars ?? 1}
                />
              </div>
            )}
          </div>

          <div>
            <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Pattern at this section
            </span>
            {outline ? (
              <div className="space-y-1.5">
                <NecklaceRow necklaces={outlineNecklaces} />
                <StepView outline={outline} color="#E8B54A" />
              </div>
            ) : necklace ? (
              <NecklaceRow necklaces={necklace} />
            ) : (
              <p className="text-3xs text-inkMuted italic">No resolvable hits.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
