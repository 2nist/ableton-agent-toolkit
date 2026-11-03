/**
 * The progression preset format shared with the VST3 (`plugins/trackdraft`).
 *
 * Both sides write the same XML, and both sides are tested against the same
 * bytes: `plugins/trackdraft/Tests/PluginTests.cpp --dump-xml` prints the
 * plug-in's output and `tdpPreset.test.ts` parses that exact string. That is the
 * only way to keep two languages honest about one file format — a golden each
 * side generates for itself proves nothing.
 *
 * What a slot holds, and why it is not just "C major":
 *
 * - `root` is a pitch class, not a note name, so a preset is key-independent and
 *   the reading key decides the spelling;
 * - `quality` is the app's own `ChordQuality` id, which the plug-in adopted
 *   verbatim — the tables are shared, not translated;
 * - `beats` makes the cycle the sum of its slots;
 * - `performance` / `param` / `direction` carry the articulation: 0 block,
 *   1 strum (param = spread in ms), 2 pulse (param = subdivision), 3 arp
 *   (param = subdivision, direction 0 up / 1 down / 2 up-down).
 *
 * Parsing is deliberately a small attribute reader rather than a DOM: the format
 * is a flat list of `<slot/>` elements, this runs in both the browser and the
 * Electron renderer, and a DOM dependency in a pure module buys nothing.
 */

import { CHORD_INTERVALS, noteName, pitchClass } from "@music-theory/core";
import type { ChordQuality, NoteName } from "@music-theory/core";
import type { Chord, ChordPerformanceEffect } from "../../types/blueprint";
import { uuid } from "../uuid";

export interface TdpPreset {
  chords: Chord[];
  /** Everything that had to be simplified, in the order it was found. */
  warnings: string[];
}

interface SlotXml {
  root: number;
  quality: ChordQuality;
  beats: number;
  performance: number;
  param: number;
  direction: number;
}

/** The plug-in's default articulation values; also what "block" means. */
const DEFAULT_STRUM_MS = 150;
const DEFAULT_SUBDIVISION = 4;
const DEFAULT_DIRECTION = 2;

const PERFORMANCE_BY_KIND: Record<number, "strum" | "pulse" | "arp"> = {
  1: "strum",
  2: "pulse",
  3: "arp",
};

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function performanceOf(chord: Chord): { performance: number; param: number; direction: number } {
  const effect = chord.performance;
  if (!effect) return { performance: 0, param: 0, direction: DEFAULT_DIRECTION };

  const params = effect.params ?? {};
  if (effect.style === "strum") {
    return {
      performance: 1,
      param: Math.round(params.strumMs ?? DEFAULT_STRUM_MS),
      direction: DEFAULT_DIRECTION,
    };
  }
  if (effect.style === "pulse") {
    return {
      performance: 2,
      param: Math.round(params.subdivision ?? DEFAULT_SUBDIVISION),
      direction: DEFAULT_DIRECTION,
    };
  }
  return {
    performance: 3,
    param: Math.round(params.subdivision ?? DEFAULT_SUBDIVISION),
    direction: Math.round(params.direction ?? DEFAULT_DIRECTION),
  };
}

function performanceEffect(slot: SlotXml): ChordPerformanceEffect | undefined {
  const style = PERFORMANCE_BY_KIND[slot.performance];
  if (!style) return undefined;

  if (style === "strum") return { style, params: { strumMs: slot.param || DEFAULT_STRUM_MS } };
  if (style === "pulse") return { style, params: { subdivision: slot.param || DEFAULT_SUBDIVISION } };
  return {
    style,
    params: {
      subdivision: slot.param || DEFAULT_SUBDIVISION,
      direction: slot.direction,
    },
  };
}

/** Serialises a strip of chords as a plug-in preset. */
export function toTdpPresetXml(chords: readonly Chord[], tagName = "TrackDraftPreset"): string {
  const lines = [`<${tagName} version="1" count="${chords.length}">`];

  for (const chord of chords) {
    const { performance, param, direction } = performanceOf(chord);
    const attributes = [
      `root="${pitchClass(chord.root)}"`,
      `quality="${escapeAttribute(chord.quality)}"`,
      `beats="${chord.beats}"`,
      `performance="${performance}"`,
      `param="${param}"`,
      `direction="${direction}"`,
    ];
    lines.push(`  <slot ${attributes.join(" ")}/>`);
  }

  lines.push(`</${tagName}>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n\n${lines.join("\n")}\n`;
}

function readAttributes(element: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(element)) !== null) attributes[match[1]] = match[2];
  return attributes;
}

function isQuality(value: string): value is ChordQuality {
  return Object.prototype.hasOwnProperty.call(CHORD_INTERVALS, value);
}

/**
 * Reads a preset written by either side.
 *
 * Never throws for content it can read but does not like: an unknown quality
 * falls back to major, an unreadable root drops that slot, and each case is
 * reported in `warnings` so the caller can show what happened. A file with no
 * slots at all throws, because an empty progression is an error at the call
 * site rather than a degraded success.
 */
export function parseTdpPresetXml(xml: string, keyName: NoteName = "C"): TdpPreset {
  const warnings: string[] = [];
  const slots: SlotXml[] = [];

  const slotPattern = /<slot\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = slotPattern.exec(xml)) !== null) {
    const attributes = readAttributes(match[1]);
    const root = Number(attributes.root);
    const beats = Number(attributes.beats ?? 4);

    if (!Number.isFinite(root) || root < 0 || root > 11) {
      warnings.push(`Dropped a slot with an unreadable root "${attributes.root ?? ""}"`);
      continue;
    }

    let quality = attributes.quality ?? "maj";
    if (!isQuality(quality)) {
      warnings.push(`Unknown quality "${quality}" read as major`);
      quality = "maj";
    }

    const performance = Number(attributes.performance ?? 0);
    if (performance < 0 || performance > 3) {
      warnings.push(`Unknown articulation ${attributes.performance} read as block`);
    }

    slots.push({
      root,
      quality: quality as ChordQuality,
      beats: Number.isFinite(beats) && beats > 0 ? beats : 4,
      performance: performance >= 1 && performance <= 3 ? performance : 0,
      param: Number(attributes.param ?? 0) || 0,
      direction: Number(attributes.direction ?? DEFAULT_DIRECTION),
    });
  }

  if (slots.length === 0) {
    throw new Error("Preset contains no readable slots");
  }

  const chords: Chord[] = slots.map((slot) => {
    const chord: Chord = {
      id: uuid(),
      // Empty on purpose: `lib/harmony/analysis` derives every numeral from
      // (root, quality, home) and treats a stored string as a source label.
      romanNumeral: "",
      root: noteName(slot.root, keyName),
      quality: slot.quality,
      beats: slot.beats,
    };

    const effect = performanceEffect(slot);
    if (effect) chord.performance = effect;
    return chord;
  });

  return { chords, warnings };
}
