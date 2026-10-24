import { describe, expect, it } from "vitest";
import { DRUM_LANE_VOICES } from "../src/blocks.js";
import { DRUM_LANE_IDS } from "../src/lanes.js";
import { KIT_PITCHES } from "../src/section.js";
import { voiceOf, VOICE_FALLBACKS, type KitVoice } from "../src/kit.js";

/**
 * The kit's invariant — the tables that must agree about a voice. `Record<
 * KitVoice, …>` gets this from the compiler; the arrays (lane membership) and
 * the pitch map only agree if someone checks, so this test does.
 */
const voices = DRUM_LANE_IDS.flatMap((lane) => DRUM_LANE_VOICES[lane]);

describe("kit voices — one truth across every table", () => {
  it("every voice belongs to exactly one lane", () => {
    const seen = new Map<KitVoice, string>();
    for (const lane of DRUM_LANE_IDS) {
      for (const voice of DRUM_LANE_VOICES[lane]) {
        expect(seen.get(voice)).toBeUndefined();
        seen.set(voice, lane);
      }
    }
    expect(seen.size).toBe(voices.length);
  });

  it("every voice has a pitch, and the pitch reads back as that voice", () => {
    for (const voice of voices) {
      const pitch = KIT_PITCHES[voice];
      expect(pitch, `${voice} has no pitch`).toBeTypeOf("number");
      expect(voiceOf(pitch), `${voice} at pitch ${pitch}`).toBe(voice);
    }
  });

  it("no two voices share a pitch", () => {
    const byPitch = new Map<number, KitVoice>();
    for (const voice of voices) {
      const pitch = KIT_PITCHES[voice];
      expect(byPitch.get(pitch), `${voice} collides with ${byPitch.get(pitch)} at ${pitch}`).toBeUndefined();
      byPitch.set(pitch, voice);
    }
  });

  it("a voice with a fallback points at voices that exist", () => {
    for (const [voice, list] of Object.entries(VOICE_FALLBACKS)) {
      for (const target of list ?? []) {
        expect(voices, `${voice} falls back to unknown ${target}`).toContain(target);
      }
    }
  });

  it("the new percussion voices sit in the PERC lane at their GM pitches", () => {
    expect(DRUM_LANE_VOICES.rim).toEqual(["rim", "clap", "shaker", "cowbell"]);
    expect(KIT_PITCHES.shaker).toBe(82);
    expect(KIT_PITCHES.cowbell).toBe(56);
  });
});
