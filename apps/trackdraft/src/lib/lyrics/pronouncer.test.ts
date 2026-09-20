/**
 * Pronouncer tests — the cache-only sync lookup, async prefetch, and the
 * negative-cache / retry rules. No real network: `fetchImpl` is injected.
 */
import { describe, expect, it } from "vitest";
import { createDatamusePronouncer, extractPronunciation } from "./pronouncer";

function makeFetch(map: Record<string, unknown[] | "reject">) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const word = new URL(url).searchParams.get("sp") ?? "";
    const result = map[word];
    if (result === "reject") throw new Error("network down");
    return { ok: true, json: async () => result ?? [] } as unknown as Response;
  }) as typeof fetch;
  return { impl, calls };
}

const NIGHT = { word: "night", tags: ["pron:N AY1 T", "f:123.45"] };

describe("extractPronunciation", () => {
  it("reads the first pron: tag", () => {
    expect(extractPronunciation(NIGHT)).toBe("N AY1 T");
    expect(extractPronunciation({ word: "zzz", tags: ["f:1"] })).toBeNull();
    expect(extractPronunciation({ word: "zzz" })).toBeNull();
  });
});

describe("createDatamusePronouncer", () => {
  it("stays silent until primed, then serves pronunciations from the cache", async () => {
    const { impl, calls } = makeFetch({ night: [NIGHT], glimmering: [] });
    const source = createDatamusePronouncer({ fetchImpl: impl, storageKey: null });

    // before ensure(): nothing cached → unknown, no lookup happens in the sync call
    expect(source.pronouncer("night")).toBeNull();
    expect(calls).toHaveLength(0);

    await source.ensure(["night", "Glimmering,"]);
    expect(source.pronouncer("night")).toBe("N AY1 T");
    expect(source.pronouncer("NigHT")).toBe("N AY1 T"); // normalized lookup key
    // "glimmering" came back with no exact match → negative-cached, still null
    expect(source.pronouncer("glimmering")).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("does not re-ask for cached words (positive or negative)", async () => {
    const { impl, calls } = makeFetch({ night: [NIGHT], glimmering: [] });
    const source = createDatamusePronouncer({ fetchImpl: impl, storageKey: null });
    await source.ensure(["night", "glimmering"]);
    await source.ensure(["night", "glimmering"]);
    expect(calls).toHaveLength(2);
  });

  it("never negative-caches a network failure, so the word can be retried", async () => {
    const { impl, calls } = makeFetch({ night: "reject" });
    const source = createDatamusePronouncer({ fetchImpl: impl, storageKey: null });

    await source.ensure(["night"]); // resolves despite the failure
    expect(source.pronouncer("night")).toBeNull();
    expect(source.version()).toBe(0);

    await source.ensure(["night"]); // retried — a failed lookup is not a verdict
    expect(calls).toHaveLength(2);
  });

  it("notifies subscribers when (and only when) the cache changes", async () => {
    const { impl } = makeFetch({ night: [NIGHT], glimmering: [] });
    const source = createDatamusePronouncer({ fetchImpl: impl, storageKey: null });
    const seen: number[] = [];
    const unsubscribe = source.subscribe(() => seen.push(source.version()));

    await source.ensure(["night", "glimmering"]);
    expect(seen).toHaveLength(1);
    expect(source.version()).toBe(1);
    await source.ensure(["night", "glimmering"]); // all cached → no change
    expect(seen).toHaveLength(1);

    unsubscribe();
    await source.ensure(["unrelated"]);
    expect(seen).toHaveLength(1);
  });

  it("dedupes concurrent lookups of the same word", async () => {
    const { impl, calls } = makeFetch({ night: [NIGHT] });
    const source = createDatamusePronouncer({ fetchImpl: impl, storageKey: null });
    await Promise.all([source.ensure(["night"]), source.ensure(["night"])]);
    expect(calls).toHaveLength(1);
  });
});
