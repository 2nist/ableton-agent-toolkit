/**
 * Real clip-note editing via AbletonOSC — the actual replacement for
 * Ableton's Clip View Pitch/Time/Transform/Generate tools, which turned out
 * not to be reachable through MIDI Map Mode. This talks to the Live Object
 * Model directly (get/add/remove notes on the currently-selected clip),
 * verified against AbletonOSC's real source (`abletonosc/clip.py`,
 * `abletonosc/view.py` in github.com/ideoforms/AbletonOSC):
 *
 *   - `/live/view/get/selected_clip` -> (track_index, scene_index), HAS a reply
 *   - `/live/clip/get/notes [track, clip]` -> flattened (pitch, start_time,
 *     duration, velocity, mute) tuples, HAS a reply
 *   - `/live/clip/add/notes [track, clip, ...same fields...]` -> NO reply
 *   - `/live/clip/remove/notes [track, clip, (range)]` -> NO reply
 *   - `/live/clip/get/length [track, clip]` -> beats, HAS a reply
 *   - `/live/clip/duplicate_loop [track, clip]` -> NO reply
 *
 * add/remove having no reply matters: writeNotes() below uses fire-and-forget
 * `send()`, not `request()` — awaiting a reply that will never arrive would
 * just burn the request timeout for nothing.
 *
 * v1 scope, deliberately modest: each bank exposes ONE real transform,
 * using up to 2-3 of that bank's 8 faders as parameters (the rest reserved
 * for later). Every scene button / grid pad in a bank fires that same
 * action — there's no room yet to give 72 physical triggers 72 distinct
 * meanings without a lot more design work, so this is a clear v1
 * simplification, not a hidden limitation.
 */
import type { OscBridgeClient } from "./osc";
import type { BankName } from "./router";

/** UI labels for each bank's 8 faders — mirrors what the transform functions below actually read. */
export const BANK_FADER_LABELS: Record<BankName, string[]> = {
  pitch: ["Transpose (st)", "Octave", "", "", "", "", "", ""],
  time: ["Quantize", "Swing", "", "", "", "", "", ""],
  transform: ["Velocity", "Reverse >64", "", "", "", "", "", ""],
  generate: ["Pulses", "Pitch", "", "", "", "", "", ""],
  clip_tools: ["", "", "", "", "", "", "", ""],
};

/** UI label for what pressing a trigger (scene button/grid pad) does in each bank. */
export const BANK_TRIGGER_LABEL: Record<BankName, string> = {
  pitch: "Apply transpose",
  time: "Apply quantize",
  transform: "Apply transform",
  generate: "Generate rhythm",
  clip_tools: "Duplicate loop",
};

export interface ClipRef {
  track: number;
  clip: number;
}

export interface ClipNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity: number;
  mute: number;
}

/** `/live/view/get/selected_clip` -> the clip currently selected in Live, or null if the reply is malformed. */
export async function getSelectedClip(osc: OscBridgeClient): Promise<ClipRef | null> {
  const args = await osc.request("/live/view/get/selected_clip", []);
  const track = args[0];
  const clip = args[1];
  if (typeof track !== "number" || typeof clip !== "number") return null;
  return { track, clip };
}

/**
 * `/live/clip_slot/get/has_clip [track, clip]` -> whether that slot actually
 * contains a clip.
 */
export async function hasClip(osc: OscBridgeClient, ref: ClipRef): Promise<boolean> {
  const args = await osc.request("/live/clip_slot/get/has_clip", [ref.track, ref.clip]);
  return args[0] === true || args[0] === 1;
}

/**
 * `getSelectedClip` + a has_clip check, combined. `/live/view/get/
 * selected_clip` always returns SOME track/scene index — whatever's
 * highlighted in Live's session view, even an empty slot. Reading notes
 * from an empty slot (`/live/clip/get/notes`) crashes inside AbletonOSC's
 * own script and no reply is ever sent back, so a caller that skips this
 * check discovers the problem only after a 3-second timeout, every single
 * time. This fails fast instead, with an actionable reason.
 */
export async function getSelectedClipWithNotes(osc: OscBridgeClient): Promise<ClipRef | null> {
  const ref = await getSelectedClip(osc);
  if (!ref) return null;
  const present = await hasClip(osc, ref);
  return present ? ref : null;
}

/** Full-range note read (AbletonOSC defaults to pitch 0-127, time -8192..8192 when no range args are given). */
export async function readNotes(osc: OscBridgeClient, ref: ClipRef): Promise<ClipNote[]> {
  const args = await osc.request("/live/clip/get/notes", [ref.track, ref.clip]);
  const notes: ClipNote[] = [];
  for (let i = 0; i + 4 < args.length; i += 5) {
    const [pitch, startTime, duration, velocity, mute] = args.slice(i, i + 5) as number[];
    notes.push({ pitch, startTime, duration, velocity, mute });
  }
  return notes;
}

/** Clip length in beats, or a sane fallback if the reply is malformed. */
export async function getClipLength(osc: OscBridgeClient, ref: ClipRef): Promise<number> {
  const args = await osc.request("/live/clip/get/length", [ref.track, ref.clip]);
  const length = args[0];
  return typeof length === "number" && length > 0 ? length : 4;
}

/** Replace ALL notes in the clip with `notes` (fire-and-forget — neither call has a reply). */
export function writeNotes(osc: OscBridgeClient, ref: ClipRef, notes: ClipNote[]): void {
  osc.send("/live/clip/remove/notes", [ref.track, ref.clip]);
  const flattened = notes.flatMap((n) => [
    n.pitch,
    n.startTime,
    n.duration,
    clampVelocity(n.velocity),
    n.mute,
  ]);
  if (flattened.length > 0) osc.send("/live/clip/add/notes", [ref.track, ref.clip, ...flattened]);
}

export function duplicateLoop(osc: OscBridgeClient, ref: ClipRef): void {
  osc.send("/live/clip/duplicate_loop", [ref.track, ref.clip]);
}

export function clearAllNotes(osc: OscBridgeClient, ref: ClipRef): void {
  osc.send("/live/clip/remove/notes", [ref.track, ref.clip]);
}

// ---------------------------------------------------------------------------
// Parameter mapping — a raw 0-127 fader value to a centered range, e.g.
// fader=64 (the middle) -> 0, fader=0 -> -magnitude, fader=127 -> +magnitude.
// ---------------------------------------------------------------------------

function centered(faderValue: number, magnitude: number): number {
  return ((faderValue - 64) / 64) * magnitude;
}

function clampPitch(pitch: number): number {
  return Math.max(0, Math.min(127, Math.round(pitch)));
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function clampVelocity(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity)));
}

// ---------------------------------------------------------------------------
// Per-bank transforms
// ---------------------------------------------------------------------------

/** Pitch bank: fader 1 = transpose (+/-24 semitones), fader 2 = octave shift (+/-2 octaves). */
export function transformPitch(notes: ClipNote[], faders: number[]): ClipNote[] {
  const semitones = Math.round(centered(faders[0] ?? 64, 24));
  const octaves = Math.round(centered(faders[1] ?? 64, 2));
  const shift = semitones + octaves * 12;
  return notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + shift) }));
}

/** Time bank: fader 1 = quantize strength (0-1, snap to a 1/16 grid), fader 2 = swing (+/-50% of a 16th). */
export function transformTime(notes: ClipNote[], faders: number[]): ClipNote[] {
  const strength = (faders[0] ?? 0) / 127;
  const swing = centered(faders[1] ?? 64, 0.5);
  const grid = 0.25; // 1/16 note, in beats — fixed for v1
  return notes.map((n) => {
    const stepIndex = Math.round(n.startTime / grid);
    const snapped = stepIndex * grid;
    const quantized = n.startTime + (snapped - n.startTime) * strength;
    const swung = stepIndex % 2 !== 0 ? quantized + swing * grid : quantized;
    return { ...n, startTime: Math.max(0, swung) };
  });
}

/** Transform bank: fader 1 = velocity scale (0-2x, centered at 1x), fader 2 > 64 = reverse (retrograde). */
export function transformTransform(notes: ClipNote[], faders: number[], clipLength: number): ClipNote[] {
  const velocityScale = (faders[0] ?? 64) / 64;
  const reverse = (faders[1] ?? 0) > 64;
  return notes.map((n) => ({
    ...n,
    velocity: clampVelocity(n.velocity * velocityScale),
    startTime: reverse ? Math.max(0, clipLength - n.startTime - n.duration) : n.startTime,
  }));
}

/**
 * Simplified Euclidean rhythm (Bresenham-line approximation, not the full
 * recursive Bjorklund algorithm) — distributes `pulses` hits as evenly as
 * possible across `steps` slots. Good enough for a generator trigger; exact
 * Bjorklund equivalence isn't a requirement here.
 */
export function euclideanPattern(pulses: number, steps: number): boolean[] {
  if (steps <= 0) return [];
  if (pulses <= 0) return new Array(steps).fill(false);
  if (pulses >= steps) return new Array(steps).fill(true);
  const pattern: boolean[] = [];
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      pattern.push(true);
    } else {
      pattern.push(false);
    }
  }
  return pattern;
}

/**
 * Generate bank: fader 1 = pulse count (1-16 of 16 steps), fader 2 = pitch
 * (spans roughly C1-C5). Replaces the clip's notes with a generated
 * Euclidean rhythm across its full length, rather than transforming the
 * existing ones.
 */
export function generateEuclidean(faders: number[], clipLength: number): ClipNote[] {
  const pulses = Math.max(1, Math.min(16, Math.round(((faders[0] ?? 64) / 127) * 16)));
  const pitch = clampPitch(36 + ((faders[1] ?? 64) / 127) * 48);
  const steps = 16;
  const stepLength = clipLength / steps;
  const pattern = euclideanPattern(pulses, steps);
  const notes: ClipNote[] = [];
  pattern.forEach((hit, i) => {
    if (!hit) return;
    notes.push({
      pitch,
      startTime: i * stepLength,
      duration: stepLength * 0.9,
      velocity: 100,
      mute: 0,
    });
  });
  return notes;
}

/**
 * Live computed values for a bank's faders — what will actually happen if
 * the trigger is pressed right now, at the current fader positions. Uses
 * the exact same math as the transform functions above (kept in sync
 * manually — there are only 4 banks with fader-driven params, not worth a
 * generic abstraction yet). This is what closes the "move a fader, get no
 * feedback until after you've already applied it" gap: the UI shows this
 * next to each fader instead of just its static name.
 */
export function describeBankParams(bank: BankName, faders: number[]): string[] {
  const blank = ["", "", "", "", "", "", "", ""];
  switch (bank) {
    case "pitch": {
      const semitones = Math.round(centered(faders[0] ?? 64, 24));
      const octaves = Math.round(centered(faders[1] ?? 64, 2));
      return [`${signed(semitones)} st`, `${signed(octaves)} oct`, ...blank.slice(2)];
    }
    case "time": {
      const strengthPct = Math.round(((faders[0] ?? 0) / 127) * 100);
      const swingPct = Math.round(centered(faders[1] ?? 64, 50));
      return [`${strengthPct}%`, `${signed(swingPct)}%`, ...blank.slice(2)];
    }
    case "transform": {
      const velocityScale = ((faders[0] ?? 64) / 64).toFixed(2);
      const reverse = (faders[1] ?? 0) > 64;
      return [`${velocityScale}x`, reverse ? "reverse: ON" : "reverse: off", ...blank.slice(2)];
    }
    case "generate": {
      const pulses = Math.max(1, Math.min(16, Math.round(((faders[0] ?? 64) / 127) * 16)));
      const pitch = clampPitch(36 + ((faders[1] ?? 64) / 127) * 48);
      return [`${pulses}/16 steps`, `pitch ${pitch}`, ...blank.slice(2)];
    }
    case "clip_tools":
      return blank;
  }
}

// ---------------------------------------------------------------------------
// Orchestration — one entry point per bank, called on any trigger press
// ---------------------------------------------------------------------------

export type ApplyResult = { ok: true; noteCount: number } | { ok: false; error: string };

export async function applyBankTransform(
  osc: OscBridgeClient,
  bank: BankName,
  faders: number[],
): Promise<ApplyResult> {
  try {
    const ref = await getSelectedClipWithNotes(osc);
    if (!ref) return { ok: false, error: "no clip in the selected slot" };

    if (bank === "generate") {
      const clipLength = await getClipLength(osc, ref);
      const notes = generateEuclidean(faders, clipLength);
      writeNotes(osc, ref, notes);
      return { ok: true, noteCount: notes.length };
    }

    const existing = await readNotes(osc, ref);
    let notes: ClipNote[];
    switch (bank) {
      case "pitch":
        notes = transformPitch(existing, faders);
        break;
      case "time":
        notes = transformTime(existing, faders);
        break;
      case "transform": {
        const clipLength = await getClipLength(osc, ref);
        notes = transformTransform(existing, faders, clipLength);
        break;
      }
      case "clip_tools":
        // Clip Tools' scene buttons are wired directly to duplicateLoop/
        // clearAllNotes in store.ts, not through this generic path.
        return { ok: false, error: "clip_tools has no fader-driven transform" };
    }
    writeNotes(osc, ref, notes);
    return { ok: true, noteCount: notes.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
