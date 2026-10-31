import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The bridge's wiring, against fakes for the two sockets it owns.
 *
 * The interesting behaviour is all in the *decision* — probe before polling,
 * poll only while a window is listening, and stop asking a build that rejects
 * the address — and none of that needs a real UDP port or a real Live set.
 * `startPositionBridge` is the production function; only `osc` and `ws` are
 * replaced, so the probe/poll/teardown paths under test are the shipped ones.
 */

type Handler = (payload: { address: string; args: unknown[] }) => void;

const udp = vi.hoisted(() => {
  const state = {
    sent: [] as { address: string; args?: unknown[] }[],
    messageHandler: null as Handler | null,
    readyHandler: null as (() => void) | null,
    closed: false,
  };
  return state;
});

vi.mock("osc", () => ({
  default: {
    UDPPort: class {
      on(event: string, handler: never) {
        if (event === "message") udp.messageHandler = handler;
        if (event === "ready") udp.readyHandler = handler;
      }
      open() {
        udp.readyHandler?.();
      }
      send(payload: { address: string; args?: unknown[] }) {
        udp.sent.push(payload);
      }
      close() {
        udp.closed = true;
      }
    },
  },
}));

const wss = vi.hoisted(() => {
  const state = {
    connectionHandler: null as ((client: unknown) => void) | null,
    errorHandler: null as ((error: unknown) => void) | null,
    closed: false,
  };
  return state;
});

vi.mock("ws", () => ({
  WebSocketServer: class {
    on(event: string, handler: never) {
      if (event === "connection") wss.connectionHandler = handler as never;
      if (event === "error") wss.errorHandler = handler as never;
    }
    close() {
      wss.closed = true;
    }
  },
}));

const { startPositionBridge } = await import("../src/bridge.js");

/** A WebSocket client double — enough of the surface bridge.ts touches. */
function fakeClient() {
  const handlers: Record<string, (arg?: unknown) => void> = {};
  return {
    readyState: 1,
    OPEN: 1,
    sent: [] as string[],
    send(payload: string) {
      this.sent.push(payload);
    },
    on(event: string, handler: (arg?: unknown) => void) {
      handlers[event] = handler;
    },
    close() {
      handlers.close?.();
    },
    error(err: unknown) {
      handlers.error?.(err);
    },
    terminate: vi.fn(),
  };
}

/** Deliver an OSC reply as AbletonOSC would. */
function reply(address: string, args: unknown[] = []): void {
  udp.messageHandler?.({ address, args });
}

function sentTo(address: string): number {
  return udp.sent.filter((m) => m.address === address).length;
}

describe("position bridge — float position feed", () => {
  let bridge: { stop(): void } | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    udp.sent = [];
    udp.messageHandler = null;
    udp.readyHandler = null;
    udp.closed = false;
    wss.connectionHandler = null;
    wss.errorHandler = null;
    wss.closed = false;
  });

  afterEach(() => {
    bridge?.stop();
    bridge = null;
    vi.useRealTimers();
  });

  it("probes for a float position as soon as OSC is open", () => {
    bridge = startPositionBridge({ beatPollIntervalMs: 33 });
    // `open()` fires ready synchronously in the fake.
    expect(sentTo("/live/song/get/beat")).toBe(1);
  });

  it("polls only once Live answers, and only while a client is listening", () => {
    bridge = startPositionBridge({ beatPollIntervalMs: 33 });

    // No client yet: the probe is out, but no stream of requests.
    vi.advanceTimersByTime(200);
    expect(sentTo("/live/song/get/beat")).toBe(1);

    // Live answers → floats are available.
    reply("/live/song/get/beat", [12.25]);
    const client = fakeClient();
    wss.connectionHandler?.(client);

    vi.advanceTimersByTime(99);
    // immediate + 33 + 66 + 99
    expect(sentTo("/live/song/get/beat")).toBeGreaterThanOrEqual(4);

    // The last client leaving stops the polling entirely.
    client.close();
    const settled = sentTo("/live/song/get/beat");
    vi.advanceTimersByTime(500);
    expect(sentTo("/live/song/get/beat")).toBe(settled);
  });

  it("relays a fractional position to clients", () => {
    bridge = startPositionBridge({ beatPollIntervalMs: 33 });
    const client = fakeClient();
    wss.connectionHandler?.(client);

    reply("/live/song/get/beat", [12.4375]);
    expect(client.sent.join("\n")).toContain('"beat":12.4375');
  });

  it("stops polling when Live rejects the address, instead of spamming it", () => {
    // An AbletonOSC build that only knows `start_listen/beat` answers the
    // probe with an error. Continuing would mean thirty rejections a second —
    // the exact log storm this bridge just stopped producing.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    bridge = startPositionBridge({ beatPollIntervalMs: 33 });
    const client = fakeClient();
    wss.connectionHandler?.(client); // optimistic start is fine; it's one request
    reply("/live/song/get/beat", [12.25]);
    vi.advanceTimersByTime(33);

    reply("/live/error", ["Error handling OSC message: Unknown OSC address: /live/song/get/beat"]);
    const afterRejection = sentTo("/live/song/get/beat");
    vi.advanceTimersByTime(500);

    expect(sentTo("/live/song/get/beat")).toBe(afterRejection);
    expect(log.mock.calls.some(([line]) => String(line).includes("rejected"))).toBe(true);
    log.mockRestore();
  });

  it("does not mistake an unrelated Live error for a rejected address", () => {
    // The known `/live/error` ("<Track.Track …> is not in list") fires every
    // 5 s forever; it must never be read as "stop following Live".
    bridge = startPositionBridge({ beatPollIntervalMs: 33 });
    const client = fakeClient();
    wss.connectionHandler?.(client);
    reply("/live/song/get/beat", [12.25]);

    reply("/live/error", ["Error handling OSC message: <Track.Track object at 0x1> is not in list"]);
    const before = sentTo("/live/song/get/beat");
    vi.advanceTimersByTime(200);
    expect(sentTo("/live/song/get/beat")).toBeGreaterThan(before);
  });

  it("keeps the integer-only feed when polling is disabled", () => {
    bridge = startPositionBridge({ beatPollIntervalMs: 0 });
    expect(sentTo("/live/song/get/beat")).toBe(0);
    vi.advanceTimersByTime(500);
    expect(sentTo("/live/song/get/beat")).toBe(0);
    // The listeners it always sent are still there.
    expect(sentTo("/live/song/start_listen/beat")).toBeGreaterThan(0);
  });

  it("survives a websocket server error instead of throwing out of the process", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    bridge = startPositionBridge({ beatPollIntervalMs: 33 });
    expect(() => wss.errorHandler?.(new Error("EADDRINUSE"))).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
