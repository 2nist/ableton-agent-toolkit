import { beforeEach, describe, expect, it } from "vitest";
import { createEmptySong } from "../types/blueprint";
import { useSongStore } from "./songStore";

/** A store with one open song and a clean history (what `openSong` leaves). */
function openFresh(title: string): string {
  const song = { ...createEmptySong(title), id: `t-${title}` };
  useSongStore.setState({ songs: [song], currentSongId: null, history: [], historyIndex: -1 });
  useSongStore.getState().openSong(song.id);
  return song.id;
}

describe("updateCurrentSongTransient", () => {
  beforeEach(() => {
    useSongStore.setState({ songs: [], currentSongId: null, history: [], historyIndex: -1 });
  });

  it("keeps a whole gesture to one undo step", () => {
    // The tempo encoder sends a CC per detent; committing each one as a
    // history entry meant a single twist evicted the entire 50-deep
    // history, so "undo" could not get back to where the user was.
    openFresh("gesture");
    const start = useSongStore.getState().historyIndex;

    for (let bpm = 121; bpm <= 140; bpm += 1) {
      useSongStore.getState().updateCurrentSongTransient((s) => ({ ...s, bpm }), "tempo");
    }

    expect(useSongStore.getState().currentSong()?.bpm).toBe(140);
    expect(useSongStore.getState().historyIndex).toBe(start + 1); // one step, not twenty
  });

  it("undoes the whole gesture in one press, back to the pre-gesture value", () => {
    openFresh("undo");
    const original = useSongStore.getState().currentSong()?.bpm;

    for (let bpm = 130; bpm < 140; bpm += 1) {
      useSongStore.getState().updateCurrentSongTransient((s) => ({ ...s, bpm }), "tempo");
    }
    useSongStore.getState().undo();

    expect(useSongStore.getState().currentSong()?.bpm).toBe(original);
    expect(useSongStore.getState().canUndo()).toBe(false);
  });

  it("still leaves earlier, committed edits undoable", () => {
    openFresh("committed");
    useSongStore.getState().updateCurrentSong((s) => ({ ...s, title: "Renamed" })); // commit
    for (let bpm = 130; bpm < 135; bpm += 1) {
      useSongStore.getState().updateCurrentSongTransient((s) => ({ ...s, bpm }), "tempo");
    }

    useSongStore.getState().undo(); // undoes the gesture
    expect(useSongStore.getState().currentSong()?.bpm).toBe(120);
    expect(useSongStore.getState().currentSong()?.title).toBe("Renamed");

    useSongStore.getState().undo(); // undoes the rename
    expect(useSongStore.getState().currentSong()?.title).not.toBe("Renamed");
  });

  it("starts a new undo step when a different control moves", () => {
    openFresh("two knobs");
    const start = useSongStore.getState().historyIndex;
    for (let bpm = 130; bpm < 134; bpm += 1) {
      useSongStore.getState().updateCurrentSongTransient((s) => ({ ...s, bpm }), "encoder:tempo");
    }
    useSongStore
      .getState()
      .updateCurrentSongTransient((s) => ({ ...s, key: "D" }), "encoder:scale_root");

    expect(useSongStore.getState().historyIndex).toBe(start + 2);

    useSongStore.getState().undo(); // back to the tempo gesture's last value
    expect(useSongStore.getState().currentSong()?.key).not.toBe("D");
    expect(useSongStore.getState().currentSong()?.bpm).toBe(133);
  });

  it("does not resurrect a redo tail", () => {
    openFresh("redo");
    useSongStore.getState().updateCurrentSong((s) => ({ ...s, bpm: 100 }));
    useSongStore.getState().updateCurrentSong((s) => ({ ...s, bpm: 110 }));
    useSongStore.getState().undo(); // back to 100, with 110 on the redo tail
    expect(useSongStore.getState().canRedo()).toBe(true);

    useSongStore.getState().updateCurrentSongTransient((s) => ({ ...s, bpm: 95 }), "tempo");
    expect(useSongStore.getState().canRedo()).toBe(false);
    expect(useSongStore.getState().currentSong()?.bpm).toBe(95);
  });
});
