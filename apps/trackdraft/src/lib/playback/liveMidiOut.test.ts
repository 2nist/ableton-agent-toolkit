import { describe, it, expect } from "vitest";
import { sendTestNote } from "./liveMidiOut";

/** Minimal MIDIOutput double — records the byte arrays + timestamps sent. */
class FakeOutput {
  sent: number[][] = [];
  send(data: Uint8Array | number[], when?: number): void {
    this.sent.push([...(data as number[]), when ?? 0]);
  }
}

describe("sendTestNote", () => {
  it("sends a note-on then note-off on the requested 1-based channel", () => {
    const out = new FakeOutput();
    sendTestNote(out as unknown as MIDIOutput, 3, 60, 100);

    expect(out.sent.length).toBe(2);
    const [noteOn, noteOff] = out.sent;

    // Note on: 0x90 | (channel-1). Channel 3 → wire 2 → 0x92.
    expect(noteOn![0] & 0xf0).toBe(0x90);
    expect((noteOn![0] & 0x0f) + 1).toBe(3);
    expect(noteOn![1]).toBe(60);
    expect(noteOn![2]).toBe(100);

    // Note off: 0x80 | (channel-1), zero velocity.
    expect(noteOff![0] & 0xf0).toBe(0x80);
    expect((noteOff![0] & 0x0f) + 1).toBe(3);
    expect(noteOff![1]).toBe(60);
    expect(noteOff![2]).toBe(0);
  });

  it("clamps channels outside 1-16 into range", () => {
    const out = new FakeOutput();
    sendTestNote(out as unknown as MIDIOutput, 99);
    const [noteOn] = out.sent;
    expect((noteOn![0] & 0x0f) + 1).toBe(16);

    const low = new FakeOutput();
    sendTestNote(low as unknown as MIDIOutput, 0);
    const [noteOnLow] = low.sent;
    expect((noteOnLow![0] & 0x0f) + 1).toBe(1);
  });

  it("clamps velocity and pitch to MIDI ranges", () => {
    const out = new FakeOutput();
    sendTestNote(out as unknown as MIDIOutput, 1, 999, 999);
    const [noteOn] = out.sent;
    expect(noteOn![1]).toBe(127); // pitch & 0x7f
    expect(noteOn![2]).toBe(127); // velocity clamped
  });
});
