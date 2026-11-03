import { describe, expect, it } from "vitest";
import {
  songOpeningCopy,
  songOpeningState,
  type SongOpeningFacts,
} from "./songOpening";

const facts = (over: Partial<SongOpeningFacts> = {}): SongOpeningFacts => ({
  hydrated: false,
  routedSongExists: false,
  routedIsCurrent: false,
  ...over,
});

describe("songOpeningState", () => {
  it("opens on a cold deep link rather than claiming the song is missing", () => {
    expect(songOpeningState(facts())).toBe("opening");
  });

  it("is ready only once the store has opened the route's song", () => {
    expect(
      songOpeningState(
        facts({
          hydrated: true,
          routedSongExists: true,
          routedIsCurrent: true,
        }),
      ),
    ).toBe("ready");
  });

  it("waits rather than drawing the previously open song", () => {
    // The song is in the library but `openSong` has not run: drawing the
    // outlet here renders the *last* song under the route's title.
    expect(
      songOpeningState(
        facts({
          hydrated: true,
          routedSongExists: true,
          routedIsCurrent: false,
        }),
      ),
    ).toBe("opening");
  });

  it("reports missing only after hydration, when the id is genuinely absent", () => {
    expect(
      songOpeningState(facts({ hydrated: true, routedSongExists: false })),
    ).toBe("missing");
  });

  it("opens while a songless library is still being read", () => {
    // The first load starts from `songs: []`; that must read as "opening",
    // not as "you have no songs".
    expect(songOpeningState(facts({ hydrated: false }))).toBe("opening");
  });

  it("treats a current song as ready even if the flag lagged, so a reload cannot blank", () => {
    // `hydrated` is a one-way flag; if the id already matches, the route has
    // everything it needs and must not wait for it.
    expect(
      songOpeningState({
        hydrated: false,
        routedSongExists: true,
        routedIsCurrent: true,
      }),
    ).toBe("ready");
  });
});

describe("songOpeningCopy", () => {
  it("says nothing when the route is ready", () => {
    expect(songOpeningCopy("ready")).toBeNull();
  });

  it("tells the user what it is waiting on", () => {
    expect(songOpeningCopy("opening")).toEqual({
      title: "Opening…",
      detail: "Reading the song library.",
    });
  });

  it("offers a reason when the song is missing", () => {
    const copy = songOpeningCopy("missing");
    expect(copy?.title).toBe("Song not found.");
    expect(copy?.detail).toContain("deleted");
  });
});
