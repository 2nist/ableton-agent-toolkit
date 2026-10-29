import { useEffect, useState } from "react";
import { listMidiInputs, listMidiOutputs, midiOutSupported, type MidiOutputInfo } from "../lib/playback/liveMidiOut";
import { useMidiSettingsStore } from "../store/midiSettingsStore";

export interface MidiPorts {
  supported: boolean;
  outputs: MidiOutputInfo[];
  /** Diagnostic only — "0 inputs" is the answer to "why does the loopback
   *  self-test never pass?" when the virtual bus has no matching input. */
  inputCount: number;
}

/**
 * The available MIDI ports, resolved once per mount.
 *
 * Extracted so the Sync facet and the Settings panel can't disagree about
 * what is connected — they previously each enumerated ports themselves, and
 * both had to remember to reconcile the persisted port id.
 *
 * Web MIDI output ids are NOT stable across browser/app restarts, so a saved
 * id can point at a port that no longer exists. That case clears the id here
 * rather than at each call site: otherwise the "MIDI ●" indicator and Play
 * silently target a phantom port.
 */
export function useMidiOutputs(): MidiPorts {
  const supported = midiOutSupported();
  const [ports, setPorts] = useState<MidiPorts>({ supported, outputs: [], inputCount: 0 });

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    listMidiOutputs()
      .then((outputs) => {
        if (!alive) return;
        setPorts((p) => ({ ...p, outputs }));
        const ids = new Set(outputs.map((o) => o.id));
        const { midiOutputId, setMidiOutputId } = useMidiSettingsStore.getState();
        if (midiOutputId && !ids.has(midiOutputId)) setMidiOutputId("");
      })
      .catch(() => {
        if (alive) setPorts((p) => ({ ...p, outputs: [] }));
      });
    listMidiInputs()
      .then((inputs) => {
        if (alive) setPorts((p) => ({ ...p, inputCount: inputs.length }));
      })
      .catch(() => {
        /* inputs are diagnostic only — a failure just reads as zero */
      });
    return () => {
      alive = false;
    };
  }, [supported]);

  return ports;
}
