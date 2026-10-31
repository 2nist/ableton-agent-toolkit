import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";

class FakeOutput {
  sent: number[][] = [];
  send(data: Uint8Array | number[], when?: number): void {
    this.sent.push([...(data as number[]), when ?? 0]);
  }
  clear(): void {
    this.sent = [];
  }
}

const chordPort = new FakeOutput();
const drumPort = new FakeOutput();

/** Both ports are always present; which one receives bytes is the assertion. */
function installMidiAccess(): void {
  const outputs = new Map<string, { id: string; name: string; state: string; send: FakeOutput["send"] }>([
    ["port-chords", { id: "port-chords", name: "Chords", state: "connected", send: chordPort.send.bind(chordPort) }],
    ["port-drums", { id: "port-drums", name: "Drums", state: "connected", send: drumPort.send.bind(drumPort) }],
  ]);
  Object.defineProperty(globalThis.navigator, "requestMIDIAccess", {
    configurable: true,
    value: vi.fn(async () => ({ inputs: new Map(), outputs, addEventListener: vi.fn() })),
  });
}

describe("preview routing", () => {
  beforeEach(() => {
    installMidiAccess();
    chordPort.clear();
    drumPort.clear();
    useMidiSettingsStore.setState({
      midiOutputId: "",
      stemOutputs: { chords: "port-chords", drums: "port-drums" },
    });
  });

  afterEach(() => {
    useMidiSettingsStore.setState({ midiOutputId: "", stemOutputs: {} });
  });

  // These import the whole preview graph (music theory, progression engine,
  // drum library) on first use — seconds of module work that a loaded CI
  // worker can stretch past the default timeout.
  it("auditions a chord through the chords stem's port when the master is off", { timeout: 20_000 }, async () => {
    const { previewChord } = await import("./previewMidi");
    await previewChord({ root: "C", quality: "maj" }, 200);

    expect(chordPort.sent.length).toBeGreaterThan(0);
    expect(drumPort.sent.length).toBe(0);
  });

  it("auditions a drum hit through the drums stem's port", { timeout: 20_000 }, async () => {
    const { auditionDrumHit } = await import("./previewMidi");
    await auditionDrumHit("kick");

    expect(drumPort.sent.length).toBe(2); // note on + note off
    expect(chordPort.sent.length).toBe(0);
  });

  it("stays silent when neither the stem nor the master has a port", { timeout: 20_000 }, async () => {
    useMidiSettingsStore.setState({ midiOutputId: "", stemOutputs: {} });
    const { previewChord, auditionDrumHit } = await import("./previewMidi");
    await previewChord({ root: "C", quality: "maj" }, 200);
    await auditionDrumHit("kick");

    expect(chordPort.sent.length).toBe(0);
    expect(drumPort.sent.length).toBe(0);
  });
});
