import { ClipSlot, MidiClip, MidiTrack } from "@ableton-extensions/sdk";
import { createMockContext } from "@platform/test-harness";
import { describe, expect, it } from "vitest";
import { activate } from "../src/extension.js";

const COMMAND_ID = "progressionStudio.open";
const MELODY_COMMAND_ID = "progressionStudio.melody";
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("progression-studio extension", () => {
  it("registers both actions on MidiTrack and ClipSlot scopes", () => {
    const ctx = createMockContext();
    activate(ctx.activation);

    const registered = ctx.log.filter("ui.registerContextMenuAction");
    expect(registered.map((r) => r.args[2])).toEqual([
      COMMAND_ID, MELODY_COMMAND_ID,
      COMMAND_ID, MELODY_COMMAND_ID,
    ]);
    expect(registered.map((r) => r.args[0])).toEqual([
      "MidiTrack", "MidiTrack",
      "ClipSlot", "ClipSlot",
    ]);
  });

  it("renders the studio result as one MIDI clip in two grouped transactions", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 5,
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    expect(ctx.log.filter("ui.showModalDialog")).toHaveLength(1);
    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(1);

    const clip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(clip.name).toBe("C - G");
    expect(clip.startTime).toBe(0);
    expect(clip.duration).toBe(8); // 4 + 4 beats
    expect(clip.notes.length).toBe(6); // C maj triad + G maj triad
    expect(ctx.log.filter("transaction.begin")).toHaveLength(2); // create, then fill
  });

  it("places a new clip after the last existing clip", async () => {
    const result = JSON.stringify({
      key: "C",
      octave: 5,
      chords: [{ degree: "I", quality: "maj", durationBeats: 4 }],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");

    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(2);
    const second = track.arrangementClips[1]! as MidiClip<"1.0.0">;
    expect(second.startTime).toBe(4); // appended after the first 4-beat clip
  });

  it("does nothing when the modal is cancelled", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ error: true }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(0);
  });

  it("injects Live's key/scale/time signature into the modal", async () => {
    const ctx = createMockContext({
      onShowModalDialog: (url) => ({ result: JSON.stringify({ key: "C", octave: 5, chords: [{ degree: "I", quality: "maj", durationBeats: 4 }] }) }),
    });
    // seed a scene + Live scale root so readLive() finds them
    const songHandleId = ctx.state.getProp<bigint>(ctx.applicationHandle, "song");
    ctx.state.setProp({ id: songHandleId }, "rootNote", 9n); // A
    ctx.state.setProp({ id: songHandleId }, "scaleName", "Minor");
    ctx.state.setProp({ id: songHandleId }, "scaleMode", true);
    const sceneHandle = ctx.state.createObject("Scene", { name: "Scene 1", signatureNumerator: 3, signatureDenominator: 4 });
    ctx.state.pushRef({ id: songHandleId }, "scenes", sceneHandle.id);

    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const modal = ctx.log.filter("ui.showModalDialog")[0]!;
    const url = modal.args[0] as string;
    // the injected live payload (as percent-encoded JSON) appears in the data: URL
    expect(decodeURIComponent(url)).toContain('"rootNote":9');
    expect(decodeURIComponent(url)).toContain('"scaleName":"Minor"');
    expect(decodeURIComponent(url)).toContain('"signatureNumerator":3');
    expect(decodeURIComponent(url)).toContain('"signatureDenominator":4');
  });

  it("renders into a Session clip slot when invoked from a ClipSlot handle", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 5,
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const slotHandle = ctx.state.createObject("ClipSlot", {});
    ctx.state.pushRef(trackHandle, "clipSlots", slotHandle.id);

    ctx.invokeCommand(COMMAND_ID, slotHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(0); // nothing in arrangement
    const slot = ctx.sdk.getObjectFromHandle(slotHandle, ClipSlot);
    const clip = slot.clip as MidiClip<"1.0.0"> | null;
    expect(clip).not.toBeNull();
    expect(clip!.name).toBe("C - G");
    expect(clip!.notes.length).toBe(6);
  });

  it("Generate Melody from a ClipSlot merges chords + melody into one session clip", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 5,
      mode: "melody",
      melody: true,
      maxNoteBeats: 4,
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const slotHandle = ctx.state.createObject("ClipSlot", {});
    ctx.state.pushRef(trackHandle, "clipSlots", slotHandle.id);

    ctx.invokeCommand(MELODY_COMMAND_ID, slotHandle);
    await wait();
    await wait();
    await wait();

    const slot = ctx.sdk.getObjectFromHandle(slotHandle, ClipSlot);
    const clip = slot.clip as MidiClip<"1.0.0"> | null;
    expect(clip).not.toBeNull();
    expect(clip!.name).toBe("C - G + melody");
    expect(clip!.notes.length).toBe(8); // 6 chord notes + 2 melody notes
  });

  it("Generate Melody puts the melody on its own new MIDI track below the chords", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 5,
      mode: "melody",
      melody: true,
      maxNoteBeats: 4,
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    ctx.invokeCommand(MELODY_COMMAND_ID, trackHandle);
    await wait();
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(1); // chords stay on the original track
    const chordClip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(chordClip.name).toBe("C - G");
    expect(chordClip.notes.length).toBe(6); // two triads

    // melody went to a newly created MIDI track below
    const song = ctx.sdk.application.song;
    const melodyTrack = (song.tracks as MidiTrack<"1.0.0">[]).find((t) => t.name.includes("Melody"));
    expect(melodyTrack).toBeDefined();
    expect(melodyTrack!.arrangementClips).toHaveLength(1);
    const melodyClip = melodyTrack!.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(melodyClip.name).toBe("Melody · C - G");
    // 2 chords, 4 beats each, maxNoteBeats 4 => 1 note per chord
    expect(melodyClip.notes.length).toBe(2);
  });

  it("places the bi-tonal color on a separate new MIDI track when a flavor is chosen", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 4,
      biTonalFlavor: "sci_fi_wonder",
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    // original track keeps just the anchor block chords
    expect(track.arrangementClips).toHaveLength(1);
    const clip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(clip.name).toBe("C - G");
    expect(clip.notes.length).toBe(6); // anchor C maj + G maj

    // a new MIDI track was created below for the color layer
    const song = ctx.sdk.application.song;
    const tracks = song.tracks;
    const colorTrack = tracks.find((t) => (t as MidiTrack<"1.0.0">).name.includes("sci fi wonder")) as MidiTrack<"1.0.0"> | undefined;
    expect(colorTrack).toBeDefined();
    expect(colorTrack!.arrangementClips).toHaveLength(1);
    const colorClip = colorTrack!.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(colorClip.name).toBe("Color · C - G · sci fi wonder");
    expect(colorClip.notes.length).toBe(6); // D maj + A maj color triads
  });

  it("puts chords, melody, and bi-tonal color each on their own track", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 4,
      melody: true,
      maxNoteBeats: 4,
      biTonalFlavor: "sci_fi_wonder",
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(1); // just chords on the original track
    expect((track.arrangementClips[0] as MidiClip<"1.0.0">).name).toBe("C - G");

    const song = ctx.sdk.application.song;
    const midiTracks = song.tracks as MidiTrack<"1.0.0">[];
    const melodyTrack = midiTracks.find((t) => t.name.includes("Melody"));
    const colorTrack = midiTracks.find((t) => t.name.includes("sci fi wonder"));
    expect(melodyTrack).toBeDefined();
    expect(colorTrack).toBeDefined();
    expect(melodyTrack!.arrangementClips[0] as MidiClip<"1.0.0">).toBeDefined();
    expect((melodyTrack!.arrangementClips[0] as MidiClip<"1.0.0">).name).toBe("Melody · C - G");
    expect((colorTrack!.arrangementClips[0] as MidiClip<"1.0.0">).name).toBe("Color · C - G · sci fi wonder");
  });

  it("reuses a project's own existing color/melody tracks instead of creating new ones", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 4,
      melody: true,
      maxNoteBeats: 4,
      biTonalFlavor: "sci_fi_wonder",
      chords: [
        { degree: "I", quality: "maj", durationBeats: 4 },
        { degree: "V", quality: "maj", durationBeats: 4 },
      ],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    // Mirrors the real template's track order: kit, crave, chord, color, melody.
    ctx.addTrack("MidiTrack", "kit");
    ctx.addTrack("MidiTrack", "crave");
    const chordHandle = ctx.addTrack("MidiTrack", "chord");
    ctx.addTrack("MidiTrack", "color");
    ctx.addTrack("MidiTrack", "melody");

    ctx.invokeCommand(COMMAND_ID, chordHandle);
    await wait();
    await wait();
    await wait();

    const song = ctx.sdk.application.song;
    const tracks = song.tracks as MidiTrack<"1.0.0">[];
    expect(tracks).toHaveLength(5); // no new tracks created

    const colorTrack = tracks.find((t) => t.name === "color")!;
    const melodyTrack = tracks.find((t) => t.name === "melody")!;
    // Names are left as the project set them, not overwritten.
    expect(colorTrack.name).toBe("color");
    expect(melodyTrack.name).toBe("melody");

    expect(colorTrack.arrangementClips).toHaveLength(1);
    expect((colorTrack.arrangementClips[0] as MidiClip<"1.0.0">).name).toBe("Color · C - G · sci fi wonder");
    expect(melodyTrack.arrangementClips).toHaveLength(1);
    expect((melodyTrack.arrangementClips[0] as MidiClip<"1.0.0">).name).toBe("Melody · C - G");
  });

  it("still creates new tracks when no matching color/melody track exists nearby", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 4,
      melody: true,
      maxNoteBeats: 4,
      chords: [{ degree: "I", quality: "maj", durationBeats: 4 }],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    // A plain project with no dedicated tracks nearby.
    ctx.addTrack("MidiTrack", "kit");
    const chordHandle = ctx.addTrack("MidiTrack", "chord");
    ctx.addTrack("AudioTrack", "vox"); // unrelated track sitting right after

    ctx.invokeCommand(MELODY_COMMAND_ID, chordHandle);
    await wait();
    await wait();
    await wait();

    const song = ctx.sdk.application.song;
    const midiTracks = (song.tracks as MidiTrack<"1.0.0">[]).filter((t) => t instanceof MidiTrack);
    const melodyTrack = midiTracks.find((t) => t.name.includes("Melody"));
    expect(melodyTrack).toBeDefined(); // fell back to creating a new one
  });

  it("session slot merges chords + melody + color into one clip", async () => {
    const studioResult = JSON.stringify({
      key: "C",
      octave: 4,
      melody: true,
      maxNoteBeats: 4,
      biTonalFlavor: "ambient_ocean",
      chords: [{ degree: "I", quality: "maj", durationBeats: 4 }],
    });
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: studioResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Lead");
    const slotHandle = ctx.state.createObject("ClipSlot", {});
    ctx.state.pushRef(trackHandle, "clipSlots", slotHandle.id);

    ctx.invokeCommand(COMMAND_ID, slotHandle);
    await wait();
    await wait();
    await wait();

    const slot = ctx.sdk.getObjectFromHandle(slotHandle, ClipSlot);
    const clip = slot.clip as MidiClip<"1.0.0"> | null;
    expect(clip).not.toBeNull();
    // C maj anchor(3) + Em color(3) + 1 melody note = 7
    expect(clip!.notes.length).toBe(7);
  });
});
