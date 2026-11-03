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
import { resolveArrangement } from "../../types/blueprint";
import type { BlueprintSong, Chord, ChordPerformanceEffect } from "../../types/blueprint";
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
  inversion: number;
  open: boolean;
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

/**
 * The filename a preset gets, mirroring `PresetStore::sanitiseName` in the
 * plug-in. Duplicated on purpose (the main process sanitises again): the same
 * name has to reach the same file on every path, or one progression would end
 * up saved twice under slightly different names.
 *
 * The rule is "drop only what a filename cannot hold", not "keep letters and
 * digits": the plug-in used to test letters with `iswalnum`, which follows the C
 * locale, so "Café Minor" became "Caf Minor" in some hosts and not others.
 */
const UNSAFE_IN_FILE_NAME = /[/\\:*?"<>|\u0000-\u001f\u007f]/;

export function sanitisePresetName(name: string): string {
  const cleaned = Array.from(name.trim())
    .filter((character) => !UNSAFE_IN_FILE_NAME.test(character))
    .join("")
    .trim();
  const shortened = Array.from(cleaned).slice(0, 64).join("");
  const trimmed = shortened.replace(/^\.+/, "").replace(/\.+$/, "");
  return trimmed === "" ? "Untitled" : trimmed;
}

/** One `<slot/>` line, exactly as the plug-in writes it. */
function slotLine(chord: Chord, indent: string): string {
  const { performance, param, direction } = performanceOf(chord);
  const attributes = [
    `root="${pitchClass(chord.root)}"`,
    `quality="${escapeAttribute(chord.quality)}"`,
    `beats="${chord.beats}"`,
    `performance="${performance}"`,
    `param="${param}"`,
    `direction="${direction}"`,
  ];

  // Root position, close, is the default, so it stays unspoken: a chord with no
  // voicing writes exactly the bytes it always did.
  const inversion = Math.round(chord.voicing?.inversion ?? 0);
  if (inversion !== 0) attributes.push(`inversion="${inversion}"`);
  if (chord.voicing?.spread === "open") attributes.push('spread="open"');

  return `${indent}<slot ${attributes.join(" ")}/>`;
}

function xmlDocument(lines: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n\n${lines.join("\n")}\n`;
}

/** Serialises a strip of chords as a plug-in preset. */
export function toTdpPresetXml(chords: readonly Chord[], tagName = "TrackDraftPreset"): string {
  const lines = [`<${tagName} version="1" count="${chords.length}">`];
  for (const chord of chords) lines.push(slotLine(chord, "  "));
  lines.push(`</${tagName}>`);
  return xmlDocument(lines);
}

/**
 * A whole song, for the plug-in's song player.
 *
 * The plug-in plays one section at a time, so the app has to say which sections
 * exist, in which order, and how often each one comes round — which is exactly
 * `sections` plus `resolveArrangement`. Sections with no chords are left out:
 * the plug-in has nothing to play for them, and the arrangement is expressed in
 * section positions, so dropping one cannot shift the rest.
 *
 * Written with the same slot lines as a preset, so the two files cannot disagree
 * about how a chord is spelled.
 */
export function toTdpSongXml(song: BlueprintSong): string {
  const playable = song.sections.filter((section) => section.chords.length > 0);
  const positionOf = new Map(playable.map((section, index) => [section.id, index]));

  const passes = resolveArrangement(song)
    .map((entry) => ({
      section: positionOf.get(entry.sectionId) ?? -1,
      repeats: Math.max(1, Math.round(entry.repeats || 1)),
    }))
    .filter((pass) => pass.section >= 0);

  const lines = [`<TrackDraftSong version="2" count="${playable.length}">`];
  for (const section of playable) {
    lines.push(`  <section name="${escapeAttribute(section.name)}">`);
    lines.push(`    <progression version="1" count="${section.chords.length}">`);
    for (const chord of section.chords) lines.push(slotLine(chord, "      "));
    lines.push("    </progression>");
    lines.push("  </section>");
  }

  lines.push("  <arrangement>");
  for (const pass of passes)
    lines.push(`    <pass section="${pass.section}" repeats="${pass.repeats}"/>`);
  lines.push("  </arrangement>");
  lines.push("</TrackDraftSong>");

  return xmlDocument(lines);
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

    const inversion = Math.round(Number(attributes.inversion ?? 0));
    if (inversion < 0 || inversion > 15) {
      warnings.push(`Unknown inversion ${attributes.inversion} read as root position`);
    }

    slots.push({
      root,
      quality: quality as ChordQuality,
      beats: Number.isFinite(beats) && beats > 0 ? beats : 4,
      performance: performance >= 1 && performance <= 3 ? performance : 0,
      param: Number(attributes.param ?? 0) || 0,
      direction: Number(attributes.direction ?? DEFAULT_DIRECTION),
      inversion: inversion > 0 && inversion <= 15 ? inversion : 0,
      open: attributes.spread === "open",
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

    if (slot.inversion !== 0 || slot.open) {
      chord.voicing = {
        ...(slot.inversion !== 0 ? { inversion: slot.inversion } : {}),
        ...(slot.open ? { spread: "open" as const } : {}),
      };
    }

    return chord;
  });

  return { chords, warnings };
}
