import { describe, expect, it, vi } from "vitest";
import { selectTrack, templateTrackName, TEMPLATE_TRACK_NAMES } from "../src/lib/trackSync";
import type { OscBridgeClient } from "../src/lib/osc";

function mockOsc(overrides: Partial<Record<string, unknown[]>> = {}): OscBridgeClient {
  return {
    send: vi.fn(),
    request: vi.fn((address: string) => Promise.resolve(overrides[address] ?? [])),
  } as unknown as OscBridgeClient;
}

describe("templateTrackName", () => {
  it("matches the real template's track order (verified against temp template.als)", () => {
    expect(TEMPLATE_TRACK_NAMES).toEqual([
      "kit",
      "crave",
      "chord",
      "color",
      "melody",
      "piano",
      "import",
      "sample pad",
    ]);
    expect(templateTrackName(0)).toBe("kit");
    expect(templateTrackName(7)).toBe("sample pad");
  });

  it("falls back to a generic label for an out-of-range index", () => {
    expect(templateTrackName(20)).toBe("track 20");
  });
});

describe("selectTrack", () => {
  it("always selects the track, regardless of whether it has arrangement clips", async () => {
    const osc = mockOsc();
    await selectTrack(osc, 5);
    expect(osc.send).toHaveBeenCalledWith("/live/view/set/selected_track", [5]);
  });

  it("moves the playhead to the first arrangement clip's start time when one exists", async () => {
    const osc = mockOsc({ "/live/track/get/arrangement_clips/start_time": [16, 48, 96] });
    await selectTrack(osc, 2);
    expect(osc.request).toHaveBeenCalledWith("/live/track/get/arrangement_clips/start_time", [2]);
    expect(osc.send).toHaveBeenCalledWith("/live/song/set/current_song_time", [16]);
  });

  it("does not move the playhead for a track with no arrangement clips", async () => {
    const osc = mockOsc({ "/live/track/get/arrangement_clips/start_time": [] });
    await selectTrack(osc, 5);
    expect(osc.send).not.toHaveBeenCalledWith("/live/song/set/current_song_time", expect.anything());
  });

  it("handles a start time of exactly 0 (falsy but valid) correctly", async () => {
    const osc = mockOsc({ "/live/track/get/arrangement_clips/start_time": [0] });
    await selectTrack(osc, 0);
    expect(osc.send).toHaveBeenCalledWith("/live/song/set/current_song_time", [0]);
  });

  it("propagates a rejected request rather than swallowing it", async () => {
    const osc: OscBridgeClient = {
      send: vi.fn(),
      request: vi.fn().mockRejectedValue(new Error("timed out")),
    } as unknown as OscBridgeClient;
    await expect(selectTrack(osc, 1)).rejects.toThrow("timed out");
    // The track selection itself still fired before the rejection.
    expect(osc.send).toHaveBeenCalledWith("/live/view/set/selected_track", [1]);
  });
});
