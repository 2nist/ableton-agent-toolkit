import { create } from "zustand";
import {
  ROUTING_PROFILES,
  STEM_IDS,
  clampChannel,
  routingFromProfile,
  type RoutingProfileId,
  type StemId,
  type StemRoutingMap,
} from "../lib/stems";
import { readStorage, writeStorage } from "./storage";

/** Per-stem MIDI out settings, persisted across sessions.
 *
 *  Defaults come from the Live template profile (channel = track order:
 *  kit=drums ch.1, crave=bass ch.2, chord ch.3, color ch.4, melody ch.5),
 *  because this store feeds *live* streaming. The file export has its own
 *  General MIDI default and never reads this map — see `lib/stems.ts` for
 *  why those two must not be the same object.
 *
 *  Persisted through the shared `src/store/storage.ts` helper (the same
 *  mechanism as every other store) under the key the former
 *  `zustand/middleware` `persist` used, so existing saved settings load
 *  unchanged; defaults are merged for any channel added since the last
 *  save, and the pre-routing `channels: { drums: 1, ... }` shape is migrated
 *  on read.
 */
interface MidiSettingsState {
  /** Selected MIDI output port id ("" = off). */
  midiOutputId: string;
  /** 1-based MIDI channel per stem, plus the instrument metadata the export
   *  path uses. Live out only reads `.channel`. */
  routing: StemRoutingMap;
  /** Calibrated output latency in ms — positive delays every note. */
  latencyMs: number;
  setMidiOutputId: (id: string) => void;
  setChannel: (stem: StemId, channel: number) => void;
  setLatencyMs: (ms: number) => void;
  applyProfile: (id: RoutingProfileId) => void;
  resetRouting: () => void;
}

const STORAGE_KEY = "trackdraft-midi-settings";

/** The persisted (non-function) slice of the state. */
interface PersistedMidiSettings {
  midiOutputId: string;
  routing: StemRoutingMap;
  latencyMs: number;
}

/** What earlier versions wrote: plain 1-based channel numbers, no metadata. */
interface LegacyMidiSettings {
  midiOutputId?: string;
  channels?: Partial<Record<StemId, number>>;
}

/** Merge possibly-partial persisted routing over a profile's defaults, so a
 *  settings blob saved before a stem existed still loads. */
function mergeRouting(saved: Partial<StemRoutingMap> | undefined, base: StemRoutingMap): StemRoutingMap {
  return STEM_IDS.reduce((map, stem) => {
    const fromSaved = saved?.[stem];
    const fallback = base[stem];
    map[stem] = {
      channel: clampChannel(fromSaved?.channel ?? fallback.channel),
      instrumentName: fromSaved?.instrumentName ?? fallback.instrumentName,
      gmProgram: fromSaved?.gmProgram ?? fallback.gmProgram,
    };
    return map;
  }, {} as StemRoutingMap);
}

const defaultRouting = ROUTING_PROFILES.live.stems;
const saved = readStorage<Partial<PersistedMidiSettings> & LegacyMidiSettings>(STORAGE_KEY, {});

/** Pre-routing saves kept only channels. Carry those numbers forward onto
 *  the Live profile rather than silently resetting the user's wiring. */
function initialRouting(): StemRoutingMap {
  if (saved.routing) return mergeRouting(saved.routing, defaultRouting);
  const legacy = saved.channels;
  if (!legacy) return mergeRouting(undefined, defaultRouting);
  const overlaid = STEM_IDS.reduce((map, stem) => {
    const channel = legacy[stem];
    map[stem] = channel === undefined ? defaultRouting[stem] : { ...defaultRouting[stem], channel };
    return map;
  }, {} as StemRoutingMap);
  return mergeRouting(overlaid, defaultRouting);
}

const initialState = {
  midiOutputId: saved.midiOutputId ?? "",
  routing: initialRouting(),
  latencyMs: Math.max(-500, Math.min(500, Math.round(saved.latencyMs ?? 0))),
};

export const useMidiSettingsStore = create<MidiSettingsState>((set, get) => {
  const persist = () => {
    const { midiOutputId, routing, latencyMs } = get();
    writeStorage<PersistedMidiSettings>(STORAGE_KEY, { midiOutputId, routing, latencyMs });
  };
  return {
    ...initialState,
    setMidiOutputId: (midiOutputId) => {
      set({ midiOutputId });
      persist();
    },
    setChannel: (stem, channel) => {
      set((s) => ({ routing: { ...s.routing, [stem]: { ...s.routing[stem], channel: clampChannel(channel) } } }));
      persist();
    },
    setLatencyMs: (ms) => {
      set({ latencyMs: Math.max(-500, Math.min(500, Math.round(ms))) });
      persist();
    },
    applyProfile: (id) => {
      // A preset is the profile wholesale — channels *and* its default
      // instrument hints. Per-song instrument choices live on the blueprint
      // (`song.instruments`) and override these at export, so nothing the
      // user authored is lost here.
      set({ routing: routingFromProfile(ROUTING_PROFILES[id]) });
      persist();
    },
    resetRouting: () => {
      set({ routing: routingFromProfile(ROUTING_PROFILES.live) });
      persist();
    },
  };
});
