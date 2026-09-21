/**
 * detectBend — analysis → Bend ratings ("what the song suggests").
 *
 * Pure mapping from artifacts we already compute to values on the SAME
 * axes the Mix/Bend station writes, so the panel can show "detected"
 * ghosts and the user stays in charge of adopting them:
 *
 *   drums profile (JSON)  → energy · density · backbeat
 *   bass profile (JSON)   → bassRegister · bassMotion · bassRhythm
 *   the chord stream      → harmony (Color) · tension
 *   captured melody notes → melodyContour (when any section has one)
 *
 * Deliberately NOT detected yet (documented, honest gaps):
 *   feel  — needs a swing/jitter metric on drum onsets
 *   kit   — spectral tilt/decay heuristics, low confidence
 *   articulation — needs the Other-stem onset-spread pass
 *   bassVelocity — needs an absolute level calibration
 *   tempo — already a first-class song value (the detectors write it
 *           directly), so it never needs "adopting".
 *
 * Profile inputs are structural subsets of the analyzer JSONs, so this
 * module never imports the script outputs or the Python stack.
 */

import type { StyleProfile } from "@drum/library";
import type { BlueprintSong } from "../../types/blueprint";

export interface DrumProfileLike {
  sections?: Array<{ bars?: number; energyDb?: number }>;
  global?: {
    kick?: { hits_per_bar?: number };
    snare?: { hits_per_bar?: number; periodicity?: Record<string, number> };
    hat?: { hits_per_bar?: number };
  };
}

export interface BassProfileLike {
  overall?: {
    register_med?: string; // e.g. "D2"
    notes_per_bar?: number;
    fifth_pct?: number;
  };
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** "D2" / "C#3" → MIDI note number (C4 = 60). Null when unparseable. */
function midiFromName(name: string | undefined): number | null {
  if (!name) return null;
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const pc = NOTE_NAMES.indexOf(m[1] + m[2]);
  if (pc < 0) return null;
  return 12 * (Number(m[3]) + 1) + pc;
}

export function detectBendRatings(
  song: BlueprintSong,
  profiles: { drums?: DrumProfileLike; bass?: BassProfileLike } = {},
): Partial<StyleProfile> {
  const out: Partial<StyleProfile> = {};

  // --- Harmony (Color + Tension) — from the chord stream -----------------
  const chords = song.sections.flatMap((s) => s.chords);
  if (chords.length > 0) {
    const seven = chords.filter((c) => c.quality.includes("7")).length;
    const special = chords.filter((c) => c.quality === "dim" || c.quality === "aug" || c.quality === "m7b5").length;
    const accidental = chords.filter((c) => /[#b]/.test(c.romanNumeral ?? "")).length;
    out.harmony = r2(clamp01(seven / chords.length));
    out.tension = r2(clamp01((0.6 * special) / chords.length + (0.4 * accidental) / chords.length));
  }

  // --- Drums — from the drum-stem profile --------------------------------
  const d = profiles.drums;
  if (d) {
    const secs = (d.sections ?? []).filter((s) => (s.bars ?? 0) > 0);
    const bars = secs.reduce((n, s) => n + (s.bars ?? 0), 0);
    if (bars > 0) {
      const db = secs.reduce((n, s) => n + (s.energyDb ?? -30) * (s.bars ?? 0), 0) / bars;
      out.energy = r2(clamp01((db + 40) / 26)); // −40 dBFS → 0 · −14 dBFS → 1
    }
    const two = d.global?.snare?.periodicity?.twoBeat;
    if (two != null) out.backbeat = r2(clamp01((two - 0.3) / 0.5));
    const hits =
      (d.global?.kick?.hits_per_bar ?? 0) +
      (d.global?.snare?.hits_per_bar ?? 0) +
      (d.global?.hat?.hits_per_bar ?? 0);
    if (hits > 0) out.density = r2(clamp01((hits - 4) / 20)); // 4 → 0 · 24 → 1
  }

  // --- Bass — from the bass-stem profile ---------------------------------
  const o = profiles.bass?.overall;
  if (o) {
    const midi = midiFromName(o.register_med);
    if (midi != null) out.bassRegister = r2(clamp01((midi - 33) / 15)); // G#1 → 0 · C3 → 1
    if (o.fifth_pct != null) out.bassMotion = r2(clamp01(0.15 + 0.5 * Math.min(1, o.fifth_pct / 20)));
    if (o.notes_per_bar != null) out.bassRhythm = r2(clamp01((o.notes_per_bar - 1) / 3.5));
  }

  // --- Melody contour — only when a line was captured --------------------
  const melody = song.sections.flatMap((s) => s.melody?.notes ?? []);
  if (melody.length >= 4) {
    const ivs = melody.slice(1).map((n, i) => Math.abs(n.pitch - melody[i].pitch));
    const sorted = [...ivs].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const leapShare = ivs.filter((v) => v > 4).length / ivs.length;
    out.melodyContour = r2(clamp01(0.25 * Math.min(1, med / 4) + 0.75 * leapShare));
  }

  return out;
}
