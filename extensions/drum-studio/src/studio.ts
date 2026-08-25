import { ABLETON_DARK } from "@platform/ui-kit";

/**
 * Composes the self-contained Drum Studio HTML page for
 * `Ui.showModalDialog`. The bundled app script + preset preview data are
 * inlined. All data is embedded once as JSON and rendered client-side.
 *
 * Two tabs: **Pattern** (Phase 2 — pick a curated `DrumPattern` + variant)
 * and **Outline** (Phase 3 — build any meter from 2s/3s groups, per Kevin
 * Ferguson's "Mastering Odd, Complex Time Signatures and Rhythms").
 *
 * Styled to match Progression Studio: same layout/class conventions, and
 * the same design-token *values* — but sourced from `@platform/ui-kit`'s
 * `ABLETON_DARK` (built for exactly this: styling Extensions webview
 * modals) rather than a second hand-copied literal, so the two studios can
 * never visually drift apart.
 */

/** Live's current song state, read by the extension and passed to the modal. */
export interface StudioLive {
  signatureNumerator: number;
  signatureDenominator: number;
}

/** One variant's preview shape — trimmed of provenance, which the picker doesn't need. */
export interface PreviewVariant {
  lengthBeats: number;
  beatsPerBar: number;
  notes: [beat: number, pitch: number, velocity: number][];
}

export function buildStudioHtml(
  appJs: string,
  patternsJson: string,
  patternOrder: string[],
  labels: Record<string, string>,
  barOptions: number[],
  outlineNumerators: number[],
  outlineDenominators: number[],
  transitionLabels: Record<string, string>,
  transitionOrder: string[],
  live: StudioLive | null = null,
): string {
  const t = ABLETON_DARK;
  // Escape "<" so embedded JSON can never terminate a script block early.
  const safe = (s: string) => s.replace(/</g, "\\u003c");
  const toJson = (v: unknown) => JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? Number(val) : val));

  const liveReadout = live ? `${live.signatureNumerator}/${live.signatureDenominator}` : "";
  const patternOptions = patternOrder.map((p) => `<option value="${p}">${labels[p] ?? p}</option>`).join("");
  const barOptionsHtml = (selectedDefault: number) =>
    barOptions.map((b) => `<option value="${b}" ${b === selectedDefault ? "selected" : ""}>${b} bar${b === 1 ? "" : "s"}</option>`).join("");
  const velocityOptionsHtml = ["pp", "p", "mp", "mf", "f", "ff"]
    .map((v) => `<option value="${v}" ${v === "mf" ? "selected" : ""}>${v}</option>`)
    .join("");
  const numeratorOptions = outlineNumerators.map((n) => `<option value="${n}">${n}</option>`).join("");
  const denominatorOptions = outlineDenominators.map((d) => `<option value="${d}" ${d === 16 ? "selected" : ""}>${d}</option>`).join("");
  const transitionOptions = transitionOrder.map((m) => `<option value="${m}">${transitionLabels[m] ?? m}</option>`).join("");
  const transitionBarsOptions = [1, 2].map((b) => `<option value="${b}">${b} bar${b === 1 ? "" : "s"}</option>`).join("");
  const prepDenomOptions = outlineDenominators.map((d) => `<option value="${d}">/${d}</option>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Drum Studio</title>
<style>
  /* Ableton's own dark chrome — @platform/ui-kit's ABLETON_DARK tokens. */
  :root { --bg:${t.background}; --panel:${t.panel}; --card:${t.panel}; --border:${t.border}; --text:${t.text}; --muted:${t.textMuted}; --accent:${t.accent}; --accent-hover:${t.accentHover}; --accent-active:${t.accentActive}; --radius:2px; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:-apple-system,"Helvetica Neue",Arial,sans-serif; font-size:11px; background:var(--bg); color:var(--text); height:100vh; display:flex; flex-direction:column; overflow:hidden; }
  header { display:flex; gap:6px; align-items:center; padding:4px 8px; background:var(--panel); border-bottom:1px solid var(--border); flex-wrap:wrap; }
  header h1 { font-size:11px; margin:0 8px 0 0; letter-spacing:.2px; color:var(--text); font-weight:600; }
  header label { display:flex; align-items:center; gap:3px; color:var(--muted); font-size:10px; white-space:nowrap; }
  select, button { background:var(--card); color:var(--text); border:1px solid var(--border); border-radius:var(--radius); padding:1px 5px; font-size:10px; height:19px; cursor:pointer; }
  select:focus, button:focus { outline:1px solid var(--accent); }
  .live-readout { color:var(--accent); font-weight:600; font-size:10px; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#000; font-weight:600; }
  button.primary:hover { background:var(--accent-hover); }
  button.danger { background:transparent; border-color:var(--border); color:var(--muted); }
  .spacer { flex:1; }
  .tabs { display:flex; gap:2px; }
  .tab-btn { background:var(--card); border:1px solid var(--border); color:var(--muted); }
  .tab-btn.active { background:var(--accent); border-color:var(--accent); color:#000; font-weight:600; }
  main { flex:1; overflow-y:auto; padding:6px 8px; }
  section { margin-bottom:7px; }
  h2 { font-size:9px; text-transform:uppercase; letter-spacing:.7px; color:var(--muted); margin:0 0 3px; }
  #variants { display:flex; gap:3px; flex-wrap:wrap; }
  .variant-chip { padding:1px 8px; border-radius:2px; border:1px solid var(--border); background:var(--card); cursor:pointer; font-size:10px; color:var(--text); height:18px; }
  .variant-chip.selected { background:var(--accent); border-color:var(--accent); color:#000; font-weight:600; }
  #grid { display:flex; flex-direction:column; gap:1px; background:var(--border); border:1px solid var(--border); border-radius:2px; overflow:hidden; }
  .grid-row { display:flex; align-items:center; gap:0; background:var(--panel); }
  .grid-row .role { width:64px; flex:none; font-size:9px; color:var(--muted); padding:2px 4px; text-transform:uppercase; letter-spacing:.4px; }
  .grid-row .cells { flex:1; display:flex; gap:1px; }
  .grid-cell { flex:1; height:14px; background:#3a3a3a; border-radius:1px; }
  .grid-cell.accent { background:var(--accent); }
  .grid-cell.hit { background:#7ec699; }
  .empty { color:var(--muted); font-size:10px; }
  #cells { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .cell-group { display:flex; align-items:center; gap:1px; }
  .cell-btn { min-width:26px; height:22px; border-radius:2px; border:1px solid var(--border); background:var(--card); cursor:pointer; font-size:11px; font-weight:700; color:var(--text); }
  .cell-btn[data-size="2"] { color:#7ec699; }
  .cell-btn[data-size="3"] { color:#ffcc66; }
  .voice-btn { min-width:22px; height:22px; border-radius:2px; border:1px solid var(--border); background:#2c2c2c; cursor:pointer; font-size:9px; font-weight:700; color:var(--muted); }
  .voice-btn[data-voice="kick"] { background:var(--accent); border-color:var(--accent); color:#000; }
  .voice-btn[data-voice="snare"] { background:#e05252; border-color:#e05252; color:#000; }
  #mnemonic { font-family:ui-monospace,Menlo,monospace; font-size:11px; color:var(--accent); letter-spacing:1px; }
  .grouping-note { color:var(--muted); font-size:10px; margin-top:3px; }
  #transitionControls { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  #transitionControls label { display:flex; align-items:center; gap:3px; color:var(--muted); font-size:10px; white-space:nowrap; }
  .model-note { color:var(--muted); font-size:10px; margin-top:3px; }
</style>
</head>
<body>
  <header>
    <h1>Drum Studio</h1>
    <span class="tabs">
      <button id="tabPattern" class="tab-btn active" data-tab="pattern">Pattern</button>
      <button id="tabOutline" class="tab-btn" data-tab="outline">Outline</button>
    </span>
    <span id="patternControls">
      <label>Pattern <select id="pattern">${patternOptions}</select></label>
    </span>
    <span id="outlineControls" style="display:none">
      <label>Numerator <select id="numerator">${numeratorOptions}</select></label>
      <label>/ <select id="denominator">${denominatorOptions}</select></label>
      <label>Grouping <select id="grouping"></select></label>
    </span>
    <label>Bars <select id="bars">${barOptionsHtml(4)}</select></label>
    <label>Velocity <select id="velocity">${velocityOptionsHtml}</select></label>
    ${live ? `<label title="Live's current time signature"><span id="liveReadout" class="live-readout">${liveReadout}</span></label>` : ""}
    <span class="spacer"></span>
    <button id="render" class="primary">Render to Live &amp; Close</button>
    <button id="cancel" class="danger">Cancel</button>
  </header>
  <main>
    <section id="variantSection"><h2>Variant</h2><div id="variants"></div></section>
    <section id="outlineSection" style="display:none">
      <h2>Build the meter from 2s and 3s</h2>
      <div id="cells"></div>
      <div class="grouping-note">Click a cell's number to toggle it 2 ⇄ 3, or its voice tag to cycle hat ⇄ kick ⇄ snare. "1 2" (apple) is 2 beats, "1 2 3" (galloping) is 3.</div>
      <h2 style="margin-top:6px">Count</h2>
      <div id="mnemonic"></div>
    </section>
    <section>
      <h2>Transition</h2>
      <div id="transitionControls">
        <label>Model <select id="transitionModel">${transitionOptions}</select></label>
        <label>Length <select id="transitionBars">${transitionBarsOptions}</select></label>
        <label title="Prime the ear for a different subdivision just before the boundary"><input type="checkbox" id="prepMeter" /> Prep meter change</label>
        <label id="prepMeterDenomLabel" style="display:none">to /<select id="prepMeterDenom">${prepDenomOptions}</select></label>
      </div>
      <div class="model-note" id="transitionNote"></div>
    </section>
    <section><h2>Preview</h2><div id="grid"></div></section>
  </main>
<script>
  window.__DRUM_STUDIO_DATA__ = {
    patterns: ${safe(patternsJson)},
    labels: ${safe(toJson(labels))},
    patternOrder: ${safe(toJson(patternOrder))},
    live: ${live ? safe(toJson(live)) : "null"}
  };
</script>
<script>${appJs}</script>
</body>
</html>`;
}
