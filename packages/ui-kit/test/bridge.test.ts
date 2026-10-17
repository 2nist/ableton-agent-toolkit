import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge, detectHost } from "../src/bridge.js";

/**
 * Each host's bridge shape is asserted against the SDK/Cycling '74 docs
 * directly — see bridge.ts's module doc comment for citations. These tests
 * mock `window.max` / `window.webkit` / `window.chrome.webview` rather than
 * a real Extensions modal or M4L jweb page, since neither is available in a
 * headless test — same limitation as @platform/test-harness's audio
 * rendering: logic and protocol shape are verified, real host behavior
 * isn't.
 */

afterEach(() => {
  // @ts-expect-error -- deliberately clearing test-only globals between cases
  delete window.max;
  // @ts-expect-error -- M4L host global is injected by jweb, not in lib.dom
  delete window.webkit;
  // @ts-expect-error -- Extensions host global is injected by the webview
  delete window.chrome;
});

describe("detectHost", () => {
  it("detects m4l-jweb via window.max", () => {
    (window as any).max = { outlet: vi.fn(), bindInlet: vi.fn() };
    expect(detectHost()).toBe("m4l-jweb");
  });

  it("detects extension-webkit via window.webkit.messageHandlers.live", () => {
    (window as any).webkit = { messageHandlers: { live: { postMessage: vi.fn() } } };
    expect(detectHost()).toBe("extension-webkit");
  });

  it("detects extension-webview2 via window.chrome.webview", () => {
    (window as any).chrome = { webview: { postMessage: vi.fn() } };
    expect(detectHost()).toBe("extension-webview2");
  });

  it("falls back to unknown when no host bridge is present", () => {
    expect(detectHost()).toBe("unknown");
  });
});

describe("createBridge — m4l-jweb", () => {
  it("send() calls window.max.outlet with a JSON-stringified payload, repeatably", () => {
    const outlet = vi.fn();
    (window as any).max = { outlet, bindInlet: vi.fn() };

    const bridge = createBridge();
    bridge.send({ hello: "world" });
    bridge.send({ hello: "again" }); // multiple sends are fine under m4l — no one-shot limit

    expect(outlet).toHaveBeenCalledTimes(2);
    expect(outlet).toHaveBeenNthCalledWith(1, "message", JSON.stringify({ hello: "world" }));
    expect(outlet).toHaveBeenNthCalledWith(2, "message", JSON.stringify({ hello: "again" }));
  });

  it("onMessage() wraps window.max.bindInlet and actually fires", () => {
    let inletCallback: ((...args: unknown[]) => void) | undefined;
    (window as any).max = {
      outlet: vi.fn(),
      bindInlet: vi.fn((_name: string, cb: (...args: unknown[]) => void) => {
        inletCallback = cb;
      }),
    };

    const bridge = createBridge();
    const received: unknown[] = [];
    bridge.onMessage((msg) => received.push(msg));

    inletCallback!(JSON.stringify({ ping: 1 }));

    expect(received).toEqual([{ ping: 1 }]);
  });

  it("onMessage()'s unsubscribe stops further delivery", () => {
    let inletCallback: ((...args: unknown[]) => void) | undefined;
    (window as any).max = {
      outlet: vi.fn(),
      bindInlet: vi.fn((_name: string, cb: (...args: unknown[]) => void) => {
        inletCallback = cb;
      }),
    };

    const bridge = createBridge();
    const received: unknown[] = [];
    const unsubscribe = bridge.onMessage((msg) => received.push(msg));
    unsubscribe();

    inletCallback!(JSON.stringify({ ping: 1 }));

    expect(received).toEqual([]);
  });
});

describe("createBridge — extension-webkit", () => {
  it("send() posts one close_and_send message with a JSON-stringified result string", () => {
    const postMessage = vi.fn();
    (window as any).webkit = { messageHandlers: { live: { postMessage } } };

    const bridge = createBridge();
    bridge.send({ status: "ok" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      method: "close_and_send",
      params: [JSON.stringify({ status: "ok" })],
    });
  });

  it("a second send() is dropped and reported via onProtocolError, matching the one-shot dialog lifecycle", () => {
    const postMessage = vi.fn();
    (window as any).webkit = { messageHandlers: { live: { postMessage } } };
    const onProtocolError = vi.fn();

    const bridge = createBridge({ onProtocolError });
    bridge.send({ first: true });
    bridge.send({ second: true });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(onProtocolError).toHaveBeenCalledTimes(1);
  });

  it("onMessage() registers but the handler never fires — Extensions modals have no push channel", () => {
    (window as any).webkit = { messageHandlers: { live: { postMessage: vi.fn() } } };

    const bridge = createBridge();
    const handler = vi.fn();
    const unsubscribe = bridge.onMessage(handler);

    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("createBridge — unknown host", () => {
  it("send() reports a protocol error instead of throwing", () => {
    const onProtocolError = vi.fn();
    const bridge = createBridge({ onProtocolError });

    expect(() => bridge.send({ x: 1 })).not.toThrow();
    expect(onProtocolError).toHaveBeenCalledTimes(1);
  });
});
