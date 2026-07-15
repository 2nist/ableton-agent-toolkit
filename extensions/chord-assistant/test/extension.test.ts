import { MidiClip, MidiTrack, type ArrangementSelection } from "@ableton-extensions/sdk";
import { createMockContext } from "@platform/test-harness";
import { describe, expect, it } from "vitest";
import { activate } from "../src/extension.js";

const COMMAND_ID = "chordAssistant.insertProgression";

describe("chord-assistant extension", () => {
  it("registers a context menu action scoped to MidiTrack.ArrangementSelection", () => {
    const ctx = createMockContext();
    activate(ctx.activation);

    const registered = ctx.log.filter("ui.registerContextMenuAction");
    expect(registered).toHaveLength(1);
    expect(registered[0]!.args[0]).toBe("MidiTrack.ArrangementSelection");
    expect(registered[0]!.args[2]).toBe(COMMAND_ID);
  });

  it("creates one MIDI clip per selected MIDI track, filled with the default progression, in exactly two grouped transactions", async () => {
    const ctx = createMockContext();
    activate(ctx.activation);

    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const selection: ArrangementSelection = {
      time_selection_start: 8,
      time_selection_end: 24,
      selected_lanes: [trackHandle],
    };

    ctx.invokeCommand(COMMAND_ID, selection);
    // Command handler is async — let its promise chain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(1);

    const clip = track.arrangementClips[0]!;
    expect(clip).toBeInstanceOf(MidiClip);
    const midiClip = clip as MidiClip<"1.0.0">;
    expect(midiClip.name).toBe("Pop Progression");
    expect(midiClip.startTime).toBe(8); // starts at the selection start, per the extension's documented v1 behavior
    expect(midiClip.duration).toBe(16); // 4 chords * 4 beats — NOT clamped to the 16-beat selection width, also 16 here by coincidence
    expect(midiClip.notes.length).toBeGreaterThan(0);

    expect(ctx.log.filter("transaction.begin")).toHaveLength(2); // create, then fill — see extension.ts's comment on why
  });

  it("skips lanes that aren't a MidiTrack or a TakeLane under one", async () => {
    const ctx = createMockContext();
    activate(ctx.activation);

    const audioTrackHandle = ctx.addTrack("AudioTrack", "Drums");
    const selection: ArrangementSelection = {
      time_selection_start: 0,
      time_selection_end: 4,
      selected_lanes: [audioTrackHandle],
    };

    ctx.invokeCommand(COMMAND_ID, selection);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.log.filter("transaction.begin")).toHaveLength(0); // nothing to do, nothing should happen
  });

  it("accepts an explicit preset/key/octave when invoked programmatically (not via the context menu)", async () => {
    const ctx = createMockContext();
    activate(ctx.activation);

    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const selection: ArrangementSelection = { time_selection_start: 0, time_selection_end: 4, selected_lanes: [trackHandle] };

    ctx.invokeCommand(COMMAND_ID, selection, "jazz_turnaround", "G", 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips[0]!.name).toBe("Jazz Turnaround");
  });
});
