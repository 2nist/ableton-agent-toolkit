import { MidiTrack, Track, TakeLane } from "@ableton-extensions/sdk";
import { describe, expect, it } from "vitest";
import { createMockContext } from "../src/create-mock-context.js";

describe("createMockContext", () => {
  it("resolves the root Application → Song, with a seeded empty track list", () => {
    const ctx = createMockContext();
    expect(ctx.sdk.application.song.tracks).toHaveLength(0);
    expect(ctx.sdk.application.song.tempo).toBe(120);
  });

  it("resolves a mock-added MIDI track handle to a real, instanceof-correct MidiTrack", () => {
    const ctx = createMockContext();
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");

    const track = ctx.sdk.getObjectFromHandle(trackHandle, Track);
    expect(track).toBeInstanceOf(MidiTrack);
    expect(track).toBeInstanceOf(Track); // MidiTrack extends Track — both must hold
    expect(track.name).toBe("Lead");
  });

  it("rejects resolving a handle against the wrong type", () => {
    const ctx = createMockContext();
    const trackHandle = ctx.addTrack("AudioTrack", "Drums");
    expect(() => ctx.sdk.getObjectFromHandle(trackHandle, TakeLane)).toThrow();
  });

  it("creates a MIDI clip via MidiTrack.createMidiClip and reflects it in state", async () => {
    const ctx = createMockContext();
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);

    const clip = await track.createMidiClip(0, 4);
    clip.notes = [{ pitch: 60, startTime: 0, duration: 1, velocity: 100 }];

    expect(track.arrangementClips).toHaveLength(1);
    expect(track.arrangementClips[0]!.name).toBe("MIDI Clip");
    expect(clip.notes).toEqual([{ pitch: 60, startTime: 0, duration: 1, velocity: 100 }]);
  });

  it("collapses nested withinTransaction calls into exactly one grouped transaction", async () => {
    const ctx = createMockContext();
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);

    // Mirrors the docs' own pattern: multiple async creations grouped in one
    // explicit withinTransaction. Each createMidiClip() independently issues
    // its own internal withinTransaction (see dist/index.mjs's createAsync) —
    // those must collapse into this outer one, not add three more.
    const clips = await ctx.sdk.withinTransaction(() => {
      return Promise.all([track.createMidiClip(0, 4), track.createMidiClip(4, 4)]);
    });

    expect(clips).toHaveLength(2);
    expect(track.arrangementClips).toHaveLength(2);
    expect(ctx.log.filter("transaction.begin")).toHaveLength(1);
    expect(ctx.log.filter("transaction.end")).toHaveLength(1);

    // A second, separate grouped operation is its own transaction.
    await ctx.sdk.withinTransaction(() => track.createMidiClip(8, 4));
    expect(ctx.log.filter("transaction.begin")).toHaveLength(2);
  });

  it("logs every dataModel call with its module prefix, for call-order assertions", async () => {
    const ctx = createMockContext();
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);

    await track.createMidiClip(0, 4);

    const methods = ctx.log.all().map((e) => e.method);
    expect(methods).toContain("dataModel.trackCreateMidiClip");
    expect(methods).toContain("dataModel.withinTransaction");
  });

  it("invokeCommand drives a registered command exactly like Live would", () => {
    const ctx = createMockContext();
    let received: unknown;
    ctx.sdk.commands.registerCommand("test.echo", (arg) => {
      received = arg;
    });

    ctx.invokeCommand("test.echo", { hello: "world" });

    expect(received).toEqual({ hello: "world" });
  });
});
