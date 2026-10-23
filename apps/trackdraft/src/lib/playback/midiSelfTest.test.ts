import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findLoopbackInput, loopbackTest } from "./midiSelfTest";

class FakeInput {
  onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => unknown) | null = null;
  emit(bytes: number[]): void {
    this.onmidimessage?.call(
      this as unknown as MIDIInput,
      { data: new Uint8Array(bytes) } as unknown as MIDIMessageEvent,
    );
  }
}

class FakeOutput {
  sent: number[][] = [];
  send(data: Uint8Array | number[], when?: number): void {
    this.sent.push([...(data as number[]), when ?? 0]);
  }
}

/** The probe is deliberately a high note on the last channel, so it can't be
 *  mistaken for song material or land on a drum kit. */
const PROBE_ON = [0x9f, 108, 100];
const PROBE_OFF = [0x8f, 108, 0];

describe("findLoopbackInput", () => {
  const output = { id: "out-1", name: "IAC Driver Bus 1" };

  it("matches the same bus by name, since ids differ per direction", () => {
    const match = findLoopbackInput(output, [
      { id: "in-a", name: "Built-in Microphone" },
      { id: "in-b", name: "IAC Driver Bus 1" },
    ]);
    expect(match?.id).toBe("in-b");
  });

  it("falls back to a shared prefix when the names are suffixed differently", () => {
    const match = findLoopbackInput({ id: "out-2", name: "Loopback A" }, [
      { id: "in-c", name: "Loopback A Input" },
    ]);
    expect(match?.id).toBe("in-c");
  });

  it("returns null when nothing corresponds", () => {
    const match = findLoopbackInput(output, [{ id: "in-a", name: "Keystation 88" }]);
    expect(match).toBeNull();
  });

  it("refuses to guess from a very short name", () => {
    // "AB" would otherwise prefix-match half the port list.
    const match = findLoopbackInput({ id: "out-3", name: "AB" }, [{ id: "in-d", name: "ABC Keys" }]);
    expect(match).toBeNull();
  });
});

describe("loopbackTest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports success when the probe comes back", async () => {
    const output = new FakeOutput();
    const input = new FakeInput();

    const pending = loopbackTest(output, input, 1500);
    expect(output.sent[0]!.slice(0, 3)).toEqual(PROBE_ON);

    input.emit(PROBE_ON);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("always releases the probe, even on a successful round trip", async () => {
    const output = new FakeOutput();
    const input = new FakeInput();

    const pending = loopbackTest(output, input, 1500);
    input.emit(PROBE_ON);
    await pending;

    // A stuck note-on would sound forever in whatever heard the probe.
    expect(output.sent[output.sent.length - 1]!.slice(0, 3)).toEqual(PROBE_OFF);
    expect(input.onmidimessage).toBeNull();
  });

  it("times out with an actionable reason when nothing returns", async () => {
    const output = new FakeOutput();
    const input = new FakeInput();

    const pending = loopbackTest(output, input, 1500);
    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no note came back");
    expect(result.hint).toMatch(/IAC Driver|online/);
  });

  it("ignores other traffic on the same input", async () => {
    const output = new FakeOutput();
    const input = new FakeInput();

    const pending = loopbackTest(output, input, 1000);
    input.emit([0x9f, 60, 100]); // some other note
    input.emit(PROBE_OFF); // the probe's own note-off is not a return
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toMatchObject({ ok: false });
  });
});
