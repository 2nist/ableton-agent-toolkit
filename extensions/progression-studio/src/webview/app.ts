/**
 * Progression Studio webview app. Bundled to a single IIFE by build.ts and
 * inlined into the modal page. Reads corpus data injected as
 * `window.__STUDIO_DATA__` and drives every UI interaction client-side.
 */

import {
  decodeProgression,
  decodeSongIndex,
  findMatchingSongs,
  rankPaths,
  suggestNext,
  tension,
  type SongIndex,
  type TransitionModel,
} from "../../../../packages/progression-engine/src/index.js";

interface StudioLive {
  rootNote: number;
  scaleName: string;
  scaleMode: boolean;
  signatureNumerator: number;
  signatureDenominator: number;
}

interface StudioData {
  model: TransitionModel;
  tension: unknown;
  presets: Record<string, { name: string; degrees: string[]; mode: string }>;
  mode?: "studio" | "melody";
  live?: StudioLive | null;
  /** gzip(base64) of the compact song index (song_sections.json). */
  songsB64?: string;
}

const data = (window as unknown as { __STUDIO_DATA__: StudioData }).__STUDIO_DATA__;
const model: TransitionModel = data.model;
const presets = data.presets;
const MELODY_MODE = data.mode === "melody";
const live: StudioLive | null = data.live ?? null;

/** Song index (loaded async — decompressed from the embedded gzip). */
let songIndex: SongIndex | null = null;
/** base64 -> Uint8Array helper for the DecompressionStream. */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  // Copy into a fresh ArrayBuffer so the type satisfies BlobPart (avoids the
  // ArrayBufferLike/SharedArrayBuffer mismatch TS complains about).
  const buf = new ArrayBuffer(bin.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function loadSongIndex(): Promise<void> {
  if (!data.songsB64 || typeof (window as unknown as { DecompressionStream?: unknown }).DecompressionStream !== "function") {
    return; // no songs data, or the webview can't gunzip — leave index null
  }
  try {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([b64ToBytes(data.songsB64)]).stream().pipeThrough(ds);
    const text = await new Response(stream).text();
    songIndex = decodeSongIndex(text);
  } catch {
    songIndex = null;
  }
}

type Quality = "maj" | "min" | "dim" | "aug" | "7" | "maj7" | "min7" | "m7b5" | "sus2" | "sus4";

interface Card {
  degree: string;
  quality: Quality;
  beats: number;
}

const QUALITIES: Quality[] = ["maj", "min", "7", "maj7", "min7", "m7b5", "dim", "aug", "sus2", "sus4"];
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const OCTAVES = [0, 1, 2, 3, 4, 5];

/**
 * Live's beats per bar (time-signature numerator), sanitized. Live reports an
 * unset scene signature as -1; we fall back to 4/4.
 */
function barBeats(): number {
  const n = live?.signatureNumerator ?? -1;
  return n > 0 && n <= 64 ? n : 4;
}
/**
 * Chord-length options at SINGLE-BEAT resolution (1..16), with the bar-aligned
 * lengths (multiples of the time signature) surfaced first and labeled with how
 * many bars they span — so in 3/4 you get "3 beats (1 bar)" instead of jumping
 * 1→2→4. Labels are computed at render time via beatLabel().
 */
function beatOptions(): number[] {
  const bar = barBeats();
  const opts: number[] = [];
  for (let b = 1; b <= 16; b++) opts.push(b);
  // Bar multiples within range (may already be present, dedupe keeping first).
  for (let m = 1; m * bar <= 16; m++) {
    const v = m * bar;
    if (!opts.includes(v)) opts.push(v);
  }
  return opts;
}
function beatLabel(b: number): string {
  const bar = barBeats();
  const bars = b / bar;
  const whole = Number.isInteger(bars) && bars >= 1;
  if (whole) return `${b} beat${b === 1 ? "" : "s"} (${bars} bar${bars === 1 ? "" : "s"})`;
  return `${b} beat${b === 1 ? "" : "s"}`;
}
/** A freshly added chord lasts one full bar by default. */
function defaultBeats(): number {
  return barBeats();
}

/** ionian degree -> root offset from key (matches @music-theory/core MODE_DATA). */
const OFFSET: Record<string, number> = {
  I: 0, "♭II": 1, ii: 2, "♭III": 3, iii: 4, IV: 5, iv: 5, V: 7, "♭VI": 8, vi: 9, "♭VII": 10, "vii°": 11,
};
/** ionian degree -> default triad quality. */
const TRIAD: Record<string, Quality> = {
  I: "maj", "♭II": "maj", ii: "min", "♭III": "maj", iii: "min", IV: "maj", iv: "min",
  V: "maj", "♭VI": "maj", vi: "min", "♭VII": "maj", "vii°": "dim",
};
const DEGREES = Object.keys(OFFSET);

const state = {
  keyIndex: 0,
  octave: 4,
  variety: true,
  density: 4,
  useLiveKey: true,
  melody: MELODY_MODE,
  flavor: "",
  cards: [] as Card[],
};

function keyPc(): number {
  return state.keyIndex;
}
function rootName(degree: string): string {
  return NOTES[((keyPc() + (OFFSET[degree] ?? 0)) % 12 + 12) % 12];
}
/** Fixed per-degree chord colors (function-based), with black bold labels. */
const DEGREE_COLOR: Record<string, string> = {
  I: "#1F6FEB", // blue — tonic
  iii: "#38BDF8", // sky blue — mediant
  vi: "#14B8A6", // turquoise — submediant
  IV: "#EAB308", // yellow — subdominant
  iv: "#CA8A04", // dark gold — borrowed minor subdominant
  ii: "#F59E0B", // saffron — supertonic
  "vii°": "#F97316", // orange — leading tone
  V: "#DC2626", // red — dominant
  "♭II": "#B91C1C", // crimson — Neapolitan
  "♭III": "#65A30D", // olive
  "♭VI": "#8B5CF6", // violet
  "♭VII": "#A16207", // dark amber
};

function cardColor(degree: string): string {
  return DEGREE_COLOR[degree] ?? "#4E4E4E";
}
function tail(): string[] {
  return state.cards.map((c) => c.degree);
}
/** Suggest options: heavily penalize repeats when "Prefer variety" is on. */
function suggestOpts(): { selfLoopPenalty: number } {
  return { selfLoopPenalty: state.variety ? 0.2 : 1 };
}

function closeWithResult(result: string): void {
  const message = { method: "close_and_send", params: [result] };
  const w = window as unknown as {
    webkit?: { messageHandlers?: { live?: { postMessage(m: unknown): void } } };
    chrome?: { webview?: { postMessage(m: unknown): void } };
  };
  if (w.webkit?.messageHandlers?.live) w.webkit.messageHandlers.live.postMessage(message);
  else if (w.chrome?.webview) w.chrome.webview.postMessage(message);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function render(): void {
  // ---- header selects ----
  const keySel = $("#key") as HTMLSelectElement;
  keySel.innerHTML = NOTES.map((n, i) => `<option value="${i}" ${i === state.keyIndex ? "selected" : ""}>${n}</option>`).join("");
  const octSel = $("#octave") as HTMLSelectElement;
  octSel.innerHTML = OCTAVES.map((o) => `<option value="${o}" ${o === state.octave ? "selected" : ""}>${o}</option>`).join("");
  const varietyChk = $("#variety") as HTMLInputElement;
  varietyChk.checked = state.variety;
  const useLiveChk = $("#useLiveKey") as HTMLInputElement | null;
  if (useLiveChk) useLiveChk.checked = state.useLiveKey;
  const melodyChk = $("#melody") as HTMLInputElement | null;
  if (melodyChk) melodyChk.checked = state.melody;
  const densitySel = $("#density") as HTMLSelectElement | null;
  if (densitySel) densitySel.value = String(state.density);
  const flavorSel = $("#flavor") as HTMLSelectElement | null;
  if (flavorSel) flavorSel.value = state.flavor;
  const presetSel = $("#preset") as HTMLSelectElement;
  presetSel.innerHTML = `<option value="">—</option>` + Object.entries(presets)
    .map(([key, p]) => `<option value="${esc(key)}">${esc(p.name)}</option>`).join("");

  // ---- tension strip ----
  const strip = $("#strip");
  if (state.cards.length === 0) {
    strip.innerHTML = `<div class="strip-cell" style="background:#3a414a">add chords to see tension</div>`;
  } else {
    strip.innerHTML = state.cards
      .map((c) => `<div class="strip-cell" style="background:${cardColor(c.degree)}" title="${esc(c.degree)} ${tension(model, c.degree).tension.toFixed(2)}">${esc(c.degree)}</div>`)
      .join("");
  }

  // ---- canvas ----
  const canvas = $("#canvas");
  canvas.innerHTML = state.cards.length
    ? state.cards
        .map((c, i) => `
  <div class="card" style="border-left-color:${cardColor(c.degree)}">
    <div class="degree" style="color:${cardColor(c.degree)}">${esc(c.degree)}</div>
    <div class="root">${esc(rootName(c.degree))}</div>
    <select data-i="${i}" data-field="degree">${DEGREES.map((d) => `<option ${d === c.degree ? "selected" : ""}>${d}</option>`).join("")}</select>
    <select data-i="${i}" data-field="quality">${QUALITIES.map((q) => `<option ${q === c.quality ? "selected" : ""}>${q}</option>`).join("")}</select>
    <select data-i="${i}" data-field="beats">${beatOptions().map((b) => `<option value="${b}" ${b === c.beats ? "selected" : ""}>${beatLabel(b)}</option>`).join("")}</select>
    <span class="tens">${tension(model, c.degree).tension.toFixed(2)}</span>
    <span class="ops">
      <button data-i="${i}" data-op="left" title="Move left">&larr;</button>
      <button data-i="${i}" data-op="right" title="Move right">&rarr;</button>
      <button data-i="${i}" data-op="dup" title="Duplicate">+</button>
      <button data-i="${i}" data-op="del" title="Delete">&times;</button>
    </span>
  </div>`)
        .join("")
    : `<div class="empty">No chords yet — load a preset, add a chord, or click a suggestion.</div>`;

  // ---- suggestions ----
  const sug = $("#suggest");
  if (state.cards.length === 0) {
    sug.innerHTML = `<span class="empty">Add a chord to see corpus-ranked next chords.</span>`;
  } else {
    const next = suggestNext(model, tail().slice(-2), suggestOpts()).slice(0, 7);
    sug.innerHTML = next.length
      ? next
          .map(
            (s) =>
              `<button class="chip" style="background:${cardColor(s.degree)}" data-next="${esc(s.degree)}">${esc(s.degree)} <span class="prob">${(s.probability * 100).toFixed(0)}%</span></button>`,
          )
          .join("")
      : `<span class="empty">No suggestions for this tail.</span>`;
  }

  // ---- paths ----
  const paths = $("#paths");
  if (state.cards.length === 0) {
    paths.innerHTML = `<span class="empty">Add a chord to see top continuations.</span>`;
  } else {
    const ranked = rankPaths(model, tail().slice(-1), 4, 4, suggestOpts());
    paths.innerHTML = ranked.length
      ? ranked
          .map((p) => `<button class="path-btn" data-path="${esc(p.degrees.join(" "))}">${esc(p.degrees.join(" "))} <span class="prob">${(p.probability * 100).toFixed(1)}%</span></button>`)
          .join("")
      : `<span class="empty">No continuations.</span>`;
  }

  // ---- matching songs (lead-sheet corpus) ----
  const songs = $("#songs");
  if (!songs) return;
  if (!songIndex) {
    songs.innerHTML = `<span class="empty">Song matching unavailable (no song index in this build).</span>`;
  } else if (state.cards.length < 2) {
    songs.innerHTML = `<span class="empty">Add at least 2 chords to see songs that use this progression.</span>`;
  } else {
    const degrees = state.cards.map((c) => c.degree);
    const matches = findMatchingSongs(songIndex, degrees, { maxResults: 24 });
    const total = matches.length;
    if (total === 0) {
      songs.innerHTML = `<span class="empty">No songs in the corpus use <b>${esc(degrees.join(" "))}</b> in order.</span>`;
    } else {
      const exact = matches.filter((m) => !m.partial).length;
      const header =
        total > 1
          ? `<div class="songs-head">${total} songs match — ${exact} exact</div>`
          : `<div class="songs-head">1 song matches</div>`;
      songs.innerHTML =
        header +
        matches
          .map(
            (m) =>
              `<div class="song-match${m.partial ? " partial" : ""}" data-load="${esc(m.code)}" title="${m.partial ? "In order with passing chords in between — click to load" : "Click to load this song's progression"}">${esc(m.name)}<span class="song-deg">${esc(decodeProgression(m.code).join(" "))}</span></div>`,
          )
          .join("");
    }
  }
}

function $(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

function addChord(degree: string, quality?: Quality, beats = defaultBeats()): void {
  state.cards.push({ degree, quality: quality ?? TRIAD[degree] ?? "maj", beats });
  render();
}

function bind(): void {
  $("#key").addEventListener("change", (e) => {
    state.keyIndex = Number((e.target as HTMLSelectElement).value);
    render();
  });
  $("#octave").addEventListener("change", (e) => {
    state.octave = Number((e.target as HTMLSelectElement).value);
  });
  $("#variety").addEventListener("change", (e) => {
    state.variety = (e.target as HTMLInputElement).checked;
    render();
  });
  $("#density")?.addEventListener("change", (e) => {
    state.density = Number((e.target as HTMLSelectElement).value);
  });
  $("#melody")?.addEventListener("change", (e) => {
    state.melody = (e.target as HTMLInputElement).checked;
  });
  $("#flavor")?.addEventListener("change", (e) => {
    state.flavor = (e.target as HTMLSelectElement).value;
  });
  $("#useLiveKey")?.addEventListener("change", (e) => {
    state.useLiveKey = (e.target as HTMLInputElement).checked;
    if (state.useLiveKey && live) {
      state.keyIndex = ((live.rootNote % 12) + 12) % 12;
      render();
    }
  });
  $("#preset").addEventListener("change", (e) => {
    const key = (e.target as HTMLSelectElement).value;
    if (!key || !presets[key]) return;
    state.cards = presets[key].degrees.map((d) => ({ degree: d, quality: TRIAD[d] ?? "maj", beats: defaultBeats() }));
    render();
  });
  $("#transposeDown").addEventListener("click", () => {
    state.keyIndex = (state.keyIndex + 11) % 12;
    render();
  });
  $("#transposeUp").addEventListener("click", () => {
    state.keyIndex = (state.keyIndex + 1) % 12;
    render();
  });
  $("#add").addEventListener("click", () => {
    const next = suggestNext(model, tail().slice(-1), suggestOpts());
    addChord(next.length ? next[0].degree : "I");
  });
  $("#render").addEventListener("click", () => {
    if (state.cards.length === 0) return;
    const result = {
      key: NOTES[state.keyIndex],
      octave: state.octave,
      mode: MELODY_MODE ? "melody" : "studio",
      melody: state.melody,
      maxNoteBeats: state.density,
      useLiveKey: state.useLiveKey,
      biTonalFlavor: state.flavor || undefined,
      live: live ? { rootNote: live.rootNote, scaleName: live.scaleName, signatureNumerator: live.signatureNumerator, signatureDenominator: live.signatureDenominator } : null,
      chords: state.cards.map((c) => ({ degree: c.degree, quality: c.quality, durationBeats: c.beats })),
    };
    closeWithResult(JSON.stringify(result));
  });
  $("#cancel").addEventListener("click", () => closeWithResult(""));

  // canvas card editing (delegated)
  $("#canvas").addEventListener("change", (e) => {
    const target = e.target as HTMLSelectElement;
    const i = Number(target.dataset.i);
    const field = target.dataset.field;
    if (field === "degree") state.cards[i].degree = target.value;
    else if (field === "quality") state.cards[i].quality = target.value as Quality;
    else if (field === "beats") state.cards[i].beats = Number(target.value);
    render();
  });
  $("#canvas").addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest("button[data-op]") as HTMLElement | null;
    if (!target) return;
    const i = Number(target.dataset.i);
    const op = target.dataset.op;
    const cards = state.cards;
    if (op === "left" && i > 0) [cards[i - 1], cards[i]] = [cards[i], cards[i - 1]];
    else if (op === "right" && i < cards.length - 1) [cards[i + 1], cards[i]] = [cards[i], cards[i + 1]];
    else if (op === "dup") cards.splice(i + 1, 0, { ...cards[i] });
    else if (op === "del") cards.splice(i, 1);
    render();
  });

  // suggestions / paths
  $("#suggest").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-next]") as HTMLElement | null;
    if (btn) addChord(btn.dataset.next as string);
  });
  $("#paths").addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button[data-path]") as HTMLElement | null;
    if (!btn) return;
    const degrees = (btn.dataset.path as string).split(" ");
    state.cards = degrees.map((d) => ({ degree: d, quality: TRIAD[d] ?? "maj", beats: defaultBeats() }));
    render();
  });

  // matching songs: click a song to load its actual progression
  $("#songs").addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest(".song-match") as HTMLElement | null;
    if (!el || !el.dataset.load) return;
    const degrees = decodeProgression(el.dataset.load);
    if (degrees.length === 0) return;
    state.cards = degrees.map((d) => ({ degree: d, quality: TRIAD[d] ?? "maj", beats: defaultBeats() }));
    render();
  });
}

async function boot(): Promise<void> {
  bind();
  // Start with a sensible default so the studio isn't empty on open.
  state.cards = (presets.pop_progression?.degrees ?? ["I", "V", "vi", "IV"]).map((d) => ({
    degree: d,
    quality: TRIAD[d] ?? "maj",
    beats: defaultBeats(),
  }));
  // Default the key to Live's current scale root when "Live key" is on.
  if (state.useLiveKey && live) {
    state.keyIndex = ((live.rootNote % 12) + 12) % 12;
  }
  render();
  // Decompress the song index (async) then re-render the matching panel.
  await loadSongIndex();
  render();
}

// Boot once the DOM is parsed (robust for both file: previews and the modal's
// data: URL, where inline-script timing can vary).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
