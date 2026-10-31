import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlueprintSong } from "../../types/blueprint";
import { formatBytes, measureLibraryStorage } from "./libraryStorageInfo";

const song = (id: string, title = id): BlueprintSong => ({ id, title, bpm: 120 }) as unknown as BlueprintSong;

function stubEstimate(usage: number | null, quota: number | null): void {
  vi.stubGlobal("navigator", {
    storage: {
      estimate: async () => ({ usage, quota }),
    },
  });
}

/** A library whose serialised JSON is about `chars` characters. */
function libraryOfSize(chars: number): BlueprintSong[] {
  const filler = "x".repeat(Math.max(0, chars - 100));
  return [{ ...song("big"), lyrics: filler } as unknown as BlueprintSong];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatBytes", () => {
  it("scales to the unit a human can read", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4.0 KB");
    expect(formatBytes(220_000)).toBe("215 KB");
    expect(formatBytes(2_790_404)).toBe("2.7 MB");
    expect(formatBytes(3_316_401_550)).toBe("3.1 GB");
  });
});

describe("measureLibraryStorage", () => {
  it("reports the library size and the backend it lives on", async () => {
    stubEstimate(1_000, 3_000_000_000);
    const info = await measureLibraryStorage([song("a"), song("b")], "indexeddb");

    expect(info.songs).toBe(2);
    expect(info.backend).toBe("indexeddb");
    expect(info.headline).toContain("2 songs");
    expect(info.bytes).toBeGreaterThan(0);
    expect(info.headline).toContain("2 songs");
    expect(info.level).toBe("ok");
    expect(info.advice).toBeNull();
  });

  it("stays quiet while a localStorage library is small, because that is the normal case", async () => {
    stubEstimate(null, null);
    const info = await measureLibraryStorage([song("a")], "localstorage");
    expect(info.level).toBe("ok");
    expect(info.headline).toContain("localStorage");
  });

  it("warns before a localStorage library reaches the ceiling", async () => {
    stubEstimate(null, null);
    const info = await measureLibraryStorage(libraryOfSize(1_600_000), "localstorage");
    expect(info.level).toBe("watch");
    expect(info.advice).toMatch(/export a backup/i);
  });

  it("says saves are about to fail permanently once the ceiling is reached", async () => {
    // The deadlock: over the cap, even deleting songs cannot be written.
    stubEstimate(null, null);
    const info = await measureLibraryStorage(libraryOfSize(2_100_000), "localstorage");
    expect(info.level).toBe("danger");
    expect(info.advice).toMatch(/cannot be written/i);
  });

  it("treats a nearly-full IndexedDB quota as a warning, not as nothing", async () => {
    stubEstimate(950, 1000);
    const info = await measureLibraryStorage([song("a")], "indexeddb");
    expect(info.level).toBe("danger");
    expect(info.headline).toContain("95.0% used");

    // 80% is close, not critical — the two levels must say different things.
    stubEstimate(800, 1000);
    expect((await measureLibraryStorage([song("a")], "indexeddb")).level).toBe("watch");
  });

  it("describes a nearly-empty quota as under 0.1%, not as 0.0%", async () => {
    stubEstimate(649_000, 3_316_401_550);
    const info = await measureLibraryStorage([song("a")], "indexeddb");
    expect(info.headline).toContain("under 0.1% used");
    expect(info.headline).not.toContain("0.0%");
  });

  it("survives a browser that will not answer the quota question", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => {
          throw new Error("SecurityError");
        },
      },
    });
    const info = await measureLibraryStorage([song("a")], "indexeddb");
    expect(info.quotaBytes).toBeNull();
    expect(info.level).toBe("ok");
  });

  it("survives a navigator with no storage API at all", async () => {
    vi.stubGlobal("navigator", {});
    const info = await measureLibraryStorage([song("a")], "disk");
    expect(info.usageBytes).toBeNull();
    expect(info.headline).toContain("1 song");
    expect(info.level).toBe("ok");
  });
});
