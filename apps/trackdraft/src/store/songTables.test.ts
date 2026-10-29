import { describe, expect, it } from "vitest";
import { BI_TONAL_MATRIX } from "@platform/progression-engine";
import { createEmptySong } from "../types/blueprint";
import { useSongStore } from "./songStore";

describe("song store ↔ table layer", () => {
  it("applies a song's overrides on open and drops them on close", () => {
    const song = { ...createEmptySong("Table test"), id: "table-test" };
    useSongStore.setState({ songs: [song], currentSongId: null, history: [], historyIndex: -1 });
    useSongStore.getState().openSong("table-test");
    expect(BI_TONAL_MATRIX.minor.song_scoped).toBeUndefined();

    useSongStore.getState().updateCurrentSong((s) => ({
      ...s,
      tables: { colour: { minor: { song_scoped: { shift: 9, quality: "min", label: "m9" } } } },
    }));
    expect(BI_TONAL_MATRIX.minor.song_scoped).toBeDefined();

    useSongStore.setState({ currentSongId: null });
    useSongStore.getState().openSong("table-test");
    expect(BI_TONAL_MATRIX.minor.song_scoped).toBeDefined();

    useSongStore.getState().deleteSong("table-test");
    expect(BI_TONAL_MATRIX.minor.song_scoped).toBeUndefined();
  });
});
