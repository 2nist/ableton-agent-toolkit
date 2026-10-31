import { describe, expect, it, vi } from "vitest";
import { filterByLyricLine, formatDuration, rejectionReason, searchLrclibRecords } from "./lrclibClient";
import { scoreCandidate } from "./lrclibMatch";

function record(over: Partial<Parameters<typeof scoreCandidate>[1]> = {}) {
  return {
    id: 1,
    trackName: "Layla",
    artistName: "Derek and the Dominos",
    duration: 425,
    syncedLyrics: "[00:01.00]what'll you do",
    plainLyrics: "what'll you do",
    instrumental: false,
    ...over,
  };
}

/** A fetch stand-in keyed by the query string it is asked for. */
function fakeFetch(map: Record<string, unknown[]>, status = 200) {
  return vi.fn(async (url: string) => ({
    ok: status === 200,
    status,
    json: async () => map[url] ?? [],
  })) as unknown as typeof fetch;
}

const query = { title: "Layla", artist: "Derek and the Dominos", duration: 424 };

describe("rejectionReason — the answer to 'why didn't it find my song'", () => {
  it("explains a title that doesn't agree", () => {
    // A bracketed aside ("(Live at…", "(Remastered)") normalises away, so a
    // real disagreement has to be a different song to be refused.
    const scored = scoreCandidate(query, record({ trackName: "Wonderwall" }));
    expect(rejectionReason(scored, query)).toMatch(/title differs/);
  });

  it("explains a different artist", () => {
    const scored = scoreCandidate(query, record({ artistName: "Eric Clapton" }));
    expect(rejectionReason(scored, query)).toMatch(/different artist \(Eric Clapton\)/);
  });

  it("explains a duration gap in seconds", () => {
    const scored = scoreCandidate(query, record({ duration: 500 }));
    expect(rejectionReason(scored, query)).toMatch(/76s off/);
  });

  it("explains an instrumental", () => {
    const scored = scoreCandidate(query, record({ instrumental: true }));
    expect(rejectionReason(scored, query)).toMatch(/instrumental/);
  });

  it("explains a record with no words", () => {
    const scored = scoreCandidate(query, record({ syncedLyrics: null, plainLyrics: null }));
    expect(rejectionReason(scored, query)).toMatch(/carries no lyrics/);
  });

  it("returns null when the matcher would accept the record", () => {
    expect(rejectionReason(scoreCandidate(query, record()), query)).toBeNull();
  });
});

describe("searchLrclibRecords", () => {
  it("splits the pool into accepted and refused, best first", async () => {
    const fetchImpl = fakeFetch({
      "https://lrclib.net/api/search?track_name=Layla&artist_name=Derek+and+the+Dominos": [
        record(),
        record({ id: 2, trackName: "Layla", artistName: "Eric Clapton", duration: 425 }),
      ],
    });
    const outcome = await searchLrclibRecords(query, fetchImpl);

    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]!.candidate.artistName).toBe("Derek and the Dominos");
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]!.reason).toMatch(/different artist/);
    expect(outcome.error).toBeNull();
    expect(outcome.empty).toBe(false);
  });

  it("falls back to a bare-title search so a mis-filed artist still surfaces", async () => {
    const fetchImpl = fakeFetch({
      "https://lrclib.net/api/search?track_name=Layla": [
        record({ id: 9, artistName: "Derek & the Dominos" }),
      ],
    });
    const outcome = await searchLrclibRecords(query, fetchImpl);

    expect(outcome.queries).toHaveLength(2);
    expect(outcome.accepted.length + outcome.rejected.length).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("dedupes a record that both queries return", async () => {
    // Refused by the fielded pass (wrong artist within the pool), so the
    // bare-title query still runs and returns the same record again.
    const same = record({ id: 7, artistName: "Eric Clapton" });
    const fetchImpl = fakeFetch({
      "https://lrclib.net/api/search?track_name=Layla&artist_name=Derek+and+the+Dominos": [same],
      "https://lrclib.net/api/search?track_name=Layla": [same],
    });
    const outcome = await searchLrclibRecords(query, fetchImpl);
    expect(outcome.accepted.length + outcome.rejected.length).toBe(1);
  });

  it("separates a network failure from an empty result", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const failed = await searchLrclibRecords(query, throwing);
    expect(failed.error).toMatch(/offline/);
    expect(failed.empty).toBe(false);

    const empty = await searchLrclibRecords(query, fakeFetch({}));
    expect(empty.error).toBeNull();
    expect(empty.empty).toBe(true);
  });

  it("treats 429 as load-shedding too, and says so", async () => {
    // 429 is "slow down", not "your request was wrong" — the same retry path
    // as ServerOverloaded, and the same word to the user.
    const outcome = await searchLrclibRecords(query, fakeFetch({}, 429));
    expect(outcome.busy).toBe(true);
  });

  it("reports a hard failure with its status", async () => {
    const outcome = await searchLrclibRecords(query, fakeFetch({}, 500));
    expect(outcome.busy).toBe(false);
    expect(outcome.error).toMatch(/500/);
  });
});

describe("formatDuration", () => {
  it("reads like a track length", () => {
    expect(formatDuration(425)).toBe("7:05");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(undefined)).toBe("—");
  });
});

describe("searchLrclibRecords — one query when one is enough", () => {
  it("stops after the fielded query once it has an acceptable record", async () => {
    const fetchImpl = fakeFetch({
      "https://lrclib.net/api/search?track_name=Layla&artist_name=Derek+and+the+Dominos": [record({ id: 3 })],
    });
    const outcome = await searchLrclibRecords(query, fetchImpl);
    expect(outcome.accepted).toHaveLength(1);
    // One request, not two — every extra request is another chance to meet
    // LRCLIB's overload.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("searchLrclibRecords — LRCLIB shedding load", () => {
  it("retries a ServerOverloaded and keeps what the retry found", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => "0" },
          json: async () => ({ name: "ServerOverloaded", statusCode: 503 }),
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => [record({ id: 11 })] };
    }) as unknown as typeof fetch;

    const outcome = await searchLrclibRecords(query, fetchImpl);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.busy).toBe(false);
    expect(outcome.error).toBeNull();
  });

  it("reports `busy` when the overload outlasts the retries", async () => {
    const alwaysBusy = vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: () => "0" },
      json: async () => ({ name: "ServerOverloaded" }),
    })) as unknown as typeof fetch;

    const outcome = await searchLrclibRecords(query, alwaysBusy);
    expect(outcome.busy).toBe(true);
    expect(outcome.error).toBe("busy");
    expect(outcome.empty).toBe(false);
    // 3 attempts per query, both queries → 6 requests, then it gives up.
    expect((alwaysBusy as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(6);
  });
});

describe("searchLrclibRecords — album narrowing", () => {
  it("sends album_name when given", async () => {
    const fetchImpl = fakeFetch({});
    await searchLrclibRecords(query, fetchImpl, "Layla");
    const urls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.map((call) => call[0]);
    expect(urls.some((url) => url.includes("album_name=Layla"))).toBe(true);
  });
});

describe("filterByLyricLine — 'I know the words, not the title'", () => {
  const pool = [
    { id: 1, trackName: "Layla", plainLyrics: "What'll you do when you get lonely" },
    { id: 2, trackName: "Layla", plainLyrics: "Let's get outta this broken place" },
    { id: 3, trackName: "Layla", plainLyrics: null, syncedLyrics: "[00:10.00]Lay low, Layla" },
    { id: 4, trackName: "Layla", plainLyrics: null },
  ];

  it("keeps only the records whose words contain the phrase", () => {
    expect(filterByLyricLine(pool, "outta this broken place").map((r) => r.id)).toEqual([2]);
  });

  it("matches across punctuation and case", () => {
    expect(filterByLyricLine(pool, "lets get outta").map((r) => r.id)).toEqual([2]);
    expect(filterByLyricLine(pool, "LAY LOW").map((r) => r.id)).toEqual([3]);
  });

  it("reads synced lyrics too, not just the plain field", () => {
    expect(filterByLyricLine(pool, "lay low layla").map((r) => r.id)).toEqual([3]);
  });

  it("returns the pool untouched for an empty phrase", () => {
    expect(filterByLyricLine(pool, "   ")).toHaveLength(pool.length);
  });

  it("returns nothing when the phrase is in none of them", () => {
    expect(filterByLyricLine(pool, "a line nobody sang")).toEqual([]);
  });
});
