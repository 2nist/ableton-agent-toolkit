/**
 * Drum Studio webview app. Bundled to a single IIFE by build.ts and inlined
 * into the modal page. Reads preset preview data injected as
 * `window.__DRUM_STUDIO_DATA__` and drives every UI interaction client-side.
 *
 * Two tabs: Pattern (curated `DrumPattern` + variant) and Outline (freeform
 * meter built from 2s/3s cells, per Kevin Ferguson's "Mastering Odd,
 * Complex Time Signatures and Rhythms", with per-cell kick/snare voicing).
 * Both share a Transition section: build up / break down / cut / drop out,
 * optionally primed for a meter change.
 */

import { createBridge } from "../../../../packages/ui-kit/src/index.js";
import { ABLETON_SAFE_NOTES } from "../../../../packages/drum-library/src/ableton.js";
import {
  canonicalGroupings,
  outlineToGroovePattern,
  countLabel,
  numerator as sumCells,
  type CellVoice,
  type MeterCell,
  type MeterOutline,
} from "../../../../packages/drum-library/src/meter.js";

interface PreviewVariant {
  lengthBeats: number;
  beatsPerBar: number;
  notes: [beat: number, pitch: number, velocity: number][];
}

interface StudioLive {
  signatureNumerator: number;
  signatureDenominator: number;
}

interface DrumStudioData {
  patterns: Record<string, PreviewVariant[]>;
  labels: Record<string, string>;
  patternOrder: string[];
  live: StudioLive | null;
}

const data = (window as unknown as { __DRUM_STUDIO_DATA__: DrumStudioData }).__DRUM_STUDIO_DATA__;
const bridge = createBridge();

/** Reverse of `ableton.ts`'s `ABLETON_SAFE_NOTES` — pitch -> row label, same convention `drumRackProbe.ts`'s `ASSUMED` table uses. */
const ROLE_LABEL: Record<number, string> = Object.fromEntries(
  Object.entries(ABLETON_SAFE_NOTES).map(([role, pitch]) => [pitch as number, roleLabel(role)]),
);
function roleLabel(role: string): string {
  return role.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

const TRANSITION_NOTES: Record<string, string> = {
  none: "",
  buildUp: "Density and velocity ramp up toward the boundary, landing on a strong hit that launches the next section.",
  breakDown: "The texture thins out and fades toward the boundary — energy draining out, not a specific voice cut.",
  cut: "One sharp hit, then dead silence for the rest of the span — a hard stop before the next section hits.",
  dropOut: "The groove keeps playing, but the kick (or whichever voice you choose) drops out for the span.",
};

type Tab = "pattern" | "outline";
const VOICE_CYCLE: CellVoice[] = ["hat", "kick", "snare"];

/**
 * A sensible starting groove for a fresh set of cells: kick on the first
 * cell, alternating kick/snare after — so kick and snare are audible and
 * visible immediately, not just theoretically available behind a tiny
 * per-cell button nobody notices on a plain hat-click pattern.
 */
function defaultVoicesFor(cells: readonly MeterCell[]): CellVoice[] {
  return cells.map((_, i) => (i % 2 === 0 ? "kick" : "snare"));
}

const state = {
  tab: "pattern" as Tab,
  // pattern tab
  pattern: data.patternOrder[0] ?? "",
  variantIndex: 0,
  // outline tab
  outlineCells: [2, 3] as MeterCell[],
  outlineCellVoices: defaultVoicesFor([2, 3]),
  outlineDenominator: 16,
  outlineNumeratorChoice: 5,
  outlineGroupingChoice: 0,
  // transition (shared by both tabs)
  transitionModel: "none",
  transitionBars: 1,
  prepMeter: false,
  prepMeterDenom: 8,
  // shared
  bars: 4,
  velocity: "mf",
};

function variants(): PreviewVariant[] {
  return data.patterns[state.pattern] ?? [];
}
function currentVariant(): PreviewVariant | null {
  return variants()[state.variantIndex] ?? null;
}
function currentOutline(): MeterOutline {
  return { cellBeats: 4 / state.outlineDenominator, cells: state.outlineCells, label: countLabel(state.outlineCells) };
}

function $(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

function renderTabs(): void {
  ($("#tabPattern") as HTMLElement).classList.toggle("active", state.tab === "pattern");
  ($("#tabOutline") as HTMLElement).classList.toggle("active", state.tab === "outline");
  $("#patternControls").style.display = state.tab === "pattern" ? "" : "none";
  $("#outlineControls").style.display = state.tab === "outline" ? "" : "none";
  $("#variantSection").style.display = state.tab === "pattern" ? "" : "none";
  $("#outlineSection").style.display = state.tab === "outline" ? "" : "none";
}

function renderGroupingSelect(): void {
  const groupingSel = $("#grouping") as HTMLSelectElement;
  const groupings = canonicalGroupings(state.outlineNumeratorChoice);
  groupingSel.innerHTML = groupings
    .map((cells, i) => `<option value="${i}" ${i === state.outlineGroupingChoice ? "selected" : ""}>${cells.join("+")}</option>`)
    .join("");
}

function renderPreviewGrid(variant: PreviewVariant | null): void {
  const grid = $("#grid");
  if (!variant) {
    grid.innerHTML = `<div class="empty">Nothing to preview.</div>`;
    return;
  }

  // One column per 16th-note (0.25 beat) across the variant's own bar length.
  const resolution = 0.25;
  const columns = Math.max(1, Math.round(variant.lengthBeats / resolution));
  const pitchesInUse = Array.from(new Set(variant.notes.map((n) => n[1]))).sort((a, b) => b - a);

  grid.innerHTML = pitchesInUse.length
    ? pitchesInUse
        .map((pitch) => {
          const label = ROLE_LABEL[pitch] ?? `Note ${pitch}`;
          const hitsAtColumn = new Map<number, number>();
          for (const [beat, notePitch, velocity] of variant.notes) {
            if (notePitch !== pitch) continue;
            hitsAtColumn.set(Math.round(beat / resolution), velocity);
          }
          const cells = Array.from({ length: columns }, (_, col) => {
            const velocity = hitsAtColumn.get(col);
            const onBarStart = col % Math.round(variant.beatsPerBar / resolution) === 0;
            const cls = velocity === undefined ? "" : velocity >= 100 ? " accent" : " hit";
            return `<div class="grid-cell${cls}" title="${onBarStart ? "bar start" : ""}${velocity !== undefined ? ` vel ${velocity}` : ""}"></div>`;
          }).join("");
          return `<div class="grid-row"><span class="role">${label}</span><div class="cells">${cells}</div></div>`;
        })
        .join("")
    : `<div class="empty">Empty variant.</div>`;
}

function renderTransitionControls(): void {
  for (const chip of Array.from(document.querySelectorAll<HTMLElement>(".transition-chip"))) {
    chip.classList.toggle("active", chip.dataset.model === state.transitionModel);
  }
  ($("#transitionBars") as HTMLSelectElement).value = String(state.transitionBars);
  ($("#prepMeter") as HTMLInputElement).checked = state.prepMeter;
  ($("#prepMeterDenom") as HTMLSelectElement).value = String(state.prepMeterDenom);
  $("#prepMeterDenomLabel").style.display = state.prepMeter ? "" : "none";
  $("#transitionNote").textContent = TRANSITION_NOTES[state.transitionModel] ?? "";
}

function voiceLabel(voice: CellVoice): string {
  return voice === "kick" ? "K" : voice === "snare" ? "S" : "·";
}

function render(): void {
  renderTabs();
  renderTransitionControls();

  const barsSel = $("#bars") as HTMLSelectElement;
  barsSel.value = String(state.bars);
  const velocitySel = $("#velocity") as HTMLSelectElement;
  velocitySel.value = state.velocity;

  if (state.tab === "pattern") {
    const patternSel = $("#pattern") as HTMLSelectElement;
    if (patternSel.value !== state.pattern) patternSel.value = state.pattern;

    const variantList = variants();
    const variantsEl = $("#variants");
    variantsEl.innerHTML = variantList.length
      ? variantList
          .map(
            (_, i) =>
              `<button class="variant-chip${i === state.variantIndex ? " selected" : ""}" data-variant="${i}">#${i + 1}</button>`,
          )
          .join("")
      : `<span class="empty">No variants for this pattern.</span>`;

    renderPreviewGrid(currentVariant());
  } else {
    const numeratorSel = $("#numerator") as HTMLSelectElement;
    numeratorSel.value = String(state.outlineNumeratorChoice);
    const denominatorSel = $("#denominator") as HTMLSelectElement;
    denominatorSel.value = String(state.outlineDenominator);
    renderGroupingSelect();

    const outline = currentOutline();
    const cellsEl = $("#cells");
    cellsEl.innerHTML =
      state.outlineCells
        .map((cell, i) => {
          const voice = state.outlineCellVoices[i] ?? "hat";
          return `<span class="cell-group">
            <button class="cell-btn" data-size="${cell}" data-i="${i}" title="Click to toggle 2 ⇄ 3">${cell}</button>
            <button class="voice-btn" data-voice="${voice}" data-voice-i="${i}" title="Click to cycle hat ⇄ kick ⇄ snare">${voiceLabel(voice)}</button>
            <button class="cell-btn" data-del="${i}" title="Remove this cell" style="min-width:16px">×</button>
          </span>`;
        })
        .join("") + `<button id="cellAdd" class="cell-btn" title="Add a cell">+</button>`;

    $("#mnemonic").textContent = `${outline.label}  —  numerator ${sumCells(outline)} (${sumCells(outline)}/${state.outlineDenominator})`;

    const grooveNotes = outlineToGroovePattern(outline, state.outlineCellVoices);
    const previewVariant: PreviewVariant = {
      lengthBeats: outline.cellBeats * sumCells(outline),
      beatsPerBar: outline.cellBeats * sumCells(outline),
      notes: grooveNotes,
    };
    renderPreviewGrid(state.outlineCells.length > 0 ? previewVariant : null);
  }
}

function bind(): void {
  $("#tabPattern").addEventListener("click", () => {
    state.tab = "pattern";
    render();
  });
  $("#tabOutline").addEventListener("click", () => {
    state.tab = "outline";
    render();
  });

  $("#pattern").addEventListener("change", (e) => {
    state.pattern = (e.target as HTMLSelectElement).value;
    state.variantIndex = 0;
    render();
  });
  $("#variants").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-variant]") as HTMLElement | null;
    if (!btn) return;
    state.variantIndex = Number(btn.dataset.variant);
    render();
  });

  $("#numerator").addEventListener("change", (e) => {
    state.outlineNumeratorChoice = Number((e.target as HTMLSelectElement).value);
    state.outlineGroupingChoice = 0;
    state.outlineCells = canonicalGroupings(state.outlineNumeratorChoice)[0]!.slice();
    state.outlineCellVoices = defaultVoicesFor(state.outlineCells);
    render();
  });
  $("#denominator").addEventListener("change", (e) => {
    state.outlineDenominator = Number((e.target as HTMLSelectElement).value);
    render();
  });
  $("#grouping").addEventListener("change", (e) => {
    state.outlineGroupingChoice = Number((e.target as HTMLSelectElement).value);
    state.outlineCells = canonicalGroupings(state.outlineNumeratorChoice)[state.outlineGroupingChoice]!.slice();
    state.outlineCellVoices = defaultVoicesFor(state.outlineCells);
    render();
  });
  $("#cells").addEventListener("click", (e) => {
    const toggleBtn = (e.target as HTMLElement).closest("button[data-i]") as HTMLElement | null;
    const voiceBtn = (e.target as HTMLElement).closest("button[data-voice-i]") as HTMLElement | null;
    const delBtn = (e.target as HTMLElement).closest("button[data-del]") as HTMLElement | null;
    const addBtn = (e.target as HTMLElement).closest("#cellAdd") as HTMLElement | null;
    if (voiceBtn) {
      const i = Number(voiceBtn.dataset.voiceI);
      const current = state.outlineCellVoices[i] ?? "hat";
      state.outlineCellVoices[i] = VOICE_CYCLE[(VOICE_CYCLE.indexOf(current) + 1) % VOICE_CYCLE.length]!;
      render();
    } else if (toggleBtn) {
      const i = Number(toggleBtn.dataset.i);
      state.outlineCells[i] = state.outlineCells[i] === 2 ? 3 : 2;
      render();
    } else if (delBtn) {
      const i = Number(delBtn.dataset.del);
      if (state.outlineCells.length > 1) {
        state.outlineCells.splice(i, 1);
        state.outlineCellVoices.splice(i, 1);
      }
      render();
    } else if (addBtn) {
      state.outlineCells.push(2);
      state.outlineCellVoices.push("hat");
      render();
    }
  });

  $("#transitionModelChips").addEventListener("click", (e) => {
    const chip = (e.target as HTMLElement).closest(".transition-chip") as HTMLElement | null;
    if (!chip?.dataset.model) return;
    state.transitionModel = chip.dataset.model;
    render();
  });
  $("#transitionBars").addEventListener("change", (e) => {
    state.transitionBars = Number((e.target as HTMLSelectElement).value);
  });
  $("#prepMeter").addEventListener("change", (e) => {
    state.prepMeter = (e.target as HTMLInputElement).checked;
    render();
  });
  $("#prepMeterDenom").addEventListener("change", (e) => {
    state.prepMeterDenom = Number((e.target as HTMLSelectElement).value);
  });

  $("#bars").addEventListener("change", (e) => {
    state.bars = Number((e.target as HTMLSelectElement).value);
  });
  $("#velocity").addEventListener("change", (e) => {
    state.velocity = (e.target as HTMLSelectElement).value;
  });

  $("#render").addEventListener("click", () => {
    const transitionFields = {
      transitionModel: state.transitionModel,
      transitionBars: state.transitionBars,
      nextGridDenominator: state.prepMeter ? state.prepMeterDenom : undefined,
    };
    if (state.tab === "pattern") {
      if (!currentVariant()) return;
      bridge.send({
        mode: "pattern",
        pattern: state.pattern,
        variantIndex: state.variantIndex,
        bars: state.bars,
        velocity: state.velocity,
        ...transitionFields,
      });
    } else {
      if (state.outlineCells.length === 0) return;
      bridge.send({
        mode: "outline",
        // The cells (and voices) are the real source of truth after free
        // editing — see render-drum-studio.ts's OutlineStudioResult.
        cells: state.outlineCells,
        cellVoices: state.outlineCellVoices,
        denominator: state.outlineDenominator,
        bars: state.bars,
        velocity: state.velocity,
        ...transitionFields,
      });
    }
  });
  // `bridge.send` JSON.stringifies whatever it's given (unlike the old
  // hand-rolled `closeWithResult(JSON.stringify(...))` pattern), so cancel
  // sends the JSON value `null` rather than a raw empty string — the
  // extension side parses the result and checks for `null` explicitly.
  $("#cancel").addEventListener("click", () => bridge.send(null));
}

function boot(): void {
  bind();
  render();
}

// Boot once the DOM is parsed (robust for both file: previews and the modal's
// data: URL, where inline-script timing can vary).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
