/**
 * Hub — wires Web MIDI input, the step clock, AbletonOSC and LED output
 * together. Both hardware presses (via Web MIDI) and UI clicks (via `pressGrid`)
 * funnel through the same path, so the app behaves identically with or without
 * the controller plugged in (it degrades to a simulator).
 */
import { APC_MINI_MK2, type MidiControl } from "@hardware/controller-bridge";
import {
  bankSlotPad,
  drumRackTriggers,
  fxSlotAt,
  padLevel,
  padMuted,
  regionOf,
  remapCcToUnit,
  renderDrumRackLeds,
  resolvePadPress,
  sceneButtonRole,
  trackButtonRole,
  type FaderMode,
  type GridAction,
} from "@hardware/step-sequencer";
import { getSequencer, useSequencerStore, type PortPicks } from "./store";
import {
  attachApc,
  DEFAULT_PAD_MODE,
  getMidiStatus,
  sendLed,
  sendNoteOff,
  sendNoteOn,
  sendPadMode,
  type MidiPorts,
  type MidiStatus,
} from "./midi";
import { getAbleton } from "./osc";
import { StepClock } from "./clock";

let ports: MidiPorts = { input: null, apcOut: null, rackOut: null };
let clock: StepClock | null = null;
let unsubscribeStore: (() => void) | null = null;
let started = false;
const cleanupListeners: (() => void)[] = [];

// --- MIDI diagnostics ---
let midiInCount = 0;
let midiInLastTotal = 0;
let pingAt: number | null = null;

/** Send an unmistakable note (99 on LED ch6) and see if the iConnect loops it back. */
export function midiPing(): void {
  const s = getSequencer();
  if (!ports.apcOut) {
    s.setPingResult("No APC output bound — nothing to ping with.");
    return;
  }
  pingAt = performance.now();
  sendLed(ports.apcOut, 6, 99, 1);
  const t = pingAt;
  setTimeout(() => {
    if (pingAt === t) {
      pingAt = null;
      s.setPingResult("Ping sent on note 99 — no loopback received (output isn't looping back to input).");
    }
  }, 1500);
}

// --- LED output diffing (send only what changed — stops the MIDI flood/stutter) ---
const lastLed = new Map<number, string>();

/** Render the whole grid to the APC's LEDs from the current store state. */
export function renderLeds(): void {
  const s = getSequencer();
  if (!ports.apcOut) return;
  const cells = renderDrumRackLeds(APC_MINI_MK2.matrices.clip_launch_buttons, {
    drum: s.drum,
    selectedPad: s.selectedPad,
    fx: s.fx,
    bank: s.bank,
    faderMode: s.faderMode,
    liveMode: s.liveMode,
    advanced: s.advanced,
    clock: {
      isPlaying: s.playing,
      bpm: s.bpm,
      resolution: s.resolution,
      fractionalStep: s.step,
      step: s.step,
      phase: 0,
    },
  });
  for (const c of cells) {
    const key = `${c.color}:${c.channel ?? ""}`;
    if (lastLed.get(c.note) !== key) {
      sendLed(ports.apcOut, c.ledChannel, c.note, c.color, c.channel);
      lastLed.set(c.note, key);
    }
  }
}

function ensureClock(): StepClock {
  if (!clock) {
    clock = new StepClock({
      onStep: (step) => {
        const s = getSequencer();
        s.setStep(step);
        // Trigger the rack notes that fire on this step (lookahead via timestamps).
        const triggers = drumRackTriggers(s.drum, step);
        const now = performance.now();
        for (const t of triggers) {
          sendNoteOn(ports.rackOut, t.pitch, t.velocity, now + 2);
          sendNoteOff(ports.rackOut, t.pitch, now + 45);
        }
        renderLeds();
      },
    });
  }
  return clock;
}

// ---------------------------------------------------------------------------
// Actions (shared by UI and hardware)
// ---------------------------------------------------------------------------

/** Simulate a physical pad press (UI clicks call this; hardware goes through onMidi). */
export function pressGrid(row: number, col: number, velocity = 100): GridAction {
  const s = getSequencer();
  const action = resolvePadPress(row, col, s.shiftHeld, s.selectedPad);
  switch (action.type) {
    case "selectPad": {
      s.selectPad(action.pad);
      s.setFlashNote(action.previewNote);
      previewPad(action.pad, action.previewNote, velocity);
      break;
    }
    case "previewPad": {
      // Audition only — keep the step editor on the currently selected pad.
      s.setFlashNote(action.previewNote);
      previewPad(action.pad, action.previewNote, velocity);
      break;
    }
    case "toggleStep":
      s.pressStep(action.pad, action.step, action.shift, velocity);
      break;
    case "toggleFx":
      s.toggleFx(action.slot);
      break;
    case "selectBank":
    case "setFaderMode":
    case "toggleLive":
      // Basic mode: the FX mode row is just FX toggles. Advanced: bank/fader/live.
      if (s.advanced) {
        if (action.type === "selectBank") s.setBank(action.bank);
        else if (action.type === "setFaderMode") s.setFaderMode(action.mode);
        else s.setLiveMode(!s.liveMode);
      } else {
        s.toggleFx(fxSlotAt(row, col));
      }
      break;
    case "none":
      break;
  }
  renderLeds();
  return action;
}

/** Preview a pad's note, respecting mute + level. */
function previewPad(pad: number, note: number, velocity: number): void {
  const s = getSequencer();
  if (padMuted(s.drum, pad)) return;
  const level = padLevel(s.drum, pad);
  if (level <= 0) return;
  sendPreview(note, Math.max(1, Math.min(127, Math.round(velocity * level))));
}

/** Send a one-shot preview note to the rack (skip while the sequencer is playing). */
function sendPreview(note: number, velocity: number): void {
  if (getSequencer().playing) return;
  sendNoteOn(ports.rackOut, note, velocity);
  setTimeout(() => sendNoteOff(ports.rackOut, note), 60);
}

export function togglePlay(): void {
  const s = getSequencer();
  setPlaying(!s.playing);
}

export function setPlaying(v: boolean): void {
  const s = getSequencer();
  s.setPlaying(v);
  if (v) {
    ensureClock().start(s.bpm, s.resolution, s.step);
    getAbleton().send("/live/song/set/tempo", [s.bpm]);
  } else {
    ensureClock().stop();
  }
  renderLeds();
}

export function setClockSource(source: "free" | "ableton"): void {
  useSequencerStore.setState({ clockSource: source });
  if (source === "ableton") getAbleton().connect();
}

export function setTargetTrack(track: number): void {
  useSequencerStore.setState({ targetTrack: track });
}

export function setAbletonBpmOverride(bpm: number): void {
  getAbleton().send("/live/song/set/tempo", [bpm]);
}

// ---------------------------------------------------------------------------
// MIDI input dispatch
// ---------------------------------------------------------------------------

function onMidi(control: MidiControl | null, raw: Uint8Array, _at: number): void {
  const s = getSequencer();
  midiInCount++;
  // Loopback ping detection: note 99 on LED ch6 is the app's own ping marker.
  if (raw[0] === 0x96 && raw[1] === 99 && pingAt !== null) {
    const lat = performance.now() - pingAt;
    pingAt = null;
    s.setPingResult(`Ping looped back on note 99 in ${Math.round(lat)}ms`);
  }
  // MIDI monitor — log every message (raw hex + resolution) for diagnostics.
  const hex = Array.from(raw)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  if (control) {
    if (control.kind === "pad") {
      s.pushMidi(`[${hex}] ${control.matrix} r${control.row} c${control.col} · note ${control.note}`);
    } else if (control.kind === "control") {
      s.pushMidi(`[${hex}] ${control.name}`);
    } else {
      s.pushMidi(`[${hex}] sysex`);
    }
  } else {
    s.pushMidi(`[${hex}] (unmapped)`);
  }

  if (!control) return;
  const velocity = raw[2] ?? 0;
  const isPress = velocity > 0;

  if (control.kind === "pad") {
    if (!isPress) return; // ignore note-off for pads/buttons
    const matrix = control.matrix;
    // The 8×8 pad grid can arrive via either matrix, depending on the APC's pad
    // mode: clip_launch_buttons (ch 0, notes 0-63, session/note) or drum_pads
    // (ch 9, notes 64-127, drum). Treat both as the same grid.
    if (matrix === "clip_launch_buttons" || matrix === "drum_pads") {
      const action = pressGrid(control.row, control.col, velocity);
      const ch = matrix === "drum_pads" ? 9 : 0;
      getSequencer().setLastMidi(
        `note ${control.note} (ch ${ch}) → ${regionOf(control.row, control.col)} r${control.row} c${control.col} · ${action.type}`,
      );
    } else if (matrix === "track_buttons") {
      const s = getSequencer();
      if (s.advanced && s.shiftHeld) {
        // SHIFT + track 1-4 selects what the sliders control (advanced mode).
        const modes: FaderMode[] = ["volume", "pan", "send", "device"];
        const mode = modes[control.col];
        if (mode) {
          s.setFaderMode(mode);
          s.setLastMidi(`SHIFT + track ${control.col + 1} → fader mode: ${mode}`);
        }
      } else if (s.advanced && s.liveMode && control.col === 0) {
        // Live mode: first track button arms the rack track so a take can be recorded.
        getAbleton().send("/live/track/set/arm", [s.targetTrack, true]);
        s.setLastMidi(`track 1 → rec-arm track ${s.targetTrack}`);
      } else if (s.advanced && s.faderMode === "device" && control.col === 0) {
        // Device mode: first track button toggles the device's on/off (param 0).
        toggleDeviceOnOff();
        s.setLastMidi(`track 1 → device on/off: ${getSequencer().deviceOn ? "ON" : "OFF"}`);
      } else {
        // Basic mode (and the default): mute the drum for that bank slot.
        const pad = bankSlotPad(s.bank, control.col);
        s.togglePadMute(pad);
        s.setLastMidi(`track ${control.col + 1} → mute pad ${pad + 1} (bank ${s.bank})`);
      }
    } else if (matrix === "scene_launch_buttons") {
      getSequencer().setLastMidi(`scene btn ${control.note} (ch 0) → scene ${control.col + 1}`);
      handleScene(control.col);
    } else if (matrix === "faders") {
      const i = control.col;
      const hex = Array.from(raw)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
      const scaled = Math.round(faderValue01(i, velocity) * 100);
      const lo = faderMin[i] === 127 ? 0 : faderMin[i];
      const hi = faderMax[i] === -1 ? 0 : faderMax[i];
      getSequencer().setLastMidi(
        `fader ${i + 1} → [${hex}] · range ${lo}-${hi} (${faderDistinct[i].size} vals) · scaled ${scaled}% · mode ${getSequencer().faderMode}`,
      );
      handleFader(i, velocity);
    } else {
      console.warn("[hub] unhandled pad matrix", matrix, control.row, control.col, "vel", velocity);
    }
  } else if (control.kind === "control") {
    if (control.name === "shift_button") {
      getSequencer().setLastMidi(`shift ${isPress ? "down" : "up"} (note 122)`);
      getSequencer().setShift(isPress);
      renderLeds();
    } else if (control.name === "master_fader") {
      const hex = Array.from(raw)
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
      const scaled = Math.round(faderValue01(8, velocity) * 100);
      const lo = faderMin[8] === 127 ? 0 : faderMin[8];
      const hi = faderMax[8] === -1 ? 0 : faderMax[8];
      getSequencer().setLastMidi(
        `master fader → [${hex}] · range ${lo}-${hi} (${faderDistinct[8].size} vals) · scaled ${scaled}%`,
      );
      handleFader(8, velocity);
    }
  }
}

function handleScene(index: number): void {
  const s = getSequencer();
  const role = sceneButtonRole(index);
  switch (role) {
    case "play_stop":
      togglePlay();
      break;
    case "resolution": {
      const next: "16" | "8" = s.resolution === "16" ? "8" : "16";
      s.setResolution(next);
      if (s.playing) ensureClock().start(s.bpm, next, s.step);
      renderLeds();
      break;
    }
    case "clear_pad":
      s.clearSelected();
      renderLeds();
      break;
    case "follow_live":
      setClockSource(s.clockSource === "free" ? "ableton" : "free");
      renderLeds();
      break;
    case "solo_pad":
    case "mute_pad":
    case "pattern_toggle":
    case "commit_clip":
      // v1: not wired (see README) — log so the mapping is visible in dev.
      console.log(`[hub] scene ${index} (${role}) not wired in v1`);
      break;
    default:
      break;
  }
}

/** Send a device parameter value (0-1) via OSC — to Live's selected device (blue
 * hand) when following, else the app's fixed target track, device 0. */
export function setDeviceParam(param: number, value01: number): void {
  const s = getSequencer();
  const p = Math.min(8, Math.max(0, Math.floor(param)));
  const ab = getAbleton().getState();
  const track = s.followBlueHand && ab.selectedTrack !== undefined ? ab.selectedTrack : s.targetTrack;
  const device = s.followBlueHand && ab.selectedDevice !== undefined ? ab.selectedDevice : 0;
  getAbleton().send("/live/device/set/parameter/value", [track, device, p, value01]);
}

// --- Fader input handling ---------------------------------------------------
// The APC's 8 faders send a NARROW CC range (the user reports ~0-1), so a
// plain /127 map only sweeps 1/127th of the destination. A "Fader range"
// setting scales them: 0-1 → full 0-1, 0-127 → normal. The master fader
// (CC 56) is a normal 0-127 fader and always maps raw/127 (kit volume).
// We also coalesce rapid fader messages (bursts / duplicate deliveries) so
// one physical move doesn't fire the control repeatedly.
const faderMin = new Array<number>(9).fill(127);
const faderMax = new Array<number>(9).fill(-1);
const faderDistinct: Set<number>[] = Array.from({ length: 9 }, () => new Set());
const calibMin = new Array<number>(9).fill(127);
const calibMax = new Array<number>(9).fill(-1);

/** Begin a 4s calibration sweep — move each fader full range, then the observed min/max snap in. */
export function startFaderCalibration(): void {
  const s = getSequencer();
  calibMin.fill(127);
  calibMax.fill(-1);
  s.setFaderCalibrating(true);
  s.setFaderCalib(null);
  setTimeout(() => {
    s.setFaderCalibrating(false);
    s.setFaderCalib({ lo: calibMin.slice(), hi: calibMax.slice() });
  }, 4000);
}

function faderValue01(faderIndex: number, raw: number): number {
  const i = Math.max(0, Math.min(8, faderIndex));
  faderMin[i] = Math.min(faderMin[i], raw);
  faderMax[i] = Math.max(faderMax[i], raw);
  faderDistinct[i].add(raw);
  const s = getSequencer();
  if (s.faderCalibrating) {
    calibMin[i] = Math.min(calibMin[i], raw);
    calibMax[i] = Math.max(calibMax[i], raw);
  }
  let value: number;
  const calib = s.faderCalib;
  if (calib && calib.hi[i] > calib.lo[i]) {
    value = remapCcToUnit(raw, calib.lo[i], calib.hi[i]);
  } else {
    value =
      s.faderRangeSetting === "0to1"
        ? Math.max(0, Math.min(1, raw))
        : Math.max(0, Math.min(1, raw / 127));
  }
  // Reverse only the 8 faders (not the master) if down should be quieter.
  if (s.reverseFaders && i !== 8) value = 1 - value;
  return value;
}

/** Clear learned fader stats so the readout re-accumulates from a fresh sweep. */
export function resetFaderCalibration(): void {
  for (let i = 0; i < 9; i++) {
    faderMin[i] = 127;
    faderMax[i] = -1;
    faderDistinct[i].clear();
  }
}

const faderPending = new Array<number | null>(9).fill(null);
const faderTimers: (ReturnType<typeof setTimeout> | null)[] = new Array(9).fill(null);
const faderLastApplied = new Array<number | null>(9).fill(null);

function scheduleFader(i: number, value01: number): void {
  faderPending[i] = value01;
  if (faderTimers[i]) return;
  faderTimers[i] = setTimeout(() => {
    faderTimers[i] = null;
    const v = faderPending[i];
    faderPending[i] = null;
    if (v !== null) applyFader(i, v);
  }, 20);
}

/** Apply a coalesced fader value (master → kit volume; else per fader mode). */
function applyFader(faderIndex: number, value: number): void {
  // Drop repeated identical values — a stream of the same 0/1 would otherwise
  // fire the control many times per physical move ("does the same thing 4-5×").
  if (faderLastApplied[faderIndex] === value) return;
  faderLastApplied[faderIndex] = value;
  const s = getSequencer();
  if (faderIndex === 8) {
    setKitVolume(value);
    return;
  }
  const slot = faderIndex; // 0..7
  // Basic mode: faders are per-drum volume (a simple mixer). Advanced: fader mode.
  const mode = s.advanced ? s.faderMode : "volume";
  switch (mode) {
    case "volume": {
      // In-app per-drum level (no Live dependency) for the active bank.
      const pad = bankSlotPad(s.bank, slot);
      s.setPadLevel(pad, value);
      break;
    }
    case "device":
      // Fader i → device param (skip param 0 = the on/off switch when enabled).
      setDeviceParam(slot + (getSequencer().faderSkipOnOff ? 1 : 0), value);
      break;
    case "send":
      getAbleton().send("/live/track/set/send", [s.targetTrack, slot, value]);
      break;
    case "pan":
      // Track-level panning is a single value; slider 1 drives it (others idle).
      if (slot === 0) getAbleton().send("/live/track/set/panning", [s.targetTrack, value * 2 - 1]);
      break;
  }
}

/** Fader CC (48-55) or master (56) → coalesced per-drum level / device param / kit volume. */
function handleFader(faderIndex: number, ccValue: number): void {
  const value = faderValue01(faderIndex, ccValue);
  scheduleFader(Math.max(0, Math.min(8, faderIndex)), value);
}

/** Toggle the blue-hand device's on/off switch (param 0). */
export function toggleDeviceOnOff(): void {
  const s = getSequencer();
  const next = !s.deviceOn;
  s.setDeviceOn(next);
  const ab = getAbleton().getState();
  const track = s.followBlueHand && ab.selectedTrack !== undefined ? ab.selectedTrack : s.targetTrack;
  const device = s.followBlueHand && ab.selectedDevice !== undefined ? ab.selectedDevice : 0;
  getAbleton().send("/live/device/set/parameter/value", [track, device, 0, next ? 1 : 0]);
}

/**
 * Map a 0-1 fader value to a track-volume value for AbletonOSC. AbletonOSC's
 * `/live/track/set/volume` writes `mixer_device.volume.value = <arg>` straight
 * through, and in Live that parameter's value is in dB (0 dB = unity, -inf =
 * mute). Sending the raw 0-1 therefore only sweeps 0-1 dB and can never mute —
 * so map 0 → fully muted (large negative dB floor) and 1 → 0 dB (unity) with a
 * natural 20·log10 taper (0.5 → -6 dB, 0.1 → -20 dB).
 */
export function volume01ToDb(value01: number): number {
  const v = Math.max(0, Math.min(1, value01));
  if (v <= 0) return -70; // effectively silent (well below any noise floor)
  const db = 20 * Math.log10(v);
  return Math.max(-70, Math.min(6, db));
}

/** Set the drum kit (target track) volume via OSC (0-1 fader → dB). */
export function setKitVolume(value01: number): void {
  getAbleton().send("/live/track/set/volume", [getSequencer().targetTrack, volume01ToDb(value01)]);
}

function updatePortStatus(): void {
  const s = getSequencer();
  s.setPorts(ports.input?.name ?? null, ports.rackOut?.name ?? null, ports.apcOut?.name ?? null);
}

/** MIDI support + every port the browser can see (for the port picker + diagnostics). */
export async function refreshMidiPorts(): Promise<MidiStatus> {
  return getMidiStatus();
}

/**
 * Persist whatever ports are currently attached, resolved to their real NAMES.
 * MIDI port ids are per-session and change on every reload; names are stable,
 * so storing names is what makes picks survive a refresh. Called after every
 * (re)attach so auto-detected ports get pinned too (deterministic next load).
 * Only writes when at least one port resolved, so a MIDI-denied/empty first
 * load can't wipe the user's saved picks.
 */
function persistResolvedPicks(): void {
  if (!ports.input && !ports.apcOut && !ports.rackOut) return;
  useSequencerStore.setState({
    portPicks: {
      input: ports.input?.name ?? undefined,
      apcOut: ports.apcOut?.name ?? undefined,
      rackOut: ports.rackOut?.name ?? undefined,
    },
  });
}

/** Re-attach MIDI using explicit port picks (id or name). Empty fields = auto-detect. */
export async function applyPortPicks(picks: PortPicks): Promise<void> {
  ports = await attachApc(onMidi, {
    pickInput: picks.input,
    pickApcOut: picks.apcOut,
    pickRackOut: picks.rackOut,
  });
  persistResolvedPicks();
  updatePortStatus();
  // The port may have changed — don't trust the LED diff cache, repaint all.
  lastLed.clear();
  sendPadMode(ports.apcOut, DEFAULT_PAD_MODE);
  renderLeds();
}

/**
 * Diagnostic: light all 64 pads red for half a second, then restore the real
 * state. Confirms the app → APC LED path works end-to-end without needing to
 * touch the hardware. Returns a human-readable report for the UI.
 */
export function testLeds(): string {
  if (!ports.apcOut) {
    const msg = "⚠️ No APC LED output bound — allow MIDI, pick the APC port, then retry.";
    console.warn("[hub] testLeds: " + msg);
    return msg;
  }
  const name = ports.apcOut.name ?? "(unnamed)";
  for (let note = 0; note < 64; note++) {
    sendLed(ports.apcOut, 6, note, 5); // red on LED channel 6 (FULL_BRIGHTNESS)
  }
  setTimeout(() => renderLeds(), 500);
  return `Sent 64 red LEDs on channel 6 (full) → ${name}`;
}

/**
 * Diagnostic: flash the bottom-left pad (note 0) in red on several LED
 * channels in sequence, then restore. The APC mini mk2 lights its grid on
 * channel 6 (full), but this reveals if this unit/firmware or an alternate
 * route responds on channel 0, 1, 10 or 14 instead — and whether ANY bytes
 * are reaching the device at all.
 */
const PROBE_CHANNELS = [0, 1, 6, 10, 14]; // ch0, half, FULL, pulse, blink

export function probeLeds(): string {
  if (!ports.apcOut) {
    const msg = "⚠️ No APC LED output bound — allow MIDI, pick the APC port, then retry.";
    console.warn("[hub] probeLeds: " + msg);
    return msg;
  }
  const name = ports.apcOut.name ?? "(unnamed)";
  sendPadMode(ports.apcOut, DEFAULT_PAD_MODE);
  PROBE_CHANNELS.forEach((ch, i) => {
    setTimeout(() => sendLed(ports.apcOut, 6, 0, 5, ch), i * 450);
  });
  setTimeout(() => renderLeds(), PROBE_CHANNELS.length * 450 + 200);
  return `Probing pad 0 on channels ${PROBE_CHANNELS.join(" → ")} (watch the bottom-left pad) → ${name}`;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function start(): Promise<void> {
  if (started) return;
  started = true;
  cleanupListeners.length = 0;

  // Re-apply any saved port picks on (re)start so manual selections survive reloads;
  // otherwise auto-detect can't find the APC behind an iConnect interface.
  const picks = useSequencerStore.getState().portPicks;
  ports = await attachApc(onMidi, {
    pickInput: picks.input,
    pickApcOut: picks.apcOut,
    pickRackOut: picks.rackOut,
  });
  persistResolvedPicks();
  updatePortStatus();

  // Fresh attach — repaint every LED so none are skipped by the diff cache.
  lastLed.clear();

  // Switch the grid to a note pad mode so pads send notes we can read.
  sendPadMode(ports.apcOut, DEFAULT_PAD_MODE);

  // Re-render LEDs whenever the editable state changes (edits without a tick).
  unsubscribeStore = useSequencerStore.subscribe((state, prev) => {
    if (
      state.drum !== prev.drum ||
      state.selectedPad !== prev.selectedPad ||
      state.fx !== prev.fx ||
      state.trackFx !== prev.trackFx ||
      state.shiftHeld !== prev.shiftHeld ||
      state.playing !== prev.playing ||
      state.step !== prev.step ||
      state.bank !== prev.bank ||
      state.faderMode !== prev.faderMode ||
      state.liveMode !== prev.liveMode
    ) {
      renderLeds();
    }
  });

  // Keyboard Shift = the controller's shift button (also handy in simulator mode).
  const onShiftDown = (e: KeyboardEvent) => {
    if (e.key === "Shift") getSequencer().setShift(true);
  };
  const onShiftUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") getSequencer().setShift(false);
  };
  window.addEventListener("keydown", onShiftDown);
  window.addEventListener("keyup", onShiftUp);
  cleanupListeners.push(() => {
    window.removeEventListener("keydown", onShiftDown);
    window.removeEventListener("keyup", onShiftUp);
  });

  // AbletonOSC (beat/play-state/telemetry) via the osc-bridge WebSocket.
  const ableton = getAbleton();
  ableton.connect();
  ableton.onChange((state) => {
    const s = getSequencer();
    s.setAbleton(state.connected, state.isPlaying, state.beat);
    s.setBlueHand(state.selectedTrack ?? null, state.selectedDevice ?? null);
    if (s.clockSource === "ableton") {
      if (state.isPlaying) {
        if (!ensureClock().playing) ensureClock().start(s.bpm, s.resolution, 0);
        if (state.beat !== null) ensureClock().syncToBeat(state.beat, s.resolution);
      } else {
        ensureClock().stop();
        s.setPlaying(false);
      }
    }
    renderLeds();
  });

  // Live MIDI input rate (updated ~1/s for the diagnostics card).
  const rateTimer = setInterval(() => {
    const rate = midiInCount - midiInLastTotal;
    midiInLastTotal = midiInCount;
    getSequencer().setMidiInRate(rate);
  }, 1000);
  cleanupListeners.push(() => clearInterval(rateTimer));

  renderLeds();
}

export function stop(): void {
  started = false;
  ensureClock().stop();
  unsubscribeStore?.();
  unsubscribeStore = null;
  for (const fn of cleanupListeners) fn();
  cleanupListeners.length = 0;
  getAbleton().disconnect();
}
