import { describe, expect, it } from "vitest";
import { openBlueprintStore } from "../src/db.js";
import type { BlueprintSong } from "@music-theory/song-blueprint";

function makeSong(overrides: Partial<BlueprintSong> & Pick<BlueprintSong, "id" | "title">): BlueprintSong {
  const now = new Date().toISOString();
  return {
    key: "C",
    scale: "ionian",
    bpm: 120,
    timeSignatureNumerator: 4,
    timeSignatureDenominator: 4,
    sections: [],
    arrangement: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("blueprint-store", () => {
  it("saves and loads a blueprint by id, round-tripping the full nested content", () => {
    const store = openBlueprintStore(":memory:");
    const song = makeSong({ id: "song-1", title: "Test Song" });
    store.saveBlueprint(song);
    expect(store.loadBlueprint("song-1")).toEqual(song);
    store.close();
  });

  it("returns undefined for a missing id", () => {
    const store = openBlueprintStore(":memory:");
    expect(store.loadBlueprint("nope")).toBeUndefined();
    store.close();
  });

  it("upserts by id instead of duplicating on re-save", () => {
    const store = openBlueprintStore(":memory:");
    const song = makeSong({ id: "song-1", title: "First title" });
    store.saveBlueprint(song);
    store.saveBlueprint({ ...song, title: "Updated title", updatedAt: new Date().toISOString() });
    expect(store.listBlueprints()).toHaveLength(1);
    expect(store.loadBlueprint("song-1")?.title).toBe("Updated title");
    store.close();
  });

  it("lists summaries without needing the full nested JSON", () => {
    const store = openBlueprintStore(":memory:");
    store.saveBlueprint(makeSong({ id: "a", title: "Song A", artist: "Artist A" }));
    store.saveBlueprint(makeSong({ id: "b", title: "Song B" }));
    const summaries = store.listBlueprints();
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.id === "a")).toMatchObject({ title: "Song A", artist: "Artist A" });
    store.close();
  });

  it("deletes a blueprint", () => {
    const store = openBlueprintStore(":memory:");
    store.saveBlueprint(makeSong({ id: "song-1", title: "Test" }));
    store.deleteBlueprint("song-1");
    expect(store.loadBlueprint("song-1")).toBeUndefined();
    expect(store.listBlueprints()).toEqual([]);
    store.close();
  });

  it("records provenance.source in the queryable source column", () => {
    const store = openBlueprintStore(":memory:");
    store.saveBlueprint(
      makeSong({
        id: "song-1",
        title: "Extracted",
        provenance: { source: "audio-extract", extractedAt: new Date().toISOString() },
      }),
    );
    expect(store.listBlueprints()[0].source).toBe("audio-extract");
    store.close();
  });

  it("defaults source to manual when no provenance is set", () => {
    const store = openBlueprintStore(":memory:");
    store.saveBlueprint(makeSong({ id: "song-1", title: "Hand-typed" }));
    expect(store.listBlueprints()[0].source).toBe("manual");
    store.close();
  });
});
