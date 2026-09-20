import { describe, expect, it } from "vitest";
import { composeSpark, type SparkInput } from "./spark";
import { deal, shuffled } from "./seed";
import { CHALLENGES, PERSPECTIVES, RULES, SUBJECTS } from "./sparkBank";
import type { SectionRole } from "./lyricBrief";

const base: SparkInput = { songId: "song-1", sectionId: "verse-1", role: "verse" };
const ROLES: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

describe("seeded shuffle", () => {
  it("is a permutation and is stable for a seed", () => {
    const pool = Array.from({ length: 12 }, (_, i) => i);
    const a = shuffled(pool, "x");
    expect([...a].sort((p, q) => p - q)).toEqual(pool);
    expect(shuffled(pool, "x")).toEqual(a);
    expect(shuffled(pool, "y")).not.toEqual(a);
  });

  it("deals without repeats until the pool is exhausted, then cycles", () => {
    const pool = ["a", "b", "c", "d"];
    const dealt = [0, 1, 2, 3].map((n) => deal(pool, "s", n));
    expect(new Set(dealt).size).toBe(4);
    expect(deal(pool, "s", 4)).toBe(dealt[0]);
    expect(deal(pool, "s", -1)).toBe(dealt[3]);
  });
});

describe("composeSpark", () => {
  it("is deterministic per input", () => {
    expect(composeSpark(base)).toEqual(composeSpark(base));
    expect(composeSpark({ ...base, roll: 3 })).toEqual(composeSpark({ ...base, roll: 3 }));
  });

  it("never repeats a rule on consecutive rolls (within one deck)", () => {
    const eligible = RULES.filter((r) => r.scope === "section" && (!r.roles || r.roles.includes("verse"))).length;
    const rules = Array.from({ length: eligible }, (_, i) => composeSpark({ ...base, roll: i }).rule);
    expect(new Set(rules).size).toBe(eligible);
  });

  it("never pairs a rule with a perspective it makes impossible", () => {
    for (const role of ROLES) {
      for (let roll = 0; roll < 60; roll++) {
        const s = composeSpark({ ...base, role, roll });
        const rule = RULES.find((r) => r.text === s.rule)!;
        const persp = PERSPECTIVES.find((p) => p.text === s.perspective);
        if (persp) expect(persp.pronouns.some((p) => (rule.forbids ?? []).includes(p))).toBe(false);
      }
    }
  });

  it("drops the perspective when a rule or the subject already fixes it", () => {
    let sawOverride = false;
    for (let roll = 0; roll < 40; roll++) {
      const s = composeSpark({ ...base, role: "bridge", sectionId: "b", roll });
      if (s.rule === "Write it from the other person's point of view.") {
        sawOverride = true;
        expect(s.perspective).toBe(undefined);
      }
    }
    expect(sawOverride).toBe(true);
    const fixed = SUBJECTS.findIndex((x) => x.fixesPov);
    let sawFixed = false;
    for (let n = 0; n < SUBJECTS.length; n++) {
      const s = composeSpark({ ...base, subjectRoll: n });
      if (s.subject.text === SUBJECTS[fixed].text) { sawFixed = true; expect(s.perspective).toBe(undefined); }
    }
    expect(sawFixed).toBe(true);
  });

  it("keeps rules in their roles and song-sized challenges out of a section", () => {
    const chorusOnly = RULES.filter((r) => r.roles?.length === 1 && r.roles[0] === "chorus").map((r) => r.text);
    const songScope = [...RULES, ...CHALLENGES].filter((x) => x.scope === "song").map((x) => x.text);
    for (let roll = 0; roll < 60; roll++) {
      const v = composeSpark({ ...base, role: "verse", roll });
      expect(chorusOnly.includes(v.rule)).toBe(false);
      expect(songScope.includes(v.rule)).toBe(false);
      expect(songScope.includes(v.challenge)).toBe(false);
    }
    const seen = new Set(Array.from({ length: 30 }, (_, roll) => composeSpark({ ...base, role: "chorus", roll }).rule));
    expect(chorusOnly.every((t) => seen.has(t))).toBe(true);
  });

  it("allows whole-song rules and challenges at song level", () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < 40; roll++) seen.add(composeSpark({ ...base, level: "song", roll }).challenge);
    expect(seen.has(CHALLENGES.find((c) => c.text.startsWith("10-Minute"))!.text)).toBe(true);
  });

  it("keeps the subject at song level: same across sections, changed only by subjectRoll", () => {
    const a = composeSpark({ ...base, sectionId: "verse-1", roll: 0 }).subject;
    const b = composeSpark({ ...base, sectionId: "chorus-1", role: "chorus", roll: 7 }).subject;
    expect(a).toEqual(b);
    expect(composeSpark({ ...base, subjectRoll: 1 }).subject.text === a.text).toBe(false);
    expect(composeSpark({ ...base, songId: "song-2" }).subject.text === a.text).toBe(false);
  });

  it("uses the song's own lyrical subject instead of a random one", () => {
    const s = composeSpark({ ...base, existingSubject: "  a lighthouse keeper's last winter " });
    expect(s.subject).toEqual({ text: "a lighthouse keeper's last winter", own: true });
  });
});
