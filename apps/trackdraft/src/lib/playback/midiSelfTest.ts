/**
 * MIDI preflight — the answer to "why is there no sound?" on a machine that
 * isn't the one this was built on.
 *
 * The browser path has four ways to fail silently, and they're
 * indistinguishable from the app's side: Web MIDI unsupported (Safari/
 * Firefox), permission denied, no virtual bus configured, or a stale port
 * id. The first two are already visible to the UI; the last two are not —
 * so this module runs an actual **loopback**: write a note out the selected
 * port and listen for it coming back on a matching input. A virtual bus
 * (macOS IAC, loopMIDI on Windows, IAC-style on Linux) appears as both an
 * output and an input, so a returned note proves the OS-level route exists
 * end to end — no DAW open, no cable, nothing to configure.
 *
 * A loopback that returns says "the plumbing works, the problem is
 * downstream in your DAW's MIDI From / channel filter". A loopback that
 * times out says "the problem is here", which is the distinction that
 * matters when you're standing at someone else's laptop.
 */

import { getMidiAccess, midiOutSupported, type MidiOutputInfo } from "./liveMidiOut";

/** High, quiet, and on the last channel — chosen so a probe can't be
 *  mistaken for song material, and so it can't land on a drum kit (which
 *  would make it audible in an unpleasant way). */
const PROBE_PITCH = 108;
const PROBE_CHANNEL_INDEX = 15; // channel 16 (0-based 15)
const PROBE_VELOCITY = 100;
const DEFAULT_TIMEOUT_MS = 1500;

export interface LoopbackResult {
  ok: boolean;
  /** Round-trip time in ms (present when `ok`). */
  roundTripMs?: number;
  /** Which input the probe came back on (present when `ok`). */
  inputName?: string;
  /** What went wrong (present when `!ok`). */
  reason?: string;
  /** What to do about it — the actionable half of a failure. */
  hint?: string;
}

/** Finds the input that is the same bus as `output`.
 *
 *  Web MIDI ids are unique per port, so an IAC bus's output and input have
 *  *different* ids — name is the only reliable correspondence. Exact match
 *  first (the common case: both appear as "IAC Driver Bus 1"), then a shared
 *  prefix for ports that suffix their names differently. */
export function findLoopbackInput(output: MidiOutputInfo, inputs: MidiOutputInfo[]): MidiOutputInfo | null {
  const exactName = inputs.find((i) => i.name === output.name);
  if (exactName) return exactName;

  const normalize = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
  const target = normalize(output.name);
  if (target.length < 4) return null; // too short to be a meaningful prefix
  return (
    inputs.find((input) => {
      const name = normalize(input.name);
      return name.length >= 4 && (name.startsWith(target) || target.startsWith(name));
    }) ?? null
  );
}

/** Sends the probe and waits for it to come back on `input`.
 *
 *  Takes the ports directly rather than looking them up, so it can be driven
 *  by a fake in tests — the timing logic is the interesting part, and it
 *  shouldn't need a browser to exercise. */
export function loopbackTest(
  output: Pick<MIDIOutput, "send">,
  input: Pick<MIDIInput, "onmidimessage">,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Omit<LoopbackResult, "inputName">> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let settled = false;

    const finish = (result: Omit<LoopbackResult, "inputName">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.onmidimessage = null;
      // Always release the probe, even when it never came back — a stuck
      // note-on on channel 16 would sound forever in whatever heard it.
      try {
        output.send([0x80 | PROBE_CHANNEL_INDEX, PROBE_PITCH, 0]);
      } catch {
        // The port can vanish between send and cleanup; nothing to report.
      }
      resolve(result);
    };

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          reason: "no note came back",
          hint:
            "The port exists and the note was written, but nothing returned on its input. " +
            "If this is a virtual bus, check it is enabled and online (macOS: Audio MIDI Setup → IAC Driver).",
        }),
      timeoutMs,
    );

    input.onmidimessage = (event) => {
      const data = event.data;
      if (!data || data.length < 3) return;
      const isNoteOn = (data[0]! & 0xf0) === 0x90;
      if (!isNoteOn || data[1] !== PROBE_PITCH || data[2]! === 0) return;
      finish({ ok: true, roundTripMs: Math.round(performance.now() - startedAt) });
    };

    output.send([0x90 | PROBE_CHANNEL_INDEX, PROBE_PITCH, PROBE_VELOCITY], performance.now() + 20);
  });
}

/** End-to-end self-test against a selected output port id. */
export async function runLoopbackTest(outputId: string, timeoutMs?: number): Promise<LoopbackResult> {
  if (!midiOutSupported()) {
    return {
      ok: false,
      reason: "this browser has no Web MIDI",
      hint: "Open TrackDraft in desktop Chrome (Safari and Firefox don't expose Web MIDI).",
    };
  }

  let access: MIDIAccess;
  try {
    access = await getMidiAccess();
  } catch {
    return {
      ok: false,
      reason: "MIDI permission was denied",
      hint: "Allow MIDI access when the browser asks, then run the test again.",
    };
  }

  const output = access.outputs.get(outputId);
  if (!output) {
    return {
      ok: false,
      reason: "the selected port isn't there anymore",
      hint: "Port ids change between browser restarts — pick the port again above.",
    };
  }

  const inputs: MidiOutputInfo[] = Array.from(access.inputs.values()).map((i) => ({
    id: i.id,
    name: i.name ?? i.id,
  }));
  const match = findLoopbackInput({ id: output.id, name: output.name ?? output.id }, inputs);
  if (!match) {
    return {
      ok: false,
      reason: `no MIDI input matches "${output.name ?? output.id}"`,
      hint:
        inputs.length === 0
          ? "No MIDI inputs are visible at all — a virtual bus needs to exist (macOS: Audio MIDI Setup → IAC Driver → Device is online)."
          : `Only ${inputs.map((i) => `"${i.name}"`).join(", ")} can be read, and none of them is this bus. Create or enable a matching input for it.`,
    };
  }

  const input = access.inputs.get(match.id);
  if (!input) {
    return { ok: false, reason: "the matching input disappeared", hint: "Run the test again." };
  }

  const result = await loopbackTest(output, input, timeoutMs);
  return result.ok ? { ...result, inputName: match.name } : result;
}
