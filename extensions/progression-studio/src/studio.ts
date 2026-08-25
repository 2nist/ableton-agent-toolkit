/**
 * Composes the self-contained Progression Studio HTML page for
 * `Ui.showModalDialog`. The bundled app script + corpus data are inlined.
 * All data is embedded once as JSON and rendered client-side, so nothing
 * from the corpus (which came from real songs) can inject markup.
 *
 * `mode` switches the page between "studio" (render a chord clip) and
 * "melody" (render chords + a melody riding them). Both modes share the same
 * progression editor; melody mode tweaks the title, adds a density control,
 * and labels its action accordingly.
 */
export type StudioMode = "studio" | "melody";

/** Live's current song state, read by the extension and passed to the modal. */
export interface StudioLive {
  /** Scale root as MIDI note number 0 (C) .. 11 (B) from Song.rootNote. */
  rootNote: number;
  scaleName: string;
  scaleMode: boolean;
  /** Song-level time signature. SDK 1.0.0 exposes it per-Scene only, so the
   * extension reads the first scene as the best available proxy (4/4 default). */
  signatureNumerator: number;
  signatureDenominator: number;
}

export function buildStudioHtml(
  appJs: string,
  modelJson: string,
  tensionJson: string,
  presetsJson: string,
  mode: StudioMode = "studio",
  live: StudioLive | null = null,
  songsB64 = "",
): string {
  // Escape "<" so embedded JSON can never terminate a script block early.
  const safe = (s: string) => s.replace(/</g, "\\u003c");
  // JSON that can never crash on BigInt (the SDK's native layer occasionally
  // surfaces values as BigInt even when typed as number).
  const toJson = (v: unknown) =>
    JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? Number(val) : val));
  const isMelody = mode === "melody";
  const title = isMelody ? "Generate Melody" : "Progression Studio";
  const actionLabel = isMelody ? "Generate Melody &amp; Close" : "Render to Live &amp; Close";
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // "C · Major · 4/4" — Live's key + scale + time signature as a readout.
  const liveReadout = live
    ? `${NOTE_NAMES[live.rootNote] ?? "C"} · ${live.scaleName} · ${live.signatureNumerator}/${live.signatureDenominator}`
    : "";
  // Bi-tonal flavors (from @platform/progression-engine) offered in the header.
  // Labels are intentionally ambiguous — just the last word of each vibe.
  const FLAVORS: Array<{ id: string; label: string; hint: string }> = [
    { id: "cinematic_shimmer", label: "Shimmer", hint: "Anchor maj +5th → Maj9" },
    { id: "sci_fi_wonder", label: "Wonder", hint: "Anchor maj +2nd → Maj13(#11)" },
    { id: "bittersweet_drama", label: "Drama", hint: "Anchor maj +7th(min) → Maj9(#11)" },
    { id: "neo_soul_glow", label: "Glow", hint: "Anchor min +m7 → m11" },
    { id: "ambient_ocean", label: "Ocean", hint: "Anchor min +5th → m9" },
    { id: "altered_tension", label: "Tension", hint: "Anchor 7 +b2 → 7(b9#9#11)" },
  ];
  const flavorOptions = FLAVORS.map(
    (f) => `<option value="${f.id}" title="${f.hint}">${f.label}</option>`,
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Progression Studio</title>
<style>
  /* Ableton's own dark chrome — matches @ableton ui-kit ABLETON_DARK tokens. */
  :root { --bg:#383838; --panel:#4E4E4E; --card:#4E4E4E; --border:#2C2C2C; --text:#FFFFFF; --muted:#B0B0B0; --accent:#FFA500; --accent-hover:#FFB733; --accent-active:#CC8400; --radius:2px; }
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
  main { flex:1; overflow-y:auto; padding:6px 8px; }
  section { margin-bottom:7px; }
  h2 { font-size:9px; text-transform:uppercase; letter-spacing:.7px; color:var(--muted); margin:0 0 3px; }
  #strip { display:flex; gap:2px; height:16px; }
  .strip-cell { flex:1; border-radius:2px; display:flex; align-items:center; justify-content:center; font-size:9px; color:#000; font-weight:700; text-shadow:none; overflow:hidden; }
  #canvas { display:flex; flex-direction:column; gap:2px; }
  .card { display:flex; align-items:center; gap:5px; background:var(--panel); border:1px solid var(--border); border-left:3px solid #888; border-radius:2px; padding:2px 6px; }
  .card .degree { font-size:13px; font-weight:700; min-width:26px; }
  .card .root { font-size:10px; color:var(--muted); min-width:26px; }
  .card select { font-size:10px; height:17px; padding:0 2px; }
  .card .tens { font-size:10px; color:var(--muted); min-width:32px; text-align:right; }
  .card .ops button { padding:0 4px; height:17px; font-size:10px; }
  .chips { display:flex; flex-wrap:wrap; gap:3px; }
  .chip { padding:1px 6px; border-radius:2px; border:1px solid var(--border); background:var(--card); cursor:pointer; font-size:10px; color:#000; font-weight:700; height:18px; }
  .chip .prob { opacity:.75; font-size:9px; margin-left:3px; }
  .path-btn { display:inline-block; margin:0 3px 3px 0; padding:1px 6px; border-radius:2px; border:1px solid var(--border); background:var(--card); cursor:pointer; font-size:10px; color:#fff; height:18px; }
  .song-match { padding:1px 6px; margin:0 3px 3px 0; display:inline-flex; align-items:center; gap:5px; border:1px solid var(--border); border-radius:2px; background:var(--card); font-size:10px; color:var(--text); cursor:pointer; }
  .song-match:hover { border-color:var(--accent); }
  .song-match.partial { opacity:.72; border-style:dashed; }
  .song-deg { font-size:9px; color:var(--muted); }
  .songs-head { font-size:10px; color:var(--muted); margin-bottom:3px; }
  .empty { color:var(--muted); font-size:10px; }
  #add { margin-top:3px; height:19px; }
</style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <label>Key <select id="key"></select></label>
    <label>Octave <select id="octave"></select></label>
    <label>Preset <select id="preset"><option value="">—</option></select></label>
    ${live ? `<label title="Use Live's current scale root"><input type="checkbox" id="useLiveKey" checked /> Live key</label>
    <label title="Live's key + time signature"><span id="liveReadout" class="live-readout">${liveReadout}</span></label>` : ""}
    <label title="Penalize repeated chords in suggestions"><input type="checkbox" id="variety" checked /> Variety</label>
    <button id="transposeDown" title="Transpose whole progression down">&#9837;</button>
    <button id="transposeUp" title="Transpose whole progression up">&#9839;</button>
    <label title="Add a monophonic melody over the progression"><input type="checkbox" id="melody" ${isMelody ? "checked" : ""} /> Melody</label>
    <label title="How long each melody note can last; shorter = more notes">Density <select id="density"><option value="8">smooth</option><option value="4" selected>medium</option><option value="2">flowing</option><option value="1">dense</option></select></label>
    <label title="Layer a bi-tonal color chord above the progression">Color <select id="flavor"><option value="">—</option>${flavorOptions}</select></label>
    <span class="spacer"></span>
    <button id="render" class="primary">${actionLabel}</button>
    <button id="cancel" class="danger">Cancel</button>
  </header>
  <main>
    <section><h2>Tension curve</h2><div id="strip"></div></section>
    <section><h2>Progression</h2><div id="canvas"></div><button id="add">+ Add chord</button></section>
    <section><h2>Next chord (from corpus)</h2><div id="suggest" class="chips"></div></section>
    <section><h2>Top paths (corpus-ranked continuations)</h2><div id="paths"></div></section>
    <section><h2>Matching songs (lead sheets)</h2><div id="songs"></div></section>
  </main>
<script>
  window.__STUDIO_DATA__ = {
    model: ${safe(modelJson)},
    tension: ${safe(tensionJson)},
    presets: ${safe(presetsJson)},
    mode: ${isMelody ? '"melody"' : '"studio"'},
    live: ${live ? safe(toJson(live)) : "null"},
    songsB64: ${songsB64 ? safe(JSON.stringify(songsB64)) : '""'}
  };
</script>
<script>${appJs}</script>
</body>
</html>`;
}
