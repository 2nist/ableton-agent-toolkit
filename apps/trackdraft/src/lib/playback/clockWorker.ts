/**
 * Creates a Web Worker whose sole job is to fire callbacks at precise
 * wall-clock intervals, unblocked by main-thread activity (React renders,
 * GC, DevTools profiling).
 *
 * The worker is constructed from an inline Blob — no separate .js file
 * needed, no Worker module loading complications. It polls at ~250Hz and
 * posts `{ type: "fire", id }` messages back to the main thread.
 *
 * `eventCallbacks` is the map of pending events; the caller populates it
 * and removes consumed entries.  `isPlaying` is a boolean the caller
 * toggles so the worker callback can skip events fired after stop.
 */

const WORKER_BLOB = new Blob(
  [
    `
let events = [];
let timerId = null;
const PRECISION_MS = 4;

function tick() {
  const now = performance.now();
  const ready = events.filter((e) => e.fireAtMs - now <= PRECISION_MS);
  for (const e of ready) postMessage({ type: "fire", id: e.id });
  events = events.filter((e) => e.fireAtMs - now > PRECISION_MS);
  if (events.length === 0 && timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

self.onmessage = function (msg) {
  if (msg.data.type === "schedule") {
    events = msg.data.events.slice();
    if (timerId === null) timerId = setInterval(tick, PRECISION_MS);
  }
};
`,
  ],
  { type: "application/javascript" },
);

export function createTimerWorker(): Worker {
  return new Worker(URL.createObjectURL(WORKER_BLOB));
}