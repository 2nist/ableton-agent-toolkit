/**
 * Wiring layer: Web MIDI <-> store <-> LED feedback.
 *
 * Follows apps/apc-sequencer's hub.ts pattern — a small `lastLed` diff cache
 * so re-renders only send bytes for LEDs that actually changed, driven by a
 * store subscription that only fires on the fields that matter (here, just
 * `activeBank`). LED feedback is deliberately minimal for v1: which bank is
 * active, shown on the bank-select track buttons.
 */
import { attachMk1, sendLed } from "./midi";
import { getOsc } from "./osc";
import { BANKS } from "./router";
import { useMk1Store } from "./store";

const lastLed = new Map<number, number>(); // note -> color velocity

function renderLeds(): void {
  const { ports, physicalMap, activeBank } = useMk1Store.getState();
  if (!ports.apcOut) return;
  for (let i = 0; i < BANKS.length; i++) {
    const note = physicalMap.trackButtons[i];
    if (note === undefined) continue;
    const color = BANKS[i] === activeBank ? 1 /* BiLedColors: green */ : 0 /* off */;
    if (lastLed.get(note) === color) continue;
    sendLed(ports.apcOut, 0, note, color);
    lastLed.set(note, color);
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * (Re-)attach MIDI ports using the store's current port picks, start LED
 * feedback, and connect to the osc-bridge relay (packages/osc-bridge) that
 * talks to AbletonOSC — clip edits go through that connection, not MIDI.
 */
export async function start(): Promise<void> {
  const { portPicks, setPorts } = useMk1Store.getState();
  const ports = await attachMk1((bytes) => useMk1Store.getState().handleIncoming(bytes), {
    pickInput: portPicks.input,
    pickApcOut: portPicks.apcOut,
  });
  setPorts(ports);
  getOsc().connect();

  lastLed.clear(); // can't trust the diff cache across a port reattach
  renderLeds();

  unsubscribe?.();
  unsubscribe = useMk1Store.subscribe((state, prev) => {
    if (state.activeBank !== prev.activeBank || state.ports !== prev.ports) renderLeds();
  });
}

export function stop(): void {
  unsubscribe?.();
  unsubscribe = null;
  getOsc().disconnect();
}

/** Re-run port attachment after the user changes a port picker dropdown. */
export async function applyPortPicks(): Promise<void> {
  await start();
}
