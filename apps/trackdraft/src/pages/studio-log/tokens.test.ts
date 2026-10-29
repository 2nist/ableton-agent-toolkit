import { describe, expect, it } from "vitest";
import { channelsToHex, contrastGrade, contrastRatio, hexToChannels } from "./tokens";

describe("Studio Log theme study color utilities", () => {
  it("resolves the channel format used by the runtime theme", () => {
    expect(channelsToHex("239 231 214")).toBe("#EFE7D6");
    expect(channelsToHex(" 38  34 27 ")).toBe("#26221B");
    expect(channelsToHex("#a03a31")).toBe("#A03A31");
    expect(hexToChannels("#EFE7D6")).toBe("239 231 214");
  });

  it("rejects malformed colors instead of displaying a false measurement", () => {
    expect(() => channelsToHex("rgb(0, 0, 0)")).toThrow();
    expect(() => channelsToHex("12 20")).toThrow();
  });

  it("calculates symmetric WCAG contrast ratios and grades", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#26221B", "#26221B")).toBe(1);
    expect(contrastGrade(21)).toBe("AAA");
    expect(contrastGrade(4.5)).toBe("AA");
    expect(contrastGrade(3)).toBe("AA large");
    expect(contrastGrade(2.9)).toBe("Below AA");
  });
});
