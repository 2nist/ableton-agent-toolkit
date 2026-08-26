/**
 * Web MIDI adapters for the APC mini mk1.
 *
 * Ports:
 *   - input  — the mk1's MIDI input (faders/buttons/shift arrive here)
 *   - apcOut — the mk1's MIDI output (LED feedback for the active bank)
 *
 * There's no MIDI output bus to Live anymore — clip editing goes through
 * AbletonOSC (see osc.ts/clipEdit.ts), not translated MIDI. `apcOut` still
 * exists solely to light the mk1's own bank-indicator LEDs.
 *
 * Adapted from apps/apc-sequencer/src/lib/midi.ts's port-resolution pattern.
 * Everything is a thin wrapper over the Web MIDI API and no-ops whenever a
 * port is missing, so the app runs (with the on-screen fallback) without
 * hardware attached.
 */
import { buildLedOn, parseMidiMessage } from "@hardware/controller-bridge";

export interface MidiPorts {
  input: MIDIInput | null;
  apcOut: MIDIOutput | null;
}

export function isMk1(name: string): boolean {
  const n = name.toLowerCase();
  // Match "apc" + "mini" regardless of separator — real CoreMIDI names seen
  // in the wild include "APC_mini Input" (underscore, via an iConnectivity
  // interface), not just "APC mini" (space). Exclude anything with "mk2",
  // since the mk2's own port name always includes it (e.g. "APC_mini_mk2").
  return n.includes("apc") && n.includes("mini") && !n.includes("mk2");
}

/**
 * The mk1 is behind an iConnectivity interface (e.g. ICA4+), so its ports
 * show up as a host-port name like "ica4 hst3" rather than "APC mini" —
 * same situation as apps/apc-sequencer's mk2. Deliberately NOT used for
 * auto-detection here: if two devices share one interface at different host
 * ports, guessing "the iConnect port" risks silently grabbing the wrong
 * one. This is only used to annotate the port picker so a host-port name
 * like "ica4 hst3" is easier to pick out for manual selection.
 */
function isIconnectHost(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("ica4") || n.includes("iconnect") || n.includes("i connect") || n.includes("hst");
}

/** Device-family guess used to annotate the port picker. */
export function portHint(name: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (isMk1(n)) return "APC mini mk1";
  if (isIconnectHost(n)) return "iConnect";
  if (n.includes("apc")) return "APC (other)";
  return "";
}

export interface MidiPortInfo {
  id: string;
  name: string;
  type: "input" | "output";
  hint: string;
}

export interface MidiStatus {
  supported: boolean;
  permission: "granted" | "denied" | "unknown";
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  error?: string;
}

export async function getMidiStatus(): Promise<MidiStatus> {
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    return {
      supported: false,
      permission: "unknown",
      inputs: [],
      outputs: [],
      error: "Web MIDI API not available in this browser",
    };
  }
  try {
    const access = await navigator.requestMIDIAccess({ sysex: true });
    return {
      supported: true,
      permission: "granted",
      inputs: [...access.inputs.values()].map((p) => ({
        id: p.id,
        name: p.name ?? "(unnamed)",
        type: "input" as const,
        hint: portHint(p.name),
      })),
      outputs: [...access.outputs.values()].map((p) => ({
        id: p.id,
        name: p.name ?? "(unnamed)",
        type: "output" as const,
        hint: portHint(p.name),
      })),
    };
  } catch (err) {
    return {
      supported: true,
      permission: "denied",
      inputs: [],
      outputs: [],
      error: err instanceof Error ? err.message : "MIDI access denied",
    };
  }
}

export async function listMidiPorts(): Promise<{ inputs: MidiPortInfo[]; outputs: MidiPortInfo[] }> {
  const status = await getMidiStatus();
  return { inputs: status.inputs, outputs: status.outputs };
}

function matchesPort(p: { id: string; name: string | null }, key: string | undefined): boolean {
  return key !== undefined && (p.id === key || (p.name ?? "") === key);
}

/** Auto-detect the mk1 input + its own LED output, then wire `onMessage`. */
export async function attachMk1(
  onMessage: (bytes: Uint8Array, at: number) => void,
  opts: { pickInput?: string; pickApcOut?: string } = {},
): Promise<MidiPorts> {
  const ports: MidiPorts = { input: null, apcOut: null };
  if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
    console.warn("[midi] Web MIDI not available");
    return ports;
  }

  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess({ sysex: true });
  } catch (err) {
    console.warn("[midi] MIDI access denied", err);
    return ports;
  }

  const inputs = [...access.inputs.values()];
  const outputs = [...access.outputs.values()];

  ports.input =
    inputs.find((p) => matchesPort(p, opts.pickInput)) ??
    inputs.find((p) => isMk1(p.name ?? "")) ??
    null;

  ports.apcOut =
    outputs.find((p) => matchesPort(p, opts.pickApcOut)) ??
    outputs.find((p) => isMk1(p.name ?? "")) ??
    null;

  if (ports.input) {
    ports.input.onmidimessage = (event) => {
      const bytes = event.data;
      if (!bytes || bytes.length < 1) return;
      onMessage(bytes, performance.now());
    };
  } else {
    console.warn("[midi] no APC mini mk1 input found — running in simulator mode");
  }

  return ports;
}

/** Light a button/pad on the mk1's own output (BiLedColors velocity: 0 off, 1 green, 3 red, 5 amber). */
export function sendLed(apcOut: MIDIOutput | null, channel: number, note: number, color: number): void {
  if (!apcOut) return;
  apcOut.send(buildLedOn(channel, note, color));
}

export { parseMidiMessage };
