/**
 * App state + the glue between incoming MIDI and real clip edits.
 *
 * `handleIncoming` is the single entry point for real hardware input (via
 * hub.ts) and effectively also the on-screen fallback controls (which call
 * the same `press*`/`setShiftHeld` actions directly, bypassing MIDI byte
 * parsing) — both paths end up at `applyPhysicalEvent`, which is the only
 * place that decides what happens next.
 *
 * Faders no longer send anything on every tick — they're local parameter
 * knobs for the active bank's transform (transpose amount, quantize
 * strength, etc.). Scene buttons and grid pads are triggers: pressing one
 * fires that bank's real clip edit over AbletonOSC (see clipEdit.ts),
 * using the bank's current fader values as parameters.
 */
import { create } from "zustand";
import {
  applyBankTransform,
  duplicateLoop,
  getSelectedClipWithNotes,
  type ApplyResult,
} from "./clipEdit";
import {
  applyOverrides,
  captureLearn,
  clearOverrides,
  learnTargetLabel,
  loadOverrides,
  saveOverrides,
  type LearnTarget,
  type PhysicalMapOverrides,
} from "./learn";
import type { MidiPorts } from "./midi";
import { parseMidiMessage } from "./midi";
import { getOsc } from "./osc";
import {
  defaultPhysicalMap,
  resolvePhysical,
  type BankName,
  type PhysicalEvent,
  type PhysicalMap,
} from "./router";
import { selectTrack, templateTrackName } from "./trackSync";

export interface LogLine {
  id: number;
  text: string;
}

/**
 * The global (shift+scene) overlay row: direct OSC transport/navigation
 * calls, verified against AbletonOSC's real Song API (its README's method
 * table) — chosen from methods that don't require reading state back first
 * (unlike e.g. a play/stop toggle, which would need to track is_playing).
 */
export const GLOBAL_ACTIONS: { label: string; address: string }[] = [
  { label: "Play", address: "/live/song/start_playing" },
  { label: "Stop", address: "/live/song/stop_playing" },
  { label: "Record", address: "/live/song/trigger_session_record" },
  { label: "Stop All Clips", address: "/live/song/stop_all_clips" },
  { label: "Prev Marker", address: "/live/song/jump_to_prev_cue" },
  { label: "Next Marker", address: "/live/song/jump_to_next_cue" },
  { label: "Undo", address: "/live/song/undo" },
  { label: "Redo", address: "/live/song/redo" },
];

interface Mk1State {
  ports: MidiPorts;
  portPicks: { input?: string; apcOut?: string };
  overrides: PhysicalMapOverrides;
  physicalMap: PhysicalMap;
  activeBank: BankName;
  /** Which template track (0-7, 1:1 with the real Live Set's track order) is under fader control. */
  activeTrack: number;
  shiftHeld: boolean;
  /** Last known raw (0-127) value per fader index — doubles as the active bank's transform parameters. */
  faderValues: number[];
  learnTarget: LearnTarget | null;
  log: LogLine[];

  setPorts: (ports: MidiPorts) => void;
  setPortPick: (kind: "input" | "apcOut", value: string | undefined) => void;
  handleIncoming: (bytes: Uint8Array) => void;
  startLearn: (target: LearnTarget) => void;
  cancelLearn: () => void;
  resetOverrides: () => void;
  /** On-screen fallback controls, for testing without hardware attached. */
  pressFader: (index: number, value: number) => void;
  pressSceneButton: (index: number, pressed: boolean) => void;
  pressTrackButton: (index: number, pressed: boolean) => void;
  pressGridPad: (index: number, pressed: boolean) => void;
  setShiftHeld: (held: boolean) => void;
}

let logId = 0;
function pushLog(log: LogLine[], text: string): LogLine[] {
  const next = [...log, { id: logId++, text }];
  return next.length > 50 ? next.slice(next.length - 50) : next;
}

/**
 * Port picks weren't persisted at all — every page reload reset them to
 * "(auto)", which then depended on name-matching heuristics to reconnect.
 * MIDI port ids are stable across sessions on the same machine, so
 * persisting them (like learn.ts already does for physical-map overrides)
 * fixes that.
 */
const PORT_PICKS_STORAGE_KEY = "apc-mk1-utility:port-picks";
type PortPicks = { input?: string; apcOut?: string };

function loadPortPicks(): PortPicks {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PORT_PICKS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PortPicks) : {};
  } catch {
    return {};
  }
}

function savePortPicks(picks: PortPicks): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PORT_PICKS_STORAGE_KEY, JSON.stringify(picks));
  } catch {
    // port persistence is a convenience, not critical — ignore storage failures
  }
}

/**
 * A physical fader can emit CC bursts far faster than React (or a person)
 * needs to see. This mirrors apps/apc-sequencer's hub.ts `scheduleFader`
 * pattern: coalesce rapid ticks per fader into one applied update per
 * ~20ms, and drop a tick entirely if its value matches what's already
 * applied. There's no outgoing MIDI to worry about anymore — this is
 * purely to keep the on-screen readout smooth under a fast fader sweep.
 */
const FADER_THROTTLE_MS = 20;
const faderTimers: (ReturnType<typeof setTimeout> | null)[] = new Array(8).fill(null);
const pendingFaderValue: (number | null)[] = new Array(8).fill(null);
const lastAppliedFaderValue: (number | null)[] = new Array(8).fill(null);

function applyFaderNow(index: number, value: number, set: SetFn): void {
  set((s) => {
    const faderValues = [...s.faderValues];
    faderValues[index] = value;
    return { faderValues };
  });
}

function scheduleFader(index: number, value: number, set: SetFn): void {
  pendingFaderValue[index] = value;
  if (faderTimers[index]) return; // a flush is already scheduled for this fader
  faderTimers[index] = setTimeout(() => {
    faderTimers[index] = null;
    const v = pendingFaderValue[index];
    pendingFaderValue[index] = null;
    if (v === null || v === lastAppliedFaderValue[index]) return;
    lastAppliedFaderValue[index] = v;
    applyFaderNow(index, v, set);
  }, FADER_THROTTLE_MS);
}

type TriggerSource = "Scene" | "Grid";

function describeResult(source: TriggerSource, bank: BankName, result: ApplyResult): string {
  if (result.ok) return `${source}: ${bank} applied (${result.noteCount} notes)`;
  return `${source}: ${bank} failed — ${result.error}`;
}

/**
 * Fire the active bank's real clip edit and log the outcome. `source`
 * exists purely so the log can distinguish a scene-button trigger from a
 * grid-pad trigger — they call this identically otherwise, and without a
 * label there was no way to tell which one produced a given log line.
 */
async function triggerBank(
  source: TriggerSource,
  bank: BankName,
  faderValues: number[],
  set: SetFn,
): Promise<void> {
  const osc = getOsc();

  if (bank === "clip_tools") {
    // Clip Tools isn't a fader-driven transform — every trigger duplicates
    // the clip's loop. (Its second action, clear-all-notes, was previously
    // reached via a scene-button special case; that path no longer exists
    // now that scene buttons select tracks instead — clip_tools as a whole
    // is vestigial pending the Macro-dispatch rework, same as this entire
    // bank system.)
    const ref = await getSelectedClipWithNotes(osc).catch(() => null);
    if (!ref) {
      set((s) => ({ log: pushLog(s.log, `${source}: clip_tools no clip in the selected slot`) }));
      return;
    }
    duplicateLoop(osc, ref);
    set((s) => ({ log: pushLog(s.log, `${source}: clip_tools duplicate_loop sent`) }));
    return;
  }

  const result = await applyBankTransform(osc, bank, faderValues);
  set((s) => ({ log: pushLog(s.log, describeResult(source, bank, result)) }));
}

/**
 * Selects one of the 8 template tracks and syncs Live's own screen to it.
 * Lives on the scene buttons (the physical vertical column on the mk1) to
 * match Arrangement View's own orientation — tracks stack vertically there,
 * so vertical hardware buttons are the natural fit for track selection,
 * not the horizontal track-button row (which drove this in an earlier,
 * Session-View-shaped design).
 */
function dispatchTrackSelect(trackIndex: number, set: SetFn): void {
  const name = templateTrackName(trackIndex);
  set((s) => ({ activeTrack: trackIndex, log: pushLog(s.log, `Track -> ${name}`) }));
  selectTrack(getOsc(), trackIndex).then(
    () => set((s) => ({ log: pushLog(s.log, `Selection synced -> ${name}`) })),
    (err: unknown) =>
      set((s) => ({
        log: pushLog(s.log, `Selection sync failed -> ${name}: ${err instanceof Error ? err.message : String(err)}`),
      })),
  );
}

function applyPhysicalEvent(event: PhysicalEvent, get: () => Mk1State, set: SetFn): void {
  const state = get();
  switch (event.kind) {
    case "shift":
      set((s) => ({
        shiftHeld: event.pressed,
        log: pushLog(s.log, `Shift ${event.pressed ? "down" : "up"}`),
      }));
      return;

    case "bankSelect": {
      // Track buttons (the horizontal row) are reserved pending a fresh
      // pass — track selection moved to the scene buttons (see
      // dispatchTrackSelect) to match Arrangement View's vertical layout.
      // Recognized-but-reserved, logged so a press is distinguishable from
      // "not detected at all", same pattern used elsewhere for reserved
      // controls.
      if (event.pressed) {
        set((s) => ({ log: pushLog(s.log, `Track Button ${event.index + 1} (reserved, no action)`) }));
      }
      return;
    }

    case "fader":
      scheduleFader(event.index, event.value, set);
      return;

    case "sceneButton": {
      if (!event.pressed) return;
      if (state.shiftHeld) {
        const action = GLOBAL_ACTIONS[event.index];
        if (!action) return;
        getOsc().send(action.address, []);
        set((s) => ({ log: pushLog(s.log, `${action.label} -> ${action.address}`) }));
        return;
      }
      dispatchTrackSelect(event.index, set);
      return;
    }

    case "gridPad": {
      if (!event.pressed) return;
      void triggerBank("Grid", state.activeBank, state.faderValues, set);
      return;
    }
  }
}

type SetFn = (partial: Partial<Mk1State> | ((s: Mk1State) => Partial<Mk1State>)) => void;

const initialOverrides = loadOverrides();

export const useMk1Store = create<Mk1State>((set, get) => ({
  ports: { input: null, apcOut: null },
  portPicks: loadPortPicks(),
  overrides: initialOverrides,
  physicalMap: applyOverrides(defaultPhysicalMap(), initialOverrides),
  activeBank: "pitch",
  activeTrack: 0,
  shiftHeld: false,
  faderValues: new Array(8).fill(64), // 64 = "centered" default for every bank's params
  learnTarget: null,
  log: [],

  setPorts: (ports) => set({ ports }),
  setPortPick: (kind, value) =>
    set((s) => {
      const portPicks = { ...s.portPicks, [kind]: value };
      savePortPicks(portPicks);
      return { portPicks };
    }),

  handleIncoming: (bytes) => {
    const msg = parseMidiMessage(bytes);
    if (!msg) return;
    const state = get();

    if (state.learnTarget) {
      const target = state.learnTarget;
      const patch = captureLearn(target, msg, state.overrides);
      if (patch) {
        saveOverrides(patch);
        const physicalMap = applyOverrides(defaultPhysicalMap(), patch);
        set((s) => ({
          overrides: patch,
          physicalMap,
          learnTarget: null,
          log: pushLog(s.log, `Learned ${learnTargetLabel(target)} -> ${msg.messageType} ${msg.number}`),
        }));
      }
      return;
    }

    const event = resolvePhysical(msg, state.physicalMap);
    if (!event) {
      // Surfaced so "nothing happened" is distinguishable from "arrived but
      // didn't match any known control" — e.g. a control whose real note/CC
      // differs from the sourced default. Skip note-off (value 0) noise so
      // a single press doesn't produce two lines.
      if (msg.messageType !== "note" || msg.value > 0) {
        set((s) => ({
          log: pushLog(
            s.log,
            `Unrecognized ${msg.messageType} ${msg.number} (value ${msg.value}, ch ${msg.channel + 1})`,
          ),
        }));
      }
      return;
    }
    applyPhysicalEvent(event, get, set);
  },

  startLearn: (target) => set({ learnTarget: target }),
  cancelLearn: () => set({ learnTarget: null }),
  resetOverrides: () => {
    clearOverrides();
    set({ overrides: {}, physicalMap: defaultPhysicalMap() });
  },

  pressFader: (index, value) => applyPhysicalEvent({ kind: "fader", index, value }, get, set),
  pressSceneButton: (index, pressed) =>
    applyPhysicalEvent({ kind: "sceneButton", index, pressed }, get, set),
  pressTrackButton: (index, pressed) =>
    applyPhysicalEvent({ kind: "bankSelect", index, pressed }, get, set),
  pressGridPad: (index, pressed) => applyPhysicalEvent({ kind: "gridPad", index, pressed }, get, set),
  setShiftHeld: (held) => applyPhysicalEvent({ kind: "shift", pressed: held }, get, set),
}));
