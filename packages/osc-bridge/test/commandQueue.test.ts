import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  claimCommandFile,
  claimOldestCommand,
  createCommandWaker,
  listQueuedCommands,
  writeCommandFile,
} from "../src/commandQueue.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "osc-queue-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeCommandFile / listQueuedCommands", () => {
  it("writes a json file and lists it oldest first", () => {
    writeCommandFile(dir, { action: "setTempo", bpm: 140 });
    writeCommandFile(dir, { action: "applyBlueprint", blueprintId: "b1" });
    const files = listQueuedCommands(dir);
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.endsWith(".json"))).toBe(true);
    expect(files).toEqual([...files].sort());
  });

  it("creates the directory when it does not exist yet", () => {
    const fresh = path.join(dir, "nested", "queue");
    writeCommandFile(fresh, { action: "setTempo", bpm: 90 });
    expect(listQueuedCommands(fresh)).toHaveLength(1);
  });

  it("lists nothing for a missing directory", () => {
    expect(listQueuedCommands(path.join(dir, "absent"))).toEqual([]);
  });
});

describe("claimCommandFile", () => {
  it("returns the payload and removes the file", () => {
    const file = writeCommandFile(dir, { action: "setTempo", bpm: 128 });
    expect(claimCommandFile(dir, file)).toEqual({ action: "setTempo", bpm: 128 });
    expect(listQueuedCommands(dir)).toEqual([]);
  });

  it("lets exactly one consumer win, so a command never runs twice", () => {
    const file = writeCommandFile(dir, { action: "setTempo", bpm: 128 });
    expect(claimCommandFile(dir, file)).not.toBeNull();
    expect(claimCommandFile(dir, file)).toBeNull();
  });

  it("rejects a payload with no action, without wedging the queue", () => {
    fs.writeFileSync(path.join(dir, "command_1_bad.json"), JSON.stringify({ bpm: 100 }));
    fs.writeFileSync(path.join(dir, "command_2_good.json"), JSON.stringify({ action: "setTempo", bpm: 100 }));
    expect(claimOldestCommand(dir)).toEqual({ action: "setTempo", bpm: 100 });
  });

  it("discards malformed json instead of retrying it forever", () => {
    fs.writeFileSync(path.join(dir, "command_1_broken.json"), "{not json");
    expect(claimOldestCommand(dir)).toBeNull();
    expect(listQueuedCommands(dir)).toEqual([]);
    expect(fs.readdirSync(path.join(dir, ".done"))).toEqual([]);
  });
});

describe("claimOldestCommand", () => {
  it("drains in name order and then reports empty", () => {
    writeCommandFile(dir, { action: "setTempo", bpm: 1 });
    writeCommandFile(dir, { action: "setTempo", bpm: 2 });
    expect(claimOldestCommand(dir)?.bpm).toBe(1);
    expect(claimOldestCommand(dir)?.bpm).toBe(2);
    expect(claimOldestCommand(dir)).toBeNull();
  });

  it("returns null for an empty or missing queue", () => {
    expect(claimOldestCommand(dir)).toBeNull();
    expect(claimOldestCommand(path.join(dir, "absent"))).toBeNull();
  });
});

describe("createCommandWaker", () => {
  it("resolves a waiter as soon as it is notified", async () => {
    const waker = createCommandWaker();
    const waited = waker.wait(5_000);
    waker.notify();
    await expect(waited).resolves.toBeUndefined();
  });

  it("resolves on the timeout when nothing arrives", async () => {
    vi.useFakeTimers();
    const waker = createCommandWaker();
    const waited = waker.wait(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(waited).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it("wakes every waiter, not just the first", async () => {
    const waker = createCommandWaker();
    const both = Promise.all([waker.wait(5_000), waker.wait(5_000)]);
    waker.notify();
    await expect(both).resolves.toEqual([undefined, undefined]);
  });

  it("a notified waiter that already timed out does not throw", async () => {
    vi.useFakeTimers();
    const waker = createCommandWaker();
    const waited = waker.wait(50);
    await vi.advanceTimersByTimeAsync(50);
    await waited;
    expect(() => waker.notify()).not.toThrow();
    vi.useRealTimers();
  });
});
