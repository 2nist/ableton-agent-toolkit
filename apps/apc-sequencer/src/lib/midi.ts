/**
 * Web MIDI adapters for the APC mini mk2.
 *
 * Ports:
 *   - input   — the APC's MIDI input (pads/buttons/faders arrive here)
 *   - apcOut  — the APC's MIDI output (LED feedback on LED channel 6)
 *   - rackOut — a virtual MIDI bus (macOS IAC Driver "Bus 1") whose output feeds
 *               the Drum Rack track's MIDI input in Live
 *
 * Everything is a thin wrapper over the Web MIDI API; the port-finding rules
 * are heuristics (name matching) and can be overridden by picking a port in the
 * UI. No-op whenever a port is missing, so the app runs as a simulator without
 * hardware.
 */
import {
  buildLedOn,
  buildPadModeSysex,
  PAD_MODE,
  parseMidiMessage,
  resolveIncoming,
  type MidiControl,
} from "@hardware/controller-bridge";
import { APC_MINI_MK2 } from "@hardware/controller-bridge";

export interface MidiPorts {
  input: MIDIInput | null;
  apcOut: MIDIOutput | null;
  rackOut: MIDIOutput | null;
}

export function isApc(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("apc mini mk2") ||
    n.includes("apc min mk2") ||
    // Behind an iConnect interface the APC keeps its name or appears under an "apc" label.
    n.includes("apc")
  );
}

export function isIac(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("iac driver") || n.includes("ableton virtual");
}

/** The APC is behind an iConnectivity interface, so its ports look like "ica4 hst1". */
function isIconnectHost(name: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  return n.includes("ica4") || n.includes("iconnect") || n.includes("i connect") || n.includes("hst");
}

function isIconnectHst1(name: string | null): boolean {
  return (name ?? "").toLowerCase().includes("hst1");
}

/** Device-family guess used to annotate the port picker, so the user can identify ports. */
export function portHint(name: string | null): string {
  const n = (name ?? "").toLowerCase();
  if (isIac(n)) return "IAC";
  if (n.includes("apc")) return "APC";
  if (n.includes("iconnect") || n.includes("ica4") || n.includes("hst")) return "iConnect";
  return "";
}

/** A MIDI port the browser can see (for the port picker UI). */
export interface MidiPortInfo {
  id: string;
  name: string;
  type: "input" | "output";
  /** Device-family guess ("APC" | "IAC" | "iConnect" | "") to help the user pick. */
  hint: string;
}

/** Why the picker might be empty — surfaced in the UI so the user knows what to fix. */
export interface MidiStatus {
  supported: boolean;
  permission: "granted" | "denied" | "unknown";
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  error?: string;
}

/** Enumerate MIDI support + every port, with a human-readable failure reason. */
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

/** Convenience: just the port lists (empty on failure). */
export async function listMidiPorts(): Promise<{ inputs: MidiPortInfo[]; outputs: MidiPortInfo[] }> {
  const status = await getMidiStatus();
  return { inputs: status.inputs, outputs: status.outputs };
}

/** Match a port against a picker value by id or name (id is stable; name is friendlier). */
function matchesPort(p: { id: string; name: string | null }, key: string | undefined): boolean {
  return key !== undefined && (p.id === key || (p.name ?? "") === key);
}

/** Normalize a port name for pairing (case/whitespace-insensitive). */
function normalize(name: string | null): string {
  return (name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The iConnect host-port token in a name ("hst1", "hst2", "daw", …), if any. */
function hostToken(name: string | null): string | null {
  const m = (name ?? "").toLowerCase().match(/(hst\d+|daw|mon|midi)/);
  return m ? m[1] : null;
}

/**
 * The output that shares its name with a given input. iConnectivity host ports
 * come in matched input/output pairs (e.g. "iConnectAUDIO4+ hst2" is both an in
 * and an out), so the APC's LED output is the output named like the input we
 * read from. The LED return MUST go back out on the same host port the input
 * came in on (that's what the iConnect routes back to the APC), so we first
 * look for an exact name match, then fall back to the same host-port token
 * (handles input/output names that differ, e.g. "iConnectAUDIO4+ hst1" in vs
 * "ica4 hst1" out).
 */
function findPairedOutput(outputs: MIDIOutput[], inputName: string | null): MIDIOutput | undefined {
  const stem = normalize(inputName);
  if (stem) {
    const exact = outputs.find((o) => normalize(o.name) === stem);
    if (exact) return exact;
  }
  const tok = hostToken(inputName);
  if (tok) {
    return outputs.find((o) => (o.name ?? "").toLowerCase().includes(tok));
  }
  return undefined;
}

/** Auto-detect APC + IAC ports by name, then wire the input to `onMessage`. */
export async function attachApc(
  onMessage: (control: MidiControl | null, raw: Uint8Array, at: number) => void,
  opts: { pickInput?: string; pickApcOut?: string; pickRackOut?: string } = {},
): Promise<MidiPorts> {
  const ports: MidiPorts = { input: null, apcOut: null, rackOut: null };
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

  // Input: explicit pick, else an APC-named input, else the iConnect host port
  // (the APC behind an ica4 shows as e.g. "ica4 hst1"), else any input.
  ports.input =
    inputs.find((p) => matchesPort(p, opts.pickInput)) ??
    inputs.find((p) => isApc(p.name ?? "")) ??
    inputs.find((p) => isIconnectHst1(p.name)) ??
    inputs.find((p) => isIconnectHost(p.name)) ??
    inputs[0] ??
    null;

  // APC LED output: explicit pick, else an APC-named output, else the output
  // paired with the chosen input (iConnect host ports), else an iConnect host
  // output, else any output.
  ports.apcOut =
    outputs.find((p) => matchesPort(p, opts.pickApcOut)) ??
    outputs.find((p) => isApc(p.name ?? "")) ??
    findPairedOutput(outputs, ports.input?.name ?? null) ??
    outputs.find((p) => isIconnectHst1(p.name)) ??
    outputs.find((p) => isIconnectHost(p.name)) ??
    outputs[0] ??
    null;

  // Rack output: explicit pick, else an IAC/virtual bus, else null.
  ports.rackOut =
    outputs.find((p) => matchesPort(p, opts.pickRackOut)) ??
    outputs.find((p) => isIac(p.name ?? "")) ??
    null;

  if (ports.input) {
    ports.input.onmidimessage = (event) => {
      const bytes = event.data;
      if (!bytes || bytes.length < 1) return;
      const parsed = parseMidiMessage(bytes);
      if (!parsed) return;
      const control = resolveIncoming(APC_MINI_MK2, parsed);
      onMessage(control, bytes, performance.now());
    };
  } else {
    console.warn("[midi] no MIDI input found — running in simulator mode");
  }

  return ports;
}

// ---------------------------------------------------------------------------
// Outgoing helpers (all no-op when the target port is null)
// ---------------------------------------------------------------------------

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xb0;

/** Send a note-on (optionally at a future Web-MIDI timestamp for lookahead). */
export function sendNoteOn(out: MIDIOutput | null, pitch: number, velocity: number, when?: number): void {
  if (!out) return;
  out.send([NOTE_ON, pitch & 0x7f, velocity & 0x7f], when);
}

export function sendNoteOff(out: MIDIOutput | null, pitch: number, when?: number): void {
  if (!out) return;
  out.send([NOTE_OFF, pitch & 0x7f, 0], when);
}

export function sendCc(out: MIDIOutput | null, cc: number, value: number): void {
  if (!out) return;
  out.send([CC, cc & 0x7f, value & 0x7f]);
}

/** Light a pad: note-on on its LED channel with the palette color as velocity. */
export function sendLed(apcOut: MIDIOutput | null, ledChannel: number, note: number, color: number, channel?: number): void {
  if (!apcOut) return;
  apcOut.send(buildLedOn(channel ?? ledChannel, note, color));
}

/** Switch the grid pad mode (sysex). Use the note pad mode for the sequencer. */
export function sendPadMode(apcOut: MIDIOutput | null, mode: number): void {
  if (!apcOut) return;
  const sysex = buildPadModeSysex(APC_MINI_MK2, mode);
  if (sysex) apcOut.send(sysex);
}

export const DEFAULT_PAD_MODE = PAD_MODE.session;
