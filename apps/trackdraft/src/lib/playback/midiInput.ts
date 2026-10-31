/**
 * Web MIDI input — the listening side of the MIDI port.
 *
 * `liveMidiOut.ts` already owns the permission prompt and the output ports
 * (the app streams its stems there). This module attaches to every *input*
 * port with `addEventListener`, so it coexists with the ATOM SQ's
 * `onmidimessage` handler instead of fighting it for the slot, and keeps
 * listening when a keyboard is plugged in after the page loaded.
 *
 * Only note on/off is surfaced: the chord pad reads pitches, and a stream
 * of clock/CC traffic would just wake the UI up for nothing.
 */

import { getMidiAccess } from "./liveMidiOut";

export interface MidiInputInfo {
  id: string;
  name: string;
}

export interface MidiNoteMessage {
  kind: "on" | "off";
  /** MIDI note number 0–127. */
  pitch: number;
  velocity: number;
  /** 0-based MIDI channel. */
  channel: number;
}

export interface MidiInputConnection {
  /** Ports this connection is listening to, at the time it was opened. */
  inputs: MidiInputInfo[];
  dispose: () => void;
}

export interface ConnectMidiInputsOptions {
  onNote: (message: MidiNoteMessage) => void;
  /** Ports were plugged in or removed — the device list in the UI changed. */
  onInputsChanged?: (inputs: MidiInputInfo[]) => void;
  /** 0-based channels to ignore (e.g. a controller's non-note modes). */
  ignoreChannels?: readonly number[];
  /** Port names to ignore. Pass the selected MIDI *output* name here: a
   *  virtual bus (IAC, loopMIDI) appears as both ends, so the app would
   *  otherwise hear its own click/backing stream as chord input. */
  ignoreInputNames?: readonly string[];
}

/** True wherever the Web MIDI API exists (Chrome/Edge, and Electron). */
export function midiInSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

function describe(inputs: MIDIInputMap, ignoreName: (name: string) => boolean): MidiInputInfo[] {
  return Array.from(inputs.values())
    .filter((input) => !ignoreName(input.name ?? ""))
    .map((input) => ({
      id: input.id,
      name: input.name ?? input.id,
    }));
}

/**
 * Open every MIDI input and forward its notes. Resolves once the browser has
 * granted access; rejects with a readable message when it has not, so the
 * caller can show "MIDI access denied" rather than a silent dead panel.
 *
 * Must be called from a user gesture the first time — the browser ties the
 * permission prompt to one.
 */
export async function connectMidiInputs(
  options: ConnectMidiInputsOptions,
): Promise<MidiInputConnection> {
  if (!midiInSupported()) {
    throw new Error("This browser has no Web MIDI support — use Chrome, Edge, or the desktop app.");
  }
  const access = await getMidiAccess();
  const ignored = new Set(options.ignoreChannels ?? []);
  const ignoredNames = (options.ignoreInputNames ?? [])
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  const ignoreName = (name: string) => ignoredNames.includes(name.trim().toLowerCase());
  const attached = new Map<MIDIInput, (event: Event) => void>();

  const listenerFor = (): ((event: Event) => void) => (raw: Event) => {
    const data = (raw as MIDIMessageEvent).data;
    if (!data || data.length < 2) return;
    const statusByte = data[0]!;
    const status = statusByte & 0xf0;
    const channel = statusByte & 0x0f;
    if (ignored.has(channel)) return;
    const pitch = data[1]!;
    const velocity = data.length > 2 ? data[2]! : 0;
    if (status === 0x90 && velocity > 0) {
      options.onNote({ kind: "on", pitch, velocity, channel });
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      options.onNote({ kind: "off", pitch, velocity: 0, channel });
    }
  };

  const attach = (input: MIDIInput) => {
    if (attached.has(input) || ignoreName(input.name ?? "")) return;
    const listener = listenerFor();
    input.addEventListener("midimessage", listener);
    attached.set(input, listener);
  };

  const detachAll = () => {
    for (const [input, listener] of attached) {
      input.removeEventListener("midimessage", listener);
    }
    attached.clear();
  };

  const refresh = () => {
    // A device that went away is a dead object; keeping its listener in
    // `attached` retained it (and its port) for the life of the page and
    // made the "inputs changed" list a mix of real and removed devices.
    const present = new Set<MIDIInput>(access.inputs.values());
    for (const [input, listener] of attached) {
      if (present.has(input)) continue;
      try {
        input.removeEventListener("midimessage", listener);
      } catch {
        /* the port is already gone */
      }
      attached.delete(input);
    }
    for (const input of access.inputs.values()) attach(input);
    options.onInputsChanged?.(describe(access.inputs, ignoreName));
  };

  const onStateChange = () => refresh();
  refresh();
  access.addEventListener("statechange", onStateChange);

  return {
    inputs: describe(access.inputs, ignoreName),
    dispose: () => {
      access.removeEventListener("statechange", onStateChange);
      detachAll();
    },
  };
}
