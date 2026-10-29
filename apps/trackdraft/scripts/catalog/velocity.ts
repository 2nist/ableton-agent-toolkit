/**
 * Section dynamics, derived rather than stamped.
 *
 * Both catalogue builders hardcoded `velocity: "mf"` on every section, which
 * is the same shape of bug as `drumPattern: "standard"`: a constant where a
 * reading of the arrangement belongs. It showed up as a musical symptom —
 * `inferDrumPattern` gates on dynamics (`quiet` → `bridge_sparse`,
 * `loud` → `intense`), so with everything at `mf` the loud and quiet branches
 * were unreachable and 5 of 13 patterns never played.
 *
 * The rules are deliberately plain and readable, and they are about SHAPE:
 * an intro sits under the song, a chorus sits on top of it, a breakdown drops
 * out. The one escalation — the final chorus — is the arrangement's peak, and
 * it is the only thing here that looks at position, because "last chorus is
 * the biggest" is the one dynamic fact a section list can know without
 * listening to the audio.
 */
export type VelocityPreset = "ppp" | "pp" | "p" | "mp" | "mf" | "f" | "ff" | "fff";

const BASE: Record<string, VelocityPreset> = {
  intro: "mp",
  outro: "mp",
  verse: "mp",
  bridge: "mp",
  pre_chorus: "mf",
  chorus: "f",
  solo: "f",
  breakdown: "p",
  custom: "mf",
};

const ORDER: VelocityPreset[] = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"];

function louder(velocity: VelocityPreset): VelocityPreset {
  const i = ORDER.indexOf(velocity);
  return ORDER[Math.min(ORDER.length - 1, i + 1)];
}

/** "refrain" is a chorus under another name (Beatles-style section labels). */
function normalizeRole(role: string | undefined): string {
  if (role === "refrain") return "chorus";
  return role ?? "custom";
}

export interface VelocityInput {
  role?: string;
  /** Kept so a caller can see what it is replacing; not read. */
  velocity?: string;
}

/**
 * One velocity per section, in the same order.
 *
 * Returns the derived value for every section — this is a re-derivation, not
 * a patch — so callers can apply it wholesale or compare first.
 */
export function deriveSectionVelocities(sections: readonly VelocityInput[]): VelocityPreset[] {
  const out: VelocityPreset[] = sections.map((s) => BASE[normalizeRole(s.role)] ?? "mf");

  // The peak: the last chorus (or, without one, the last solo) goes up a step.
  const pickLast = (role: string): number => {
    for (let i = sections.length - 1; i >= 0; i--) {
      if (normalizeRole(sections[i].role) === role) return i;
    }
    return -1;
  };
  const peak = pickLast("chorus") >= 0 ? pickLast("chorus") : pickLast("solo");
  if (peak >= 0) out[peak] = louder(out[peak]!);

  return out;
}

/**
 * True when every section carries the ingest fingerprint — one flat value on
 * all of them, which is what the hardcoded builder produced. A song with any
 * variation was derived by something that could actually read the music.
 */
export function looksHardcoded(sections: readonly VelocityInput[]): boolean {
  if (sections.length === 0) return false;
  const first = sections[0]?.velocity;
  return first !== undefined && sections.every((s) => s.velocity === first);
}
