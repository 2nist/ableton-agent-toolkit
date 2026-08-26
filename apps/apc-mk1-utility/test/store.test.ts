import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Directly exercises the store's dispatch logic with a mocked OSC client,
 * so we can confirm or rule out a code-level bug independent of any
 * physical MIDI hardware ambiguity. `getOsc()` is mocked because store.ts
 * calls it directly in multiple places.
 *
 * Track selection lives on the scene buttons (the physical vertical column
 * on the mk1), matching Arrangement View's own vertical track layout — not
 * the track-button row, which is reserved pending a fresh pass now that
 * it's freed from that job.
 */
const oscMock = vi.hoisted(() => ({
  send: vi.fn(),
  request: vi.fn(),
}));

vi.mock("../src/lib/osc", () => ({
  getOsc: () => oscMock,
}));

import { useMk1Store } from "../src/lib/store";

function resetStore() {
  useMk1Store.setState({
    activeBank: "pitch",
    activeTrack: 0,
    shiftHeld: false,
    log: [],
    faderValues: new Array(8).fill(64),
  });
  oscMock.send.mockReset();
  oscMock.request.mockReset();
  oscMock.request.mockImplementation((address: string) => {
    if (address === "/live/view/get/selected_clip") return Promise.resolve([0, 0]);
    if (address === "/live/clip_slot/get/has_clip") return Promise.resolve([true]);
    if (address === "/live/clip/get/notes") return Promise.resolve([]);
    if (address === "/live/track/get/arrangement_clips/start_time") return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  resetStore();
});

describe("track-select (scene button) dispatch — shift-aware", () => {
  it("unshifted: selects a track and syncs Live's selection, not a transport command", async () => {
    useMk1Store.getState().pressSceneButton(1, true);
    await flush();

    expect(useMk1Store.getState().activeTrack).toBe(1);
    expect(oscMock.send).toHaveBeenCalledWith("/live/view/set/selected_track", [1]);
    expect(oscMock.send).not.toHaveBeenCalledWith("/live/song/start_playing", expect.anything());
    const log = useMk1Store.getState().log.map((l) => l.text);
    expect(log.some((t) => t === "Track -> crave")).toBe(true);
  });

  it("shifted: sends a transport command, does NOT select a track", async () => {
    useMk1Store.getState().setShiftHeld(true);
    useMk1Store.getState().pressSceneButton(0, true);
    await flush();

    expect(oscMock.send).toHaveBeenCalledWith("/live/song/start_playing", []);
    expect(oscMock.send).not.toHaveBeenCalledWith("/live/view/set/selected_track", expect.anything());
    expect(useMk1Store.getState().activeTrack).toBe(0); // unchanged from initial
    const log = useMk1Store.getState().log.map((l) => l.text);
    expect(log.some((t) => t.includes("Play ->"))).toBe(true);
  });

  it("the same scene index produces a DIFFERENT log line shifted vs. unshifted", async () => {
    useMk1Store.getState().pressSceneButton(2, true);
    await flush();
    const unshiftedLog = useMk1Store.getState().log.at(-1)?.text;

    resetStore();
    useMk1Store.getState().setShiftHeld(true);
    useMk1Store.getState().pressSceneButton(2, true);
    await flush();
    const shiftedLog = useMk1Store.getState().log.at(-1)?.text;

    expect(unshiftedLog).not.toEqual(shiftedLog);
  });

  it("moves the Arrangement playhead to the track's first clip when one exists", async () => {
    oscMock.request.mockImplementation((address: string) => {
      if (address === "/live/track/get/arrangement_clips/start_time") return Promise.resolve([32]);
      return Promise.resolve([]);
    });

    useMk1Store.getState().pressSceneButton(2, true);
    await flush();

    expect(oscMock.send).toHaveBeenCalledWith("/live/song/set/current_song_time", [32]);
  });

  it("doesn't move the playhead for a track with no Arrangement clips (e.g. piano, import)", async () => {
    useMk1Store.getState().pressSceneButton(5, true);
    await flush();

    expect(oscMock.send).not.toHaveBeenCalledWith("/live/song/set/current_song_time", expect.anything());
  });

  it("logs a failure if the selection-sync request rejects, rather than throwing", async () => {
    oscMock.request.mockImplementation((address: string) => {
      if (address === "/live/track/get/arrangement_clips/start_time") {
        return Promise.reject(new Error("OSC request timed out"));
      }
      return Promise.resolve([]);
    });

    useMk1Store.getState().pressSceneButton(0, true);
    await flush();

    const log = useMk1Store.getState().log.map((l) => l.text);
    expect(log.some((t) => t === "Selection sync failed -> kit: OSC request timed out")).toBe(true);
  });
});

describe("track button dispatch — reserved", () => {
  it("is recognized but does nothing, now that track selection lives on scene buttons", async () => {
    useMk1Store.getState().pressTrackButton(3, true);
    await flush();

    expect(useMk1Store.getState().activeTrack).toBe(0); // unchanged
    expect(oscMock.request).not.toHaveBeenCalled();
    expect(oscMock.send).not.toHaveBeenCalled();
    const log = useMk1Store.getState().log.map((l) => l.text);
    expect(log.some((t) => t === "Track Button 4 (reserved, no action)")).toBe(true);
  });

  it("release (pressed=false) doesn't log anything", async () => {
    useMk1Store.getState().pressTrackButton(3, false);
    await flush();
    expect(useMk1Store.getState().log).toHaveLength(0);
  });

  it("is not shift-aware — same (lack of) result whether shift is held or not", async () => {
    useMk1Store.getState().pressTrackButton(1, true);
    await flush();
    const unshiftedTrack = useMk1Store.getState().activeTrack;

    resetStore();
    useMk1Store.getState().setShiftHeld(true);
    useMk1Store.getState().pressTrackButton(1, true);
    await flush();
    const shiftedTrack = useMk1Store.getState().activeTrack;

    expect(unshiftedTrack).toBe(shiftedTrack);
  });
});

describe("grid pad dispatch", () => {
  it("triggers the active bank's clip transform", async () => {
    useMk1Store.getState().pressGridPad(10, true);
    await flush();

    expect(oscMock.request).toHaveBeenCalledWith("/live/view/get/selected_clip", []);
    const log = useMk1Store.getState().log.map((l) => l.text);
    expect(log.some((t) => t === "Grid: pitch applied (0 notes)")).toBe(true);
  });

  it("release (pressed=false) does nothing", async () => {
    useMk1Store.getState().pressGridPad(10, false);
    await flush();
    expect(oscMock.request).not.toHaveBeenCalled();
    expect(useMk1Store.getState().log).toHaveLength(0);
  });
});

describe("empty clip slot — fails fast instead of timing out", () => {
  it("checks has_clip and fails immediately without ever requesting notes", async () => {
    oscMock.request.mockImplementation((address: string) => {
      if (address === "/live/view/get/selected_clip") return Promise.resolve([0, 0]);
      if (address === "/live/clip_slot/get/has_clip") return Promise.resolve([false]);
      return Promise.resolve([]); // /live/clip/get/notes would hang for real — must not be called
    });

    useMk1Store.getState().pressGridPad(0, true);
    await flush();

    expect(oscMock.request).toHaveBeenCalledWith("/live/clip_slot/get/has_clip", [0, 0]);
    expect(oscMock.request).not.toHaveBeenCalledWith("/live/clip/get/notes", expect.anything());
    const log = useMk1Store.getState().log.map((l) => l.text);
    expect(log.some((t) => t === "Grid: pitch failed — no clip in the selected slot")).toBe(true);
  });
});
