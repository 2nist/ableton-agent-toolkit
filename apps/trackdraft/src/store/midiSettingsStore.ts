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
import { STORAGE_KEYS } from "../lib/persistence/keys";

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
  /** Selected MIDI output port id ("" = off). Every stem goes here unless it
   *  has its own port below. */
  midiOutputId: string;
  /**
   * Per-stem output overrides — the external-hardware wiring.
   *
   * A section's stems can leave on different interfaces (drums to the drum
   * module, bass to a synth, everything else to the DAW), so "the MIDI out"
   * is not one port. Absent/"" means "same as the master port", which keeps
   * every existing setup working unchanged. Live-only concern: the .mid
   * export has no ports.
   */
  stemOutputs: Partial<Record<StemId, string>>;
  /** 1-based MIDI channel per stem, plus the instrument metadata the export
   *  path uses. Live out only reads `.channel`. */
  routing: StemRoutingMap;
  /** Port to send MIDI clock on ("" = off). Separate from `midiOutputId`
   *  on purpose: a DAW can follow the clock on one port while the parts
   *  stream to another (or to none at all). */
  clockOutId: string;
  /** Calibrated output latency in ms — positive delays every note. */
  latencyMs: number;
  setMidiOutputId: (id: string) => void;
  /** Point one stem at its own port; "" clears it back to the master. */
  setStemOutput: (stem: StemId, id: string) => void;
  setChannel: (stem: StemId, channel: number) => void;
  setClockOutId: (id: string) => void;
  setLatencyMs: (ms: number) => void;
  applyProfile: (id: RoutingProfileId) => void;
  resetRouting: () => void;
}

const STORAGE_KEY = STORAGE_KEYS.midiSettings.key;

/** The persisted (non-function) slice of the state. */
interface PersistedMidiSettings {
  midiOutputId: string;
  stemOutputs?: Partial<Record<StemId, string>>;
  routing: StemRoutingMap;
  clockOutId: string;
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

/** Keep only real stems with a non-empty id — a stale/foreign key in the
 *  saved blob must not survive into the scheduler. */
function initialStemOutputs(): Partial<Record<StemId, string>> {
  const raw = saved.stemOutputs;
  if (!raw) return {};
  const out: Partial<Record<StemId, string>> = {};
  for (const stem of STEM_IDS) {
    const id = raw[stem];
    if (typeof id === "string" && id !== "") out[stem] = id;
  }
  return out;
}

const initialState = {
  midiOutputId: saved.midiOutputId ?? "",
  stemOutputs: initialStemOutputs(),
  routing: initialRouting(),
  clockOutId: typeof saved.clockOutId === "string" ? saved.clockOutId : "",
  latencyMs: Math.max(-500, Math.min(500, Math.round(saved.latencyMs ?? 0))),
};

export const useMidiSettingsStore = create<MidiSettingsState>((set, get) => {
  const persist = () => {
    const { midiOutputId, stemOutputs, routing, clockOutId, latencyMs } = get();
    writeStorage<PersistedMidiSettings>(STORAGE_KEY, {
      midiOutputId,
      stemOutputs,
      routing,
      clockOutId,
      latencyMs,
    });
  };
  return {
    ...initialState,
    setMidiOutputId: (midiOutputId) => {
      set({ midiOutputId });
      persist();
    },
    setStemOutput: (stem, id) => {
      set((state) => {
        const stemOutputs = { ...state.stemOutputs };
        if (id) stemOutputs[stem] = id;
        else delete stemOutputs[stem];
        return { stemOutputs };
      });
      persist();
    },
    setChannel: (stem, channel) => {
      set((s) => ({ routing: { ...s.routing, [stem]: { ...s.routing[stem], channel: clampChannel(channel) } } }));
      persist();
    },
    setClockOutId: (clockOutId) => {
      set({ clockOutId });
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
