import { describe, expect, it } from "vitest";
import { POPOUT_WINDOW_NAME, lyricChordPopoutUrl } from "./popout";

describe("lyricChordPopoutUrl", () => {
  it("points at the song's own popout route", () => {
    expect(lyricChordPopoutUrl("rock-layla")).toBe("/song/rock-layla/popout");
  });

  it("is absolute, so an opener on another route cannot nest it", () => {
    expect(lyricChordPopoutUrl("abc").startsWith("/")).toBe(true);
  });

  it("reuses one window name, so a second open focuses the first", () => {
    expect(POPOUT_WINDOW_NAME).toBe("trackdraft-popout");
  });
});
