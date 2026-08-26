import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_LIVE_MIDI_CHANNELS, type LiveMidiChannelMap } from "../lib/playback/liveMidiOut";

/** Per-stem MIDI out settings, persisted across sessions.
 *
 *  The default channel map matches the template's track order (kit=drums
 *  ch.1, crave=bass ch.2, chord ch.3, color ch.4), but the user's Live
 *  template may listen on different channels — so every channel is
 *  editable in the MIDI setup panel and remembered here, and playback
 *  passes this exact map to `LiveMidiScheduler.start()`.
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

export const useMidiSettingsStore = create<MidiSettingsState>()(
  persist(
    (set) => ({
      midiOutputId: "",
      channels: DEFAULT_LIVE_MIDI_CHANNELS,
      setMidiOutputId: (midiOutputId) => set({ midiOutputId }),
      setChannel: (stem, channel) =>
        set((s) => ({ channels: { ...s.channels, [stem]: Math.max(1, Math.min(16, channel)) } })),
      resetChannels: () => set({ channels: DEFAULT_LIVE_MIDI_CHANNELS }),
    }),
    { name: "trackdraft-midi-settings" },
  ),
);
