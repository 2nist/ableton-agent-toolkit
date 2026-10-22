/**
 * How the extension learns about commands from the TrackDraft app.
 *
 * Two transports, because extensions run inside whatever Live the user has:
 *
 *  - **Long-poll** (`GET /api/command/next`) — sub-100 ms latency. Only
 *    possible where Live provides `fetch` and `AbortSignal`, which arrived
 *    in 12.4.15b5 (the SDK now also exposes `Headers`, `Request`, `Response`,
 *    `FormData` and `performance`).
 *  - **Directory scan** — the original path: the bridge writes JSON files to
 *    the extension's storage directory and this side sweeps them every 2 s.
 *    Still required on older Live builds, and still the durable queue on new
 *    ones, so it also serves as the fallback when the bridge is unreachable.
 *
 * Neither transport needs to know which one is in play: the *bridge* claims a
 * queued file by renaming it, so a command can only ever be taken once, no
 * matter how many consumers are looking.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Default bridge REST port (osc-bridge's TELEMETRY_PORT). */
export const DEFAULT_BRIDGE_PORT = 5200;
/** How long one long-poll parks, in ms. Shorter than the bridge's 30 s cap so
 *  the request always ends on this side rather than timing out server-side. */
export const DEFAULT_POLL_WAIT_MS = 20_000;

/** The envelope the app queues; `action` is mandatory. */
export interface QueuedCommand {
  action: string;
  blueprintId?: string;
  bpm?: number;
}

/**
 * Which optional globals this extension context actually provides.
 *
 * This is the runtime probe for the 12.4.15b5 additions. `fetch` and
 * `AbortSignal` are the two the HTTP transport needs; the rest are reported
 * because they are free to check and tell us what else is safe to reach for
 * (`WebSocket` is deliberately included: it is **not** in the documented
 * 12.4.15b5 list, so whether it exists is a question for the runtime, not the
 * release notes).
 */
export interface RuntimeGlobals {
  fetch: boolean;
  abortSignal: boolean;
  abortController: boolean;
  headers: boolean;
  request: boolean;
  response: boolean;
  formData: boolean;
  performance: boolean;
  webSocket: boolean;
}

/** Read the ambient globals. Takes the global object so it can be tested. */
export function describeRuntime(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): RuntimeGlobals {
  const abortSignal = scope.AbortSignal as { timeout?: unknown } | undefined;
  return {
    fetch: typeof scope.fetch === "function",
    // `AbortSignal.timeout` is what the request deadline uses, so its presence
    // (not merely AbortSignal's) is what makes the transport safe to use.
    abortSignal: typeof abortSignal?.timeout === "function",
    abortController: typeof scope.AbortController === "function",
    headers: typeof scope.Headers === "function",
    request: typeof scope.Request === "function",
    response: typeof scope.Response === "function",
    formData: typeof scope.FormData === "function",
    performance: typeof (scope.performance as { now?: unknown } | undefined)?.now === "function",
    webSocket: typeof scope.WebSocket === "function",
  };
}

/** Whether the low-latency transport can be used at all. */
export function canLongPoll(globals: RuntimeGlobals): boolean {
  return globals.fetch && globals.abortSignal;
}

/** The long-poll URL for a bridge port. */
export function commandUrl(port = DEFAULT_BRIDGE_PORT, waitMs = DEFAULT_POLL_WAIT_MS): string {
  return `http://127.0.0.1:${port}/api/command/next?wait=${Math.max(0, Math.round(waitMs))}`;
}

/**
 * Pick the command out of a `next` response body. Anything unexpected
 * (a bridge too old to have the route, a proxy error page, a truncated body)
 * reads as "no command", which the caller treats as a reason to fall back
 * rather than a reason to fail.
 */
export function parseNextResponse(body: unknown): QueuedCommand | null {
  if (!body || typeof body !== "object") return null;
  const command = (body as { command?: unknown }).command;
  if (!command || typeof command !== "object") return null;
  const action = (command as { action?: unknown }).action;
  if (typeof action !== "string" || action === "") return null;
  const payload = command as QueuedCommand;
  return {
    action,
    blueprintId: typeof payload.blueprintId === "string" ? payload.blueprintId : undefined,
    bpm: typeof payload.bpm === "number" ? payload.bpm : undefined,
  };
}

/** Files left for a scanning extension, oldest first. */
export function listQueuedCommandFiles(dir: string | undefined): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort();
}

/**
 * Claim one queued file by renaming it out of the queue first — the same
 * exactly-once rule the bridge applies, so a Live running two transports (or
 * two Live instances) cannot execute a command twice. Returns `null` when the
 * file is gone or unreadable.
 */
export function claimQueuedCommandFile(
  dir: string,
  file: string,
): QueuedCommand | null {
  const from = path.join(dir, file);
  const to = `${from}.taken`;
  try {
    fs.renameSync(from, to);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(to, "utf-8")) as QueuedCommand;
    if (!parsed || typeof parsed.action !== "string" || parsed.action === "") return null;
    return parsed;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(to);
    } catch {
      /* already gone — the command was still delivered once */
    }
  }
}
