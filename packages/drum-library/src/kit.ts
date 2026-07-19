/**
 * Map E-GMD's General MIDI note numbers onto one-shot samples from a drum
 * machine folder, so a groove can be heard rather than read.
 *
 * The sample library names things however each machine's manufacturer did
 * (`909BDA 01`, `808Oh25 11`, `BD0000 13`), so matching is by scored token
 * search rather than an exact table. Every mapping is reported by the
 * renderer — a silently wrong kick is much harder to notice by ear than a
 * missing one, so the choices are made visible rather than trusted.
 */

/** The voices we render. Several GM notes can collapse onto one of these. */
export type KitVoice =
  | "kick"
  | "snare"
  | "rim"
  | "clap"
  | "closedHat"
  | "openHat"
  | "pedalHat"
  | "ride"
  | "rideBell"
  | "crash"
  | "tomLow"
  | "tomMid"
  | "tomHigh";

/**
 * GM percussion → voice. E-GMD is a Roland TD-11 mapping, which is GM plus
 * the extended hi-hat articulations 22 (closed edge) and 26 (open edge).
 */
const GM_TO_VOICE: Record<number, KitVoice> = {
  35: "kick",
  36: "kick",
  37: "rim",
  38: "snare",
  39: "clap",
  40: "snare",
  41: "tomLow",
  42: "closedHat",
  43: "tomLow",
  44: "pedalHat",
  45: "tomMid",
  46: "openHat",
  47: "tomMid",
  48: "tomHigh",
  49: "crash",
  50: "tomHigh",
  51: "ride",
  52: "crash",
  53: "rideBell",
  55: "crash",
  57: "crash",
  59: "ride",
  22: "closedHat",
  26: "openHat",
};

export function voiceOf(pitch: number): KitVoice | null {
  return GM_TO_VOICE[pitch] ?? null;
}

/**
 * Ordered patterns per voice, most specific first. Order matters more than
 * it looks: `clap` must be tested before `closedHat`, or `909CLAP` matches
 * a "cl" closed-hat rule; `openHat` before `closedHat`, or `Oh25` is read
 * as a plain hat; `rideBell` before `ride`.
 */
const VOICE_PATTERNS: [KitVoice, RegExp[]][] = [
  ["clap", [/clap/, /\bcp\b/, /handclap/]],
  ["rideBell", [/bell/, /\bcy2\b/]],
  ["crash", [/crash/, /\bcr\d/, /\bcym/, /\bcy\b/]],
  ["ride", [/ride/, /\brd\b/, /\brid/]],
  // Qualifiers appear on either side of the noun depending on the machine —
  // `Hat O 01` and `OpenHat` are the same sound — so both orders are matched.
  ["openHat", [/openhat/, /open.?h/, /\bhat o\b/, /\bhh?o\b/, /\boh\d/, /\boh\b/, /ohh/, /hho/]],
  ["pedalHat", [/pedal/, /\bph\b/, /foot/, /\bhat p\b/]],
  [
    "closedHat",
    [/closed.?h/, /\bhat c\b/, /\bch\d/, /\bch\b/, /chh/, /\bhh\d/, /\bhh\b/, /\bhh/, /hat/, /\bhc\b/, /hh/],
  ],
  ["rim", [/rim/, /\brs\b/, /sidestick/, /side.?stick/]],
  // The trailing unanchored rules exist for machines that fuse tokens into a
  // single word — `GOODSN1`, `PACBD` — where a word boundary never appears.
  // They run last so a properly named sample always wins first.
  ["snare", [/snare/, /\bsd\d/, /\bsd\b/, /\bsn\d/, /\bsn\b/, /\bsnr/, /snr/, /sd\d/, /sn\d/, /sn/]],
  ["kick", [/kick/, /\bbd\d/, /\bbd\b/, /bass.?drum/, /\bbdrum/, /boom/, /bd\d/, /bd/, /\bbass/]],
  ["tomLow", [/lowtom/, /\btom low/, /low.?tom/, /\blt\d/, /\blt\b/, /\bfloor/]],
  ["tomMid", [/midtom/, /\btom mid/, /mid.?tom/, /\bmt\d/, /\bmt\b/]],
  // `/\btom/` is deliberately last across all three: it matches any tom at all,
  // so it must only apply once the specific low/mid names have had their turn.
  ["tomHigh", [/hightom/, /\btom hi/, /high.?tom/, /\bht\d/, /\bht\b/, /\btom/]],
];

/**
 * Normalise a filename for matching: strip the extension and the common
 * `MaxV - Roland909 - ` style prefix, then separate digits from letters so
 * `909BDA` yields a matchable `bd` token rather than one long word.
 */
function normalise(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
  const withoutPrefix = base.includes(" - ") ? base.slice(base.lastIndexOf(" - ") + 3) : base;
  return ` ${withoutPrefix.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2").replace(/[_\-.]/g, " ")} `;
}

export interface KitMapping {
  voice: KitVoice;
  filename: string;
}

/**
 * Choose one sample per voice from a list of filenames.
 *
 * Where several files match, the shortest name wins — kits tend to name the
 * plain articulation tersely (`909BDA 01`) and its variants at greater
 * length (`909BD long decay`), so this biases toward the canonical sound.
 */
export function mapKit(filenames: string[]): Map<KitVoice, string> {
  const wavs = filenames.filter((name) => /\.wav$/i.test(name));
  const mapping = new Map<KitVoice, string>();
  const claimed = new Set<string>();

  for (const [voice, patterns] of VOICE_PATTERNS) {
    for (const pattern of patterns) {
      const matches = wavs
        .filter((name) => !claimed.has(name) && pattern.test(normalise(name)))
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
      if (matches.length > 0) {
        mapping.set(voice, matches[0]);
        // Claim it so a later, looser rule can't reuse the same file for a
        // different voice — a kit whose snare and kick are the same sample
        // is a mapping failure worth seeing, not smoothing over.
        claimed.add(matches[0]);
        break;
      }
    }
  }

  return mapping;
}

/**
 * Voices a groove can fall back to when a kit lacks one. Machines from the
 * early 80s frequently have no ride or no open hat at all, and silently
 * dropping those hits would misrepresent the groove as sparser than it is.
 */
export const VOICE_FALLBACKS: Partial<Record<KitVoice, KitVoice[]>> = {
  rideBell: ["ride", "closedHat"],
  ride: ["closedHat", "crash"],
  openHat: ["closedHat"],
  pedalHat: ["closedHat"],
  closedHat: ["openHat"],
  crash: ["openHat", "closedHat"],
  rim: ["snare"],
  clap: ["snare"],
  tomMid: ["tomLow", "tomHigh"],
  tomHigh: ["tomMid", "tomLow"],
  tomLow: ["tomMid", "tomHigh"],
};
