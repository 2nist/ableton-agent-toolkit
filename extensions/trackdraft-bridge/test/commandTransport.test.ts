import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  canLongPoll,
  claimQueuedCommandFile,
  commandUrl,
  describeRuntime,
  listQueuedCommandFiles,
  parseNextResponse,
} from "../src/commandTransport.js";

describe("describeRuntime", () => {
  const complete = {
    fetch: () => null,
    AbortSignal: { timeout: () => null },
    AbortController: function AbortController() {},
    Headers: function Headers() {},
    Request: function Request() {},
    Response: function Response() {},
    FormData: function FormData() {},
    performance: { now: () => 0 },
    WebSocket: function WebSocket() {},
  };

  it("reports every 12.4.15b5 global when the context provides them", () => {
    expect(describeRuntime(complete)).toEqual({
      fetch: true,
      abortSignal: true,
      abortController: true,
      headers: true,
      request: true,
      response: true,
      formData: true,
      performance: true,
      webSocket: true,
    });
  });

  it("reports a pre-12.4.15b5 context as having none of them", () => {
    expect(describeRuntime({})).toEqual({
      fetch: false,
      abortSignal: false,
      abortController: false,
      headers: false,
      request: false,
      response: false,
      formData: false,
      performance: false,
      webSocket: false,
    });
  });

  it("treats AbortSignal without timeout() as unusable for the request deadline", () => {
    const globals = describeRuntime({ ...complete, AbortSignal: function AbortSignal() {} });
    expect(globals.abortSignal).toBe(false);
  });
});

describe("canLongPoll", () => {
  const base = describeRuntime({ fetch: () => null, AbortSignal: { timeout: () => null } });

  it("is true only with both fetch and AbortSignal.timeout", () => {
    expect(canLongPoll(base)).toBe(true);
    expect(canLongPoll({ ...base, fetch: false })).toBe(false);
    expect(canLongPoll({ ...base, abortSignal: false })).toBe(false);
  });
});

describe("commandUrl", () => {
  it("targets loopback and carries the wait", () => {
    expect(commandUrl()).toBe("http://127.0.0.1:5200/api/command/next?wait=20000");
    expect(commandUrl(5201, 500)).toContain(":5201/api/command/next?wait=500");
  });

  it("never emits a negative or fractional wait", () => {
    expect(commandUrl(5200, -5)).toMatch(/wait=0$/);
    expect(commandUrl(5200, 12.7)).toMatch(/wait=13$/);
  });
});

describe("parseNextResponse", () => {
  it("reads a command envelope", () => {
    expect(parseNextResponse({ command: { action: "setTempo", bpm: 140 } })).toEqual({
      action: "setTempo",
      bpm: 140,
    });
  });

  it("keeps only the known fields", () => {
    const parsed = parseNextResponse({
      command: { action: "applyBlueprint", blueprintId: "b1", bpm: "not a number", extra: 1 },
    });
    expect(parsed).toEqual({ action: "applyBlueprint", blueprintId: "b1", bpm: undefined });
  });

  it("reads an empty queue as no command", () => {
    expect(parseNextResponse({ command: null })).toBeNull();
  });

  it("survives an old bridge (404 body) and junk bodies", () => {
    for (const body of [undefined, null, "not an object", 42, {}, { command: {} }, { command: { action: "" } }]) {
      expect(parseNextResponse(body)).toBeNull();
    }
  });
});

describe("file transport", () => {
  let dir: string;
  const write = (name: string, payload: unknown) =>
    fs.writeFileSync(path.join(dir, name), JSON.stringify(payload));

  it("lists only json files, oldest first, for a missing dir too", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-transport-"));
    write("command_2_b.json", { action: "setTempo", bpm: 2 });
    write("command_1_a.json", { action: "setTempo", bpm: 1 });
    write("notes.txt", {});
    expect(listQueuedCommandFiles(dir)).toEqual(["command_1_a.json", "command_2_b.json"]);
    expect(listQueuedCommandFiles(path.join(dir, "absent"))).toEqual([]);
    expect(listQueuedCommandFiles(undefined)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("claims a file exactly once", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-transport-"));
    write("command_1_a.json", { action: "setTempo", bpm: 1 });
    expect(claimQueuedCommandFile(dir, "command_1_a.json")).toEqual({ action: "setTempo", bpm: 1 });
    expect(claimQueuedCommandFile(dir, "command_1_a.json")).toBeNull();
    expect(listQueuedCommandFiles(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a payload with no action and leaves no debris", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-transport-"));
    write("command_1_a.json", { bpm: 1 });
    expect(claimQueuedCommandFile(dir, "command_1_a.json")).toBeNull();
    expect(fs.readdirSync(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
