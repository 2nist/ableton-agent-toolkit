/**
 * The command queue that carries browser actions ("set tempo", "apply this
 * blueprint") into Ableton.
 *
 * It is a **directory of JSON files**, deliberately: the extension that
 * consumes it runs inside Live and, until Live 12.4.15b5, had no network
 * globals — a folder both processes can reach was the only shared channel.
 *
 * With `fetch` now available to extensions, a second consumer exists: an
 * extension can long-poll `GET /api/command/next` and receive a command in
 * milliseconds instead of waiting for its next 2-second directory scan. Both
 * consumers read the same files, so **claiming is a rename** — atomic on one
 * filesystem — which guarantees a command is executed exactly once even when
 * an old (file-polling) extension and a new (HTTP) one are running against
 * the same bridge.
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** The envelope the extension understands. `action` is mandatory; everything
 *  else depends on the action. */
export interface QueuedCommand {
  action: string;
  blueprintId?: string;
  bpm?: number;
}

/** Files the bridge has finished with (claimed or malformed) are renamed with
 *  this suffix so they are never picked up twice. */
const DEAD_SUFFIX = ".done";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Queue files, oldest first. The name carries a timestamp *and a sequence*,
 *  and the sweep is a plain lexicographic sort, so ordering survives a bridge
 *  restart and two commands enqueued in the same millisecond still run in the
 *  order they were written. */
export function listQueuedCommands(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

/** Monotonic sub-millisecond counter.
 *
 *  `Date.now()` alone is not enough to order a queue: two commands written in
 *  the same millisecond used to sort by their random suffix, so a "set tempo"
 *  followed immediately by "apply blueprint" could be claimed in reverse — and
 *  the queue's whole contract is that the oldest command runs first. Resetting
 *  the counter whenever the clock ticks keeps the names short and readable. */
let lastStamp = 0;
let seqInStamp = 0;

function nextStamp(now: number): string {
  if (now === lastStamp) {
    seqInStamp += 1;
  } else {
    lastStamp = now;
    seqInStamp = 0;
  }
  return `${now}_${String(seqInStamp).padStart(4, "0")}`;
}

/** Write one command and return its filename. */
export function writeCommandFile(dir: string, payload: QueuedCommand): string {
  ensureDir(dir);
  const filename = `command_${nextStamp(Date.now())}_${randomBytes(3).toString("hex")}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload, null, 2), "utf-8");
  return filename;
}

/**
 * Take ownership of one queued file and return its payload, or `null` when
 * another consumer claimed it first (or it was malformed).
 *
 * `rename` is the claim: exactly one caller can win the rename on one
 * filesystem, so a file-polling extension and the HTTP endpoint can run side
 * by side without a command executing twice. A malformed payload is moved
 * aside too, so it cannot wedge the queue by being retried forever.
 */
export function claimCommandFile(
  dir: string,
  file: string,
  deadDir = path.join(dir, DEAD_SUFFIX),
): QueuedCommand | null {
  const from = path.join(dir, file);
  const to = path.join(deadDir, file);
  try {
    fs.mkdirSync(deadDir, { recursive: true });
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
      /* another sweep already removed it — the command was still delivered once */
    }
  }
}

/** Claim the oldest queued command, or `null` when the queue is empty. */
export function claimOldestCommand(dir: string): QueuedCommand | null {
  for (const file of listQueuedCommands(dir)) {
    const command = claimCommandFile(dir, file);
    if (command) return command;
  }
  return null;
}

export interface CommandWaker {
  /** Wake every caller blocked in `wait`. */
  notify: () => void;
  /** Resolve when notified or after `ms`, whichever comes first. */
  wait: (ms: number) => Promise<void>;
}

/**
 * Long-poll plumbing: a `GET /api/command/next` request parks here until a
 * `POST` lands or its timeout expires. One waker per bridge process — the
 * queue itself stays on disk so a restart loses nothing.
 */
export function createCommandWaker(): CommandWaker {
  const waiters = new Set<() => void>();
  return {
    notify() {
      for (const resolve of waiters) resolve();
      waiters.clear();
    },
    wait(ms: number) {
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        waiters.add(done);
      });
    },
  };
}
