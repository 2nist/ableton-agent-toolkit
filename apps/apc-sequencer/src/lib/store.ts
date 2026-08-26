/**
 * App state for the APC step sequencer.
 *
 * The pattern/geometry logic lives in @hardware/step-sequencer's pure modules;
 * this store is the thin browser mirror that UI + Web MIDI + OSC all mutate
 * through the same actions, so mouse clicks and hardware presses behave
 * identically.
 */
import { create } from "zustand";
import {
  clearPad,
  createDrumRackPattern,
  DRUM_PAD_COUNT,
  randomizePad,
  setPadLength,
  setPadLevel,
  setPadMuted,
  toggleDrumStep,
  type DrumBank,
  type DrumRackPattern,
  type FaderMode,
} from "@hardware/step-sequencer";

export interface PortPicks {
  input?: string;
  apcOut?: string;
  rackOut?: string;
}

// Throttle per-message MIDI UI updates (~15/s). A fader streams hundreds of CC
// messages/sec while moving; pushing every one to the store re-renders the whole
// app each message and can freeze/hang the tab. Share one timer for readout+log.
let lastMidiUiAt = 0;
function midiUiThrottle(): boolean {
  const now = performance.now();
  if (now - lastMidiUiAt < 66) return false;
  lastMidiUiAt = now;
  return true;
}

export interface SequencerStore {
  drum: DrumRackPattern;
  selectedPad: number;
  /** FX pad on-states (16, bottom-right quadrant). */
  fx: boolean[];
  /** Track-button FX on-states (8). */
  trackFx: boolean[];
  shiftHeld: boolean;
  bpm: number;
  resolution: "16" | "8";
  playing: boolean;
  /** Global playhead step 0-31. */
  step: number;
  /** Which clock drives playback. */
  clockSource: "free" | "ableton";
  /** Active drum bank (A = bottom two rows, B = top two rows). */
  bank: DrumBank;
  /** What the 8 sliders control. */
  faderMode: FaderMode;
  /** Live performance mode (taps = play, track buttons = rec-arm). */
  liveMode: boolean;
  /** Device mode follows Live's selected track/device (blue hand) instead of a fixed target. */
  followBlueHand: boolean;
  /** Last sent state of the device on/off switch (param 0). */
  deviceOn: boolean;
  /** How to scale the 8 faders' narrow CC range to full 0-1. */
  faderRangeSetting: "auto" | "0to1" | "0to127";
  /** True while a fader calibration sweep is in progress. */
  faderCalibrating: boolean;
  /** Per-fader observed min/max after calibration (0-127). */
  faderCalib: { lo: number[]; hi: number[] } | null;
  /** Invert the 8 faders (down = quieter) if the hardware sends up = louder. */
  reverseFaders: boolean;
  /** Device-mode faders start at P1 (skip the on/off) or P0 (all params/macros). */
  faderSkipOnOff: boolean;
  /** Advanced mode: banks, fader modes, live mode, device on/off. */
  advanced: boolean;
  /** Live's currently selected track index (blue hand). */
  blueTrack: number | null;
  /** Live's currently selected device index on that track. */
  blueDevice: number | null;
  /** Drum Rack track index that faders control (device 0 params). */
  targetTrack: number;
  /** Rack note just auditioned — the UI flashes that drum pad briefly. */
  flashNote: number | null;
  /** Human-readable description of the last hardware MIDI press (diagnostics). */
  lastMidi: string;
  /** Ring buffer of recent raw MIDI messages (diagnostics). */
  midiLog: string[];
  /** Incoming MIDI messages per second (updated ~1/s). */
  midiInRate: number;
  /** Result of the last MIDI ping (loopback) test. */
  pingResult: string | null;

  // Live / MIDI status
  abletonConnected: boolean;
  abletonPlaying: boolean;
  abletonBeat: number | null;
  midiDevice: string | null;
  apcOut: string | null;
  rackPort: string | null;
  portPicks: PortPicks;

  // ---- actions ----
  selectPad: (pad: number) => void;
  pressStep: (pad: number, step: number, shift: boolean, velocity?: number) => void;
  toggleFx: (slot: number) => void;
  toggleTrackFx: (i: number) => void;
  setShift: (v: boolean) => void;
  setBpm: (v: number) => void;
  setResolution: (r: "16" | "8") => void;
  clearSelected: () => void;
  randomizeSelected: () => void;
  reset: () => void;
  setBank: (bank: DrumBank) => void;
  setFaderMode: (mode: FaderMode) => void;
  setLiveMode: (v: boolean) => void;
  setPadLevel: (pad: number, level: number) => void;
  togglePadMute: (pad: number) => void;
  setFollowBlueHand: (v: boolean) => void;
  setBlueHand: (track: number | null, device: number | null) => void;
  setDeviceOn: (v: boolean) => void;
  setFaderRangeSetting: (v: "auto" | "0to1" | "0to127") => void;
  setAdvanced: (v: boolean) => void;
  setFaderCalibrating: (v: boolean) => void;
  setFaderCalib: (calib: { lo: number[]; hi: number[] } | null) => void;
  setReverseFaders: (v: boolean) => void;
  setFaderSkipOnOff: (v: boolean) => void;
  setPlaying: (v: boolean) => void;
  setStep: (s: number) => void;
  setAbleton: (connected: boolean, isPlaying: boolean, beat: number | null) => void;
  setPorts: (midi: string | null, rack: string | null, apcOut: string | null) => void;
  setPortPicks: (picks: PortPicks) => void;
  setTargetTrack: (track: number) => void;
  setFlashNote: (note: number | null) => void;
  setLastMidi: (desc: string) => void;
  pushMidi: (line: string) => void;
  clearMidiLog: () => void;
  setMidiInRate: (n: number) => void;
  setPingResult: (s: string | null) => void;
}

// --- Settings persistence (survive browser refresh) -------------------------
const PERSIST_KEY = "apc-sequencer-settings-v1";

type PersistedSettings = Pick<
  SequencerStore,
  | "portPicks"
  | "advanced"
  | "reverseFaders"
  | "faderRangeSetting"
  | "faderSkipOnOff"
  | "followBlueHand"
  | "targetTrack"
>;

function loadSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<PersistedSettings>;
  } catch {
    return {};
  }
}

const hydrated: Partial<PersistedSettings> = loadSettings();

export const useSequencerStore = create<SequencerStore>((set) => ({
  drum: createDrumRackPattern(),
  selectedPad: 12, // kick (note 36) selected by default
  fx: Array(DRUM_PAD_COUNT).fill(false),
  trackFx: Array(8).fill(false),
  shiftHeld: false,
  bpm: 120,
  resolution: "16",
  playing: false,
  step: 0,
  clockSource: "free",
  bank: "A",
  faderMode: "volume",
  liveMode: false,
  followBlueHand: true,
  blueTrack: null,
  blueDevice: null,
  deviceOn: true,
  faderRangeSetting: "auto",
  advanced: false,
  faderCalibrating: false,
  faderCalib: null,
  reverseFaders: false,
  faderSkipOnOff: true,
  targetTrack: 0,
  flashNote: null,

  abletonConnected: false,
  abletonPlaying: false,
  abletonBeat: null,
  midiDevice: null,
  apcOut: null,
  rackPort: null,
  portPicks: {},
  ...hydrated,
  lastMidi: "(no MIDI presses yet)",
  midiLog: [],
  midiInRate: 0,
  pingResult: null,

  selectPad: (pad) => set((s) => (pad === s.selectedPad ? s : { selectedPad: pad })),
  pressStep: (pad, step, shift, velocity) =>
    set((s) => ({
      drum: toggleDrumStep(s.drum, pad, step, shift, velocity),
    })),
  toggleFx: (slot) =>
    set((s) => {
      if (slot < 0 || slot >= s.fx.length) return s;
      const fx = s.fx.slice();
      fx[slot] = !fx[slot];
      return { fx };
    }),
  toggleTrackFx: (i) =>
    set((s) => {
      if (i < 0 || i >= s.trackFx.length) return s;
      const trackFx = s.trackFx.slice();
      trackFx[i] = !trackFx[i];
      return { trackFx };
    }),
  setShift: (v) => set({ shiftHeld: v }),
  setBpm: (v) => set({ bpm: Math.max(20, Math.min(300, Math.round(v))) }),
  setResolution: (r) => set({ resolution: r }),
  clearSelected: () => set((s) => ({ drum: clearPad(s.drum, s.selectedPad) })),
  randomizeSelected: () =>
    set((s) => ({ drum: randomizePad(s.drum, s.selectedPad, 0.3) })),
  reset: () =>
    set((s) => ({
      drum: createDrumRackPattern(),
      fx: Array(DRUM_PAD_COUNT).fill(false),
      trackFx: Array(8).fill(false),
      selectedPad: 12,
      step: 0,
      bank: "A",
      faderMode: "volume",
      liveMode: false,
    })),
  setBank: (bank) => set({ bank }),
  setFaderMode: (faderMode) => set({ faderMode }),
  setLiveMode: (liveMode) => set({ liveMode }),
  setPadLevel: (pad, level) => set((st) => ({ drum: setPadLevel(st.drum, pad, level) })),
  togglePadMute: (pad) =>
    set((st) => ({ drum: setPadMuted(st.drum, pad, !st.drum.pads[pad]?.muted) })),
  setFollowBlueHand: (followBlueHand) => set({ followBlueHand }),
  setBlueHand: (blueTrack, blueDevice) => set({ blueTrack, blueDevice }),
  setDeviceOn: (deviceOn) => set({ deviceOn }),
  setFaderRangeSetting: (faderRangeSetting) => set({ faderRangeSetting }),
  setAdvanced: (advanced) => set({ advanced }),
  setFaderCalibrating: (faderCalibrating) => set({ faderCalibrating }),
  setFaderCalib: (faderCalib) => set({ faderCalib }),
  setReverseFaders: (reverseFaders) => set({ reverseFaders }),
  setFaderSkipOnOff: (faderSkipOnOff) => set({ faderSkipOnOff }),
  setPlaying: (v) => set({ playing: v }),
  setStep: (s) => set({ step: s }),
  setAbleton: (connected, isPlaying, beat) =>
    set({ abletonConnected: connected, abletonPlaying: isPlaying, abletonBeat: beat }),
  setPorts: (midi, rack, apcOut) => set({ midiDevice: midi, rackPort: rack, apcOut }),
  setPortPicks: (picks) => set({ portPicks: picks }),
  setTargetTrack: (track) => set({ targetTrack: Math.max(0, Math.floor(track)) }),
  setFlashNote: (note) => set({ flashNote: note }),
  setLastMidi: (desc) => {
    if (!midiUiThrottle()) return;
    set({ lastMidi: desc });
  },
  pushMidi: (line) => {
    if (!midiUiThrottle()) return;
    set((s) => ({ midiLog: [...s.midiLog.slice(-29), line] }));
  },
  clearMidiLog: () => set({ midiLog: [] }),
  setMidiInRate: (midiInRate) => set({ midiInRate }),
  setPingResult: (pingResult) => set({ pingResult }),
}));

// Persist the settings slice whenever it changes.
useSequencerStore.subscribe((s) => {
  try {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        portPicks: s.portPicks,
        advanced: s.advanced,
        reverseFaders: s.reverseFaders,
        faderRangeSetting: s.faderRangeSetting,
        faderSkipOnOff: s.faderSkipOnOff,
        followBlueHand: s.followBlueHand,
        targetTrack: s.targetTrack,
      }),
    );
  } catch {
    /* storage unavailable — ignore */
  }
});

/** Read the current state imperatively (for the hub / clock / output paths). */
export const getSequencer = () => useSequencerStore.getState();
