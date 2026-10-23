import { describe, expect, it } from "vitest";
import { classifyTracks, drumsToBlocks, melodyFromTrack, GM_DRUM_CHANNEL, type TrackNote } from "./midiTracks";

const PPQ = 480;

/** A note at `beat`, lasting `beats`. */
function note(
  track: number,
  pitch: number,
  beat: number,
  beats = 1,
  channel = 0,
  velocity = 96,
): TrackNote {
  return {
    note: pitch,
    velocity,
    startTick: Math.round(beat * PPQ),
    endTick: Math.round((beat + beats) * PPQ),
    track,
    channel,
  };
}

/** A monophonic line of `count` notes a beat apart. */
function line(track: number, pitches: number[], startBeat = 0, channel = 0): TrackNote[] {
  return pitches.map((pitch, index) => note(track, pitch, startBeat + index, 1, channel));
}

describe("classifyTracks", () => {
  it("calls a monophonic line a melody", () => {
    const [profile] = classifyTracks(line(0, [72, 74, 76, 77]));
    expect(profile.role).toBe("melody");
    expect(profile.noteCount).toBe(4);
    expect(profile.polyphony).toBe(0);
  });

  it("calls a low monophonic line a bass", () => {
    const [profile] = classifyTracks(line(0, [36, 38, 40, 41]));
    expect(profile.role).toBe("bass");
  });

  it("calls stacked notes harmony", () => {
    // Four triads, one chord per beat.
    const notes = [0, 1, 2, 3].flatMap((beat) => [
      note(0, 60, beat),
      note(0, 64, beat),
      note(0, 67, beat),
    ]);
    const [profile] = classifyTracks(notes);
    expect(profile.role).toBe("harmony");
    expect(profile.polyphony).toBe(1);
  });

  it("finds drums on the GM percussion channel whatever the pitches are", () => {
    const [profile] = classifyTracks(line(0, [36, 38, 42, 38], 0, GM_DRUM_CHANNEL));
    expect(profile.role).toBe("drums");
    expect(profile.channel).toBe(GM_DRUM_CHANNEL);
  });

  it("takes the highest line as the melody and ignores a second one", () => {
    const notes = [...line(0, [60, 62, 64]), ...line(1, [72, 74, 76])];
    const profiles = classifyTracks(notes);
    expect(profiles.map((p) => p.role)).toEqual(["ignored", "melody"]);
    expect(profiles.find((p) => p.role === "melody")!.track).toBe(1);
    expect(profiles.find((p) => p.role === "ignored")!.track).toBe(0);
  });

  it("gives bass and melody roles to two monophonic lines", () => {
    const notes = [...line(0, [36, 38, 40]), ...line(1, [72, 74, 76])];
    const profiles = classifyTracks(notes);
    expect(profiles.map((p) => p.role)).toEqual(["bass", "melody"]);
  });

  it("keeps every harmony track — a split piano part is still one harmony", () => {
    const triad = (track: number, base: number) =>
      [0, 1].flatMap((beat) => [note(track, base, beat), note(track, base + 4, beat), note(track, base + 7, beat)]);
    const profiles = classifyTracks([...triad(0, 48), ...triad(1, 60)]);
    expect(profiles.filter((p) => p.role === "harmony")).toHaveLength(2);
  });

  it("ignores a track with no notes and reports names", () => {
    expect(classifyTracks([])).toEqual([]);
    const [profile] = classifyTracks(line(0, [72, 74]), { 0: "Vocal" });
    expect(profile.name).toBe("Vocal");
  });

  it("does not count a single three-note chord as three polyphonic onsets", () => {
    // one chord only → 1 of 1 onsets polyphonic
    const notes = [note(0, 60, 0, 4), note(0, 64, 0, 4), note(0, 67, 0, 4)];
    const [profile] = classifyTracks(notes);
    expect(profile.polyphony).toBe(1);
  });

  it("treats a melody that doubles itself as melody, not harmony", () => {
    // 10% of onsets are polyphonic — below the 20% threshold.
    const notes = [...line(0, [72, 74, 76, 77, 79, 81, 83, 84, 86, 88])];
    notes.push(note(0, 84, 2));
    const [profile] = classifyTracks(notes);
    expect(profile.polyphony).toBeLessThan(0.2);
    expect(profile.role).toBe("melody");
  });
});

describe("melodyFromTrack", () => {
  it("converts ticks to section-relative beats", () => {
    const notes = [note(0, 60, 2), note(0, 62, 3, 0.5)];
    expect(melodyFromTrack(notes, PPQ)).toEqual([
      { pitch: 60, startTime: 2, duration: 1, velocity: 96 },
      { pitch: 62, startTime: 3, duration: 0.5, velocity: 96 },
    ]);
  });

  it("starts the line at the section start, not the file start", () => {
    const notes = [note(0, 60, 8)];
    expect(melodyFromTrack(notes, PPQ, 8 * PPQ)[0].startTime).toBe(0);
  });

  it("keeps the top note when a melody is doubled", () => {
    const notes = [note(0, 60, 0), note(0, 72, 0)];
    expect(melodyFromTrack(notes, PPQ)).toEqual([
      { pitch: 72, startTime: 0, duration: 1, velocity: 96 },
    ]);
  });

  it("clamps a zero-length note instead of dropping it", () => {
    const zero: TrackNote = { note: 60, velocity: 90, startTick: 0, endTick: 0, track: 0, channel: 0 };
    const [imported] = melodyFromTrack([zero], PPQ);
    expect(imported.duration).toBeGreaterThan(0);
    expect(imported.duration).toBeLessThanOrEqual(1 / PPQ + 1e-3);
  });

  it("sorts by onset so a shuffled track still reads in time order", () => {
    const notes = [note(0, 62, 2), note(0, 60, 1), note(0, 64, 3)];
    expect(melodyFromTrack(notes, PPQ).map((n) => n.startTime)).toEqual([1, 2, 3]);
  });

  it("returns nothing for a bad ticks-per-quarter", () => {
    expect(melodyFromTrack([note(0, 60, 0)], 0)).toEqual([]);
  });
});

describe("drumsToBlocks", () => {
  const drum = (pitch: number, beat: number, velocity = 100) =>
    note(0, pitch, beat, 0.25, GM_DRUM_CHANNEL, velocity);

  it("makes one steps block per lane, with the hits intact", () => {
    const notes = [drum(36, 0), drum(36, 2), drum(38, 1), drum(38, 3), drum(42, 0.5)];
    const { blocks, unmapped } = drumsToBlocks(notes, PPQ, 0, 4);
    expect(unmapped).toBe(0);
    const byLane = Object.fromEntries(blocks.map((b) => [b.lane, b]));
    expect(Object.keys(byLane).sort()).toEqual(["hat", "kick", "snare"]);
    expect(byLane.kick.mode).toBe("steps");
    expect(byLane.kick.notes).toEqual([
      { beat: 0, voice: "kick", velocity: 100 },
      { beat: 2, voice: "kick", velocity: 100 },
    ]);
    expect(byLane.kick.endBeat).toBe(4);
  });

  it("puts claps in the rim lane and open hats in the hat lane", () => {
    const { blocks } = drumsToBlocks([drum(39, 0), drum(46, 1)], PPQ, 0, 4);
    expect(blocks.map((b) => b.lane).sort()).toEqual(["hat", "rim"]);
    expect(blocks.find((b) => b.lane === "rim")!.notes![0].voice).toBe("clap");
    expect(blocks.find((b) => b.lane === "hat")!.notes![0].voice).toBe("openHat");
  });

  it("counts pitches with no GM percussion meaning", () => {
    const { blocks, unmapped } = drumsToBlocks([drum(36, 0), drum(99, 1)], PPQ, 0, 4);
    expect(blocks).toHaveLength(1);
    expect(unmapped).toBe(1);
  });

  it("drops hits outside the section rather than clamping them", () => {
    const { blocks } = drumsToBlocks([drum(36, 0), drum(36, 9)], PPQ, 0, 4);
    expect(blocks[0].notes).toHaveLength(1);
  });

  it("returns nothing for degenerate input", () => {
    expect(drumsToBlocks([drum(36, 0)], PPQ, 0, 0).blocks).toEqual([]);
    expect(drumsToBlocks([drum(36, 0)], 0, 0, 4).blocks).toEqual([]);
  });
});

describe("classifyTracks — named tracks", () => {
  const note = (track: number, note: number, startTick: number, endTick: number) => ({
    track,
    channel: 0,
    note,
    velocity: 80,
    startTick,
    endTick,
  });

  it("trusts a name that says what the track is", () => {
    // A monophonic part named "bass" is a bass line even when another
    // monophonic track would have won the register contest.
    const notes = [note(0, 76, 0, 480), note(1, 40, 0, 480)];
    const profiles = classifyTracks(notes, { 0: "lead vocal", 1: "aj wilkes [bass]" });
    expect(profiles.find((p) => p.track === 1)?.role).toBe("bass");
    expect(profiles.find((p) => p.track === 1)?.reason).toContain("named");
  });

  it("treats a solo as neither the tune nor a written part", () => {
    const notes = [note(0, 72, 0, 480), note(1, 79, 0, 480)];
    const profiles = classifyTracks(notes, { 0: "trumpet 1", 1: "phil cremer [trombone solo]" });
    expect(profiles.find((p) => p.track === 1)?.role).toBe("ignored");
    expect(profiles.find((p) => p.track === 0)?.role).toBe("melody");
  });

  it("finds percussion that is not on the GM drum channel", () => {
    const notes = [note(0, 60, 0, 480), note(1, 45, 0, 480)];
    const profiles = classifyTracks(notes, { 0: "piano", 1: "congas" });
    expect(profiles.find((p) => p.track === 1)?.role).toBe("drums");
  });

  it("falls back to polyphony when a track is unnamed", () => {
    const notes = [note(0, 60, 0, 480), note(0, 64, 0, 480), note(0, 67, 0, 480), note(1, 72, 480, 960)];
    const profiles = classifyTracks(notes, {});
    expect(profiles.find((p) => p.track === 0)?.role).toBe("harmony");
  });
});
