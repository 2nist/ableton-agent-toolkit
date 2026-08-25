import { ClipSlot, MidiClip, MidiTrack } from "@ableton-extensions/sdk";
import { createMockContext } from "@platform/test-harness";
import { describe, expect, it } from "vitest";
import { activate } from "../src/extension.js";

const COMMAND_ID = "drumStudio.open";
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

// "standard" is a real pattern guaranteed to resolve to at least one variant
// in the actual bundled @drum/library preset data (see presetData.ts's own
// invariant: every pattern except "none" always has one).
const patternResult = JSON.stringify({
  mode: "pattern",
  pattern: "standard",
  variantIndex: 0,
  bars: 1,
  velocity: "mf",
  transitionModel: "none",
  transitionBars: 1,
});
const outlineResult = JSON.stringify({
  mode: "outline",
  cells: [2, 2, 3],
  cellVoices: [],
  denominator: 16,
  bars: 2,
  velocity: "mf",
  transitionModel: "none",
  transitionBars: 1,
});

describe("drum-studio extension", () => {
  it("registers Open Drum Studio on both MidiTrack and ClipSlot scopes", () => {
    const ctx = createMockContext();
    activate(ctx.activation);

    const registered = ctx.log.filter("ui.registerContextMenuAction");
    expect(registered.map((r) => r.args[2])).toEqual([COMMAND_ID, COMMAND_ID]);
    expect(registered.map((r) => r.args[0])).toEqual(["MidiTrack", "ClipSlot"]);
  });

  it("renders the studio result as one MIDI clip in two grouped transactions", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: patternResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    expect(ctx.log.filter("ui.showModalDialog")).toHaveLength(1);
    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(1);

    const clip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(clip.name).toBe("Standard · 1 bar");
    expect(clip.startTime).toBe(0);
    expect(clip.duration).toBe(4); // 1 bar * 4 beatsPerBar
    expect(clip.notes.length).toBeGreaterThan(0);
    expect(ctx.log.filter("transaction.begin")).toHaveLength(2); // create, then fill
  });

  it("renders an outline-mode result", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: outlineResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(1);
    const clip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(clip.name).toBe("7/16 (2+2+3) · 2 bars");
    expect(clip.duration).toBeCloseTo(3.5); // 2 bars * 1.75 beats/bar
    expect(clip.notes.length).toBeGreaterThan(0);
  });

  it("places a new clip after the last existing clip", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: patternResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");

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
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: JSON.stringify(null) }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(0);
  });

  it("does nothing when the modal window is closed with no result at all", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ error: true }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(0);
  });

  it("renders into a Session clip slot when invoked from a ClipSlot handle", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: patternResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");
    const slotHandle = ctx.state.createObject("ClipSlot", {});
    ctx.state.pushRef(trackHandle, "clipSlots", slotHandle.id);
    ctx.state.setParent(slotHandle, trackHandle);

    ctx.invokeCommand(COMMAND_ID, slotHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    expect(track.arrangementClips).toHaveLength(0); // nothing in arrangement
    const slot = ctx.sdk.getObjectFromHandle(slotHandle, ClipSlot);
    const clip = slot.clip as MidiClip<"1.0.0"> | null;
    expect(clip).not.toBeNull();
    expect(clip!.name).toBe("Standard · 1 bar");
    expect(clip!.notes.length).toBeGreaterThan(0);
  });

  it("injects Live's time signature into the modal", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: patternResult }) });
    const songHandleId = ctx.state.getProp<bigint>(ctx.applicationHandle, "song");
    const sceneHandle = ctx.state.createObject("Scene", { name: "Scene 1", signatureNumerator: 7, signatureDenominator: 8 });
    ctx.state.pushRef({ id: songHandleId }, "scenes", sceneHandle.id);

    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const modal = ctx.log.filter("ui.showModalDialog")[0]!;
    const url = modal.args[0] as string;
    expect(decodeURIComponent(url)).toContain('"signatureNumerator":7');
    expect(decodeURIComponent(url)).toContain('"signatureDenominator":8');
  });

  it("resolves a non-empty pad mapping end-to-end for a real DrumRack whose pads sit at the assumed notes", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: patternResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Kit");

    const rackHandle = ctx.state.createObject("DrumRackDevice", { name: "Standard Kit" }, trackHandle.id);
    ctx.state.pushRef(trackHandle, "devices", rackHandle.id);
    const kickChain = ctx.state.createObject("DrumChain", { devices: [] }, rackHandle.id);
    ctx.state.pushRef(rackHandle, "chains", kickChain.id);
    ctx.state.setProp(kickChain, "receivingNote", 36n); // the assumed kick note

    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    // Confirms the full plumbing (findDrumRack -> probeDrumRack ->
    // resolvePadMapping -> remapPitch) runs against a real DrumRack/DrumChain
    // object graph without error. Note this is necessarily an *identity*
    // check, not a "moved pad" one: resolvePadMapping only ever populates
    // mapping[role] by finding a pad already sitting at that role's assumed
    // note (`ASSUMED[receivingNote] -> role`), so mapping[role] can only
    // ever equal the same note @drum/library already assumes for that role.
    // remapPitch is therefore a no-op for any mapping resolvePadMapping can
    // produce today — see this test file's header comment and probe.ts's
    // docstrings for what a real fix (independent role classification,
    // e.g. from sample names) would need.
    expect(ctx.log.filter("ui.showModalDialog")).toHaveLength(1);
    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    const clip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(clip.notes.some((n) => n.pitch === 36)).toBe(true);
  });

  it("leaves notes unremapped when the track has no DrumRack and no kit fallback exists", async () => {
    const ctx = createMockContext({ onShowModalDialog: () => ({ result: patternResult }) });
    activate(ctx.activation);
    const trackHandle = ctx.addTrack("MidiTrack", "Untitled");
    ctx.invokeCommand(COMMAND_ID, trackHandle);
    await wait();
    await wait();

    const track = ctx.sdk.getObjectFromHandle(trackHandle, MidiTrack);
    const clip = track.arrangementClips[0]! as MidiClip<"1.0.0">;
    expect(clip.notes.some((n) => n.pitch === 36)).toBe(true); // unchanged kick pitch
  });
});
