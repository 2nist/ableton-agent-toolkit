import type { DrumLaneId } from "@drum/library";
import type {
  BlueprintSection,
  DrumPattern,
  SectionOverride,
  TimeDomain,
  VelocityPreset,
} from "../../types/blueprint";
import { domainLabel } from "@drum/library";
import { grooveOf, type GrooveChoice } from "../drums/grooveModel";
import { variantCount } from "../drums/patternOptions";

/**
 * The groove control a section can carry on the canvas.
 *
 * A drum pattern is a *named preset* plus a variant index — there are no steps
 * to paint — so the one gesture worth putting on a lane is moving along the
 * energy ladder: kick only → standard → driving → intense. Undo is the way
 * back, and ⌥ reverses the direction so a step never has to be paid for.
 *
 * The full vocabulary (odd meters, authored blocks, FX) stays in the drums
 * facet: a chip on a 44px lane can offer a ladder, not a catalogue.
 */

/** The acoustic energy ladder, quietest to loudest. */
export const GROOVE_LADDER: readonly DrumPattern[] = [
  "kick_only",
  "standard",
  "half_time",
  "driving",
  "bridge_sparse",
  "intense",
];

export interface GrooveChip {
  kind: "auto" | "muted" | "outline" | "preset";
  /** What the lane shows: "auto", "muted", "outline", or the pattern's name. */
  label: string;
  /** Current variant and how many the preset has (0 when not a preset). */
  variant: number;
  variants: number;
  /** False when the chip must not step (an authored outline is not a preset). */
  steppable: boolean;
}

/** The groove fields, as this module reads them. */
type GrooveFields = Pick<
  BlueprintSection,
  "drumPattern" | "drumVariantIndex" | "drumMeterOutline"
>;

export function grooveChip(section: GrooveFields): GrooveChip {
  const source = grooveOf(section);
  if (source.kind === "outline") {
    return {
      kind: "outline",
      label: "outline",
      variant: 0,
      variants: 0,
      steppable: false,
    };
  }
  if (source.kind === "muted") {
    return {
      kind: "muted",
      label: "muted",
      variant: 0,
      variants: 0,
      steppable: true,
    };
  }
  if (source.kind === "auto") {
    return {
      kind: "auto",
      label: "auto",
      variant: 0,
      variants: 0,
      steppable: true,
    };
  }
  const pattern = source.pattern;
  const variants = variantCount(pattern);
  return {
    kind: "preset",
    label: pattern,
    variant: Math.max(
      0,
      Math.min(source.variant ?? 0, Math.max(0, variants - 1)),
    ),
    variants,
    steppable: true,
  };
}

/** Where the current groove sits on the ladder, or -1 when it is off it
 *  (auto, muted, a machine idiom, an odd meter…). */
function ladderIndex(pattern: DrumPattern | undefined): number {
  if (!pattern) return -1;
  return GROOVE_LADDER.indexOf(pattern);
}

/**
 * One step along the ladder. Auto starts at `standard` in either direction —
 * "make the drums decide" has no position to step from, and guessing the
 * inferred pattern's place on the ladder would make the first click a jump.
 */
export function stepGroove(
  section: GrooveFields,
  direction: 1 | -1,
): GrooveChoice | null {
  const chip = grooveChip(section);
  if (!chip.steppable) return null;

  const current = ladderIndex(section.drumPattern);
  if (current < 0) {
    return { kind: "preset", pattern: "standard", variant: 0 };
  }
  const next =
    (current + direction + GROOVE_LADDER.length) % GROOVE_LADDER.length;
  return { kind: "preset", pattern: GROOVE_LADDER[next], variant: 0 };
}

/** One step through the current preset's baked variants (no-op for auto,
 *  muted or an authored outline — they have none). */
export function stepVariant(
  section: GrooveFields,
  direction: 1 | -1,
): GrooveChoice | null {
  const chip = grooveChip(section);
  if (chip.kind !== "preset" || chip.variants <= 1) return null;
  const next = (chip.variant + direction + chip.variants) % chip.variants;
  return { kind: "preset", pattern: section.drumPattern!, variant: next };
}

/**
 * The section's own clock, as the canvas offers it.
 *
 * A ladder rather than a form: `R` already cycles a section's repeats, and a
 * lane is not the place for four number fields. Every rung is a musically
 * legible choice and one undo takes you back, so nothing here needs a dialog.
 */
export const CLOCK_LADDER: readonly (TimeDomain | null)[] = [
  null,
  { rate: 0.5 },
  { rate: 2 },
  { rate: 1, swing: 0.25 },
  { rate: 1, swing: 0.5 },
];

/** Which rung of the ladder this clock is on, or -1. */
function clockRung(current: TimeDomain | null | undefined): number {
  return CLOCK_LADDER.findIndex(
    (rung) =>
      (rung?.rate ?? 1) === (current?.rate ?? 1) &&
      (rung?.swing ?? 0) === (current?.swing ?? 0) &&
      (rung?.phase ?? 0) === (current?.phase ?? 0),
  );
}

/**
 * The rung BEFORE `current`, wrapping (§g9).
 *
 * The house idiom on this canvas is "click = busier, ⌥-click = sparser", and the
 * clock is the one ladder that only went forward: reaching song time from ½ took
 * four presses. A clock that is not on the ladder at all (written by something
 * else, or an odd combination) has no previous, and lands on song time rather
 * than guessing.
 */
export function previousClock(
  current: TimeDomain | null | undefined,
): TimeDomain | null {
  const at = clockRung(current);
  if (at < 0) return null;
  const before = (at - 1 + CLOCK_LADDER.length) % CLOCK_LADDER.length;
  return CLOCK_LADDER[before] ?? null;
}

/** The next rung, wrapping. `null` is "the song's own time". */
export function nextClock(
  current: TimeDomain | null | undefined,
): TimeDomain | null {
  const at = clockRung(current);
  // A clock off the ladder reads as index -1, so "next" lands on the first rung
  // (song time) — the same answer, and the same predicate, as `previousClock`.
  return CLOCK_LADDER[(at + 1) % CLOCK_LADDER.length] ?? null;
}

/**
 * The dynamic ladder a PASS can step through (§P4.3).
 *
 * Six rungs, not the schema's eight: `ppp` and `fff` are mix decisions, and a
 * canvas row that takes six presses to cross is a row nobody uses. `mf` is the
 * default, so a section sits in the middle of it.
 */
export const VELOCITY_LADDER: readonly VelocityPreset[] = [
  "pp",
  "p",
  "mp",
  "mf",
  "f",
  "ff",
];

/** The next dynamic, wrapping. An unknown or absent value starts at `mf`. */
export function nextVelocity(
  current: VelocityPreset | undefined,
): VelocityPreset {
  const at = current ? VELOCITY_LADDER.indexOf(current) : -1;
  if (at < 0) return "mf";
  return VELOCITY_LADDER[(at + 1) % VELOCITY_LADDER.length];
}

/** What the Velocity row says: "mf", or "mf → f" while you are on it. */
export function velocityHint(current: VelocityPreset | undefined): string {
  return current ?? "mf";
}

/**
 * What a groove choice means as a per-PASS patch (§P4.3).
 *
 * The groove chip writes the whole section through `applyGrooveChoice`; a pass
 * cannot use that (it must not touch the section), so this reduces the same
 * choice to the two fields it actually sets. Only presets are expressible: the
 * override model can *set* a value but not *remove* one, so "auto" and "muted"
 * (which clear `drumPattern`) stay section-level. `stepGroove` already refuses
 * to step those, so the row is only offered where it can work.
 */
export function groovePatchFor(choice: GrooveChoice): SectionOverride | null {
  if (choice.kind !== "preset") return null;
  return { drumPattern: choice.pattern, drumVariantIndex: choice.variant ?? 0 };
}

/** The fields a pass can differ in — the ones `SectionOverride` puts a control
 *  on, plus `bars`, which the section menu can already change. */
export interface PassShape {
  velocity?: VelocityPreset;
  drumPattern?: string;
  bars?: number;
  timeDomain?: TimeDomain;
}

/**
 * A colour per drum lane (§S1).
 *
 * The lane was one grey for every voice, so six rows read as one block: you
 * could see that there were hits, not *which* kit piece was hitting. Colour is
 * the cheapest way to make a 6-px cell mean something — the glyph says what the
 * row is, the colour says it again at a glance.
 *
 * Fixed hues rather than theme tokens: the six have to stay distinguishable
 * from each other first and from the panel second, and every theme's `--c-ink`
 * is deliberately identical to its neighbours.
 */
/** Human names for the six surface lanes — the label a mute control reads, and
 *  the word the step menu and its header use. Shared from here because two
 *  surfaces now name a lane (§S1.10) and a second copy would drift. */
export const DRUM_LANE_LABEL: Record<DrumLaneId, string> = {
  kick: "Kick",
  snare: "Snare",
  rim: "Rim",
  hat: "Hat",
  cym: "Cym",
  tom: "Tom",
};

export const DRUM_LANE_INK: Record<DrumLaneId, string> = {
  kick: "rgb(242 193 98)",
  snare: "rgb(239 138 122)",
  rim: "rgb(196 154 232)",
  hat: "rgb(126 208 190)",
  cym: "rgb(140 186 240)",
  tom: "rgb(214 176 128)",
};

/** The lane's colour, or the muted ink for a lane this build does not know. */
export function drumLaneInk(lane: string): string {
  return DRUM_LANE_INK[lane as DrumLaneId] ?? "rgb(var(--c-ink) / 0.8)";
}

/** How a pass differs from the section it came from (§P4.4). */
export interface PassVariance {
  /** Short chips for the column: "×2", "f", "half_time", "6 bars". */
  labels: string[];
  /** One sentence for the tooltip. */
  detail: string;
}

/**
 * What makes THIS pass different from its section.
 *
 * Three passes of a chorus are three columns that look alike; without this you
 * had to open each menu to find out which one was double time. The clock was
 * already a badge — this covers the fields §P4.3 added, and bars, so the column
 * answers the question the menu was answering.
 */
export function passVariance(
  authored: PassShape | undefined,
  pass: PassShape | undefined,
): PassVariance {
  if (!authored || !pass) return { labels: [], detail: "" };
  const labels: string[] = [];
  const reasons: string[] = [];
  if (
    pass.timeDomain?.rate !== undefined &&
    pass.timeDomain.rate !== (authored.timeDomain?.rate ?? 1)
  ) {
    // The badge already shows the clock; the tooltip is what explains it.
    reasons.push(`clock ${domainLabel(pass.timeDomain)}`);
  }
  if (pass.velocity && pass.velocity !== (authored.velocity ?? "mf")) {
    labels.push(pass.velocity);
    reasons.push(
      `dynamic ${pass.velocity} (section ${authored.velocity ?? "mf"})`,
    );
  }
  if ((pass.drumPattern ?? "") !== (authored.drumPattern ?? "")) {
    const kit = pass.drumPattern ?? "auto";
    labels.push(kit);
    reasons.push(`kit ${kit} (section ${authored.drumPattern ?? "auto"})`);
  }
  if (pass.bars !== undefined && pass.bars !== authored.bars) {
    labels.push(`${pass.bars} bars`);
    reasons.push(`${pass.bars} bars (section ${authored.bars})`);
  }
  return {
    labels,
    detail:
      reasons.length > 0 ? `This pass differs: ${reasons.join(", ")}` : "",
  };
}

/** The loop lengths a section can be folded to, in local beats. */
export const LOOP_LADDER: readonly number[] = [0, 4, 8, 16];

/** The next loop length, wrapping through "the whole section". */
export function nextLoop(
  current: number | undefined,
  sectionBeats: number,
): number {
  const now = current ?? 0;
  const usable = LOOP_LADDER.filter(
    (beats) => beats === 0 || beats < Math.max(1, sectionBeats),
  );
  const at = usable.indexOf(now);
  const next = usable[(at + 1) % usable.length];
  return next ?? 0;
}

/** What the canvas writes on the lane: "½", "×2 · swing 50%", "song time". */
export function drumClockLabel(section: { timeDomain?: TimeDomain }): string {
  return domainLabel(section.timeDomain);
}

/**
 * The lanes a clock actually moves.
 *
 * A bass line is derived from the chord stream, so retiming it against
 * stationary harmony sounds the wrong root — at half time chord two's bass
 * would arrive a bar after chord two. Until the harmony itself can follow a
 * clock (the conductor's job, §P3.5), a clock governs the two lanes that carry
 * their own time: the kit and the captured melody.
 */
export const CLOCK_SCOPE = "drums & melody";

/** The Clock row's face: "song time", then "½ · drums & melody". */
export function clockScopeHint(section: { timeDomain?: TimeDomain }): string {
  const label = drumClockLabel(section);
  return label === "song time" ? label : `${label} · ${CLOCK_SCOPE}`;
}
