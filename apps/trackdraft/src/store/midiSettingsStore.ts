import { create } from "zustand";
import { DEFAULT_LIVE_MIDI_CHANNELS, type LiveMidiChannelMap } from "../lib/playback/liveMidiOut";
import { readStorage, writeStorage } from "./storage";

/** Per-stem MIDI out settings, persisted across sessions.
 *
 *  The default channel map matches the template's track order (kit=drums
 *  ch.1, crave=bass ch.2, chord ch.3, color ch.4), but the user's Live
 *  template may listen on different channels — so every channel is
 *  editable in the MIDI setup panel and remembered here, and playback
 *  passes this exact map to `LiveMidiScheduler.start()`.
 *
 *  Persisted through the shared `src/store/storage.ts` helper (the same
 *  mechanism as every other store) under the key the former
 *  `zustand/middleware` `persist` used, so existing saved settings load
 *  unchanged; defaults are merged for any channel added since the last
 *  save.
 */
interface MidiSettingsState {
  /** Selected MIDI output port id ("" = off). */
  midiOutputId: string;
  /** 1-based MIDI channel per stem. */
  channels: LiveMidiChannelMap;
  setMidiOutputId: (id: string) => void;
  setChannel: (stem: keyof LiveMidiChannelMap, channel: number) => void;
  resetChannels: () => void;
}

const STORAGE_KEY = "trackdraft-midi-settings";

/** The persisted (non-function) slice of the state. */
interface PersistedMidiSettings {
  midiOutputId: string;
  channels: LiveMidiChannelMap;
}

const saved = readStorage<Partial<PersistedMidiSettings>>(STORAGE_KEY, {});
const initialState: PersistedMidiSettings = {
  midiOutputId: saved.midiOutputId ?? "",
  channels: { ...DEFAULT_LIVE_MIDI_CHANNELS, ...saved.channels },
};

export const useMidiSettingsStore = create<MidiSettingsState>((set, get) => {
  const persist = () => {
    const { midiOutputId, channels } = get();
    writeStorage<PersistedMidiSettings>(STORAGE_KEY, { midiOutputId, channels });
  };
  return {
    midiOutputId: initialState.midiOutputId,
    channels: initialState.channels,
    setMidiOutputId: (midiOutputId) => {
      set({ midiOutputId });
      persist();
    },
    setChannel: (stem, channel) => {
      set((s) => ({ channels: { ...s.channels, [stem]: Math.max(1, Math.min(16, channel)) } }));
      persist();
    },
    resetChannels: () => {
      set({ channels: DEFAULT_LIVE_MIDI_CHANNELS });
      persist();
    },
  };
});
