import { describe, expect, it } from "vitest";
import { repairFraming, toSkeleton } from "../src/skeleton.js";
import type { SectionToken } from "../src/types.js";

function token(role: SectionToken["role"], lyricLineCount?: number): SectionToken {
  return { role, rawLabel: role, lyricLineCount };
}

describe("repairFraming", () => {
  it("reclassifies a mid-song intro with strong lyric evidence as a verse", () => {
    const tokens = [token("intro"), token("intro", 12), token("verse"), token("intro", 13), token("outro")];
    const repaired = repairFraming(tokens);
    expect(repaired.map((t) => t.role)).toEqual(["intro", "verse", "verse", "verse", "outro"]);
  });

  it("demotes a mid-song intro with no lyric evidence to link", () => {
    const tokens = [token("intro"), token("intro"), token("verse"), token("outro")];
    const repaired = repairFraming(tokens);
    expect(repaired.map((t) => t.role)).toEqual(["intro", "link", "verse", "outro"]);
  });

  it("never touches the first or last section even if it has lyrics", () => {
    const tokens = [token("intro", 4), token("verse"), token("intro", 4)];
    const repaired = repairFraming(tokens);
    expect(repaired.map((t) => t.role)).toEqual(["intro", "verse", "intro"]);
  });
});

describe("toSkeleton", () => {
  it("filters to load-bearing roles and collapses consecutive duplicates", () => {
    const tokens = [
      token("intro"),
      token("verse"),
      token("verse"),
      token("link"),
      token("chorus"),
      token("outro"),
    ];
    const { skeleton } = toSkeleton(tokens);
    expect(skeleton).toEqual(["verse", "chorus"]);
  });

  it("truncates at 10", () => {
    const tokens: SectionToken[] = [];
    for (let i = 0; i < 20; i++) tokens.push(token(i % 2 === 0 ? "verse" : "chorus"));
    const { skeleton } = toSkeleton(tokens);
    expect(skeleton.length).toBe(10);
  });

  it("returns an empty skeleton for an all-instrumental song and tags it", () => {
    const tokens = [token("intro"), token("link"), token("outro")];
    const { skeleton, tags } = toSkeleton(tokens);
    expect(skeleton).toEqual([]);
    expect(tags).toContain("instrumental");
  });

  it("tags has-intro, has-outro, and ends-on-chorus", () => {
    const tokens = [token("intro"), token("verse"), token("chorus"), token("outro")];
    const { tags } = toSkeleton(tokens);
    expect(tags).toEqual(expect.arrayContaining(["has-intro", "has-outro", "ends-on-chorus"]));
  });

  it("keeps framing facts out of the skeleton itself", () => {
    const withIntro = toSkeleton([token("intro"), token("verse"), token("chorus")]);
    const withoutIntro = toSkeleton([token("verse"), token("chorus")]);
    expect(withIntro.skeleton).toEqual(withoutIntro.skeleton);
  });
});
