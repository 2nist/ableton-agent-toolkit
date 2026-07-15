/**
 * Host detection and a normalized transport for UI code that must run in
 * either of two genuinely different webview hosts:
 *
 *   - An Ableton Extensions modal dialog (`context.ui.showModalDialog`),
 *     bridged via `window.webkit.messageHandlers.live.postMessage` (macOS)
 *     or `window.chrome.webview.postMessage` (Windows) — confirmed from the
 *     SDK's own docs (Ui.showModalDialog's doc comment in dist/index.d.mts).
 *   - A Max for Live device's `jweb` object, bridged via `window.max.outlet`
 *     / `window.max.bindInlet` — confirmed directly from Cycling '74's
 *     shipped docs (`jweb.maxref.xml`, `jweb.maxhelp`).
 *
 * These are NOT symmetric. Extensions supports exactly one message back to
 * the host — `{method: "close_and_send", params: [resultString]}` — which
 * closes the dialog and resolves a promise on the extension side. There is
 * no documented ongoing push channel into an open Extensions modal. M4L's
 * `window.max` bridge is fully continuous and bidirectional.
 *
 * This means `onMessage` genuinely never fires under either Extensions host
 * kind — that's not a limitation of this file, it's a fact about the host.
 * Components that need a live, ongoing channel (level meters, realtime
 * readouts) only make sense under `"m4l-jweb"` — see the package README.
 */

export type HostKind = "extension-webkit" | "extension-webview2" | "m4l-jweb" | "unknown";

interface MaxWindow {
  max?: {
    outlet: (...args: unknown[]) => void;
    bindInlet: (name: string, callback: (...args: unknown[]) => void) => void;
  };
}

interface WebKitWindow {
  webkit?: {
    messageHandlers?: {
      live?: { postMessage: (message: unknown) => void };
    };
  };
}

interface WebView2Window {
  chrome?: {
    webview?: { postMessage: (message: unknown) => void };
  };
}

type BridgeCapableWindow = MaxWindow & WebKitWindow & WebView2Window;

export function detectHost(win: Window = window): HostKind {
  const w = win as unknown as BridgeCapableWindow;
  if (w.max) return "m4l-jweb";
  if (w.webkit?.messageHandlers?.live) return "extension-webkit";
  if (w.chrome?.webview) return "extension-webview2";
  return "unknown";
}

export interface Bridge {
  readonly host: HostKind;
  /**
   * Sends a message to the host. Under `"m4l-jweb"` this is `window.max.outlet(...)`
   * and can be called any number of times. Under either Extensions host kind
   * this is a ONE-SHOT `close_and_send` call — after the first call, the
   * dialog closes; further calls are no-ops (logged via `onProtocolError`).
   */
  send(message: unknown): void;
  /**
   * Registers a handler for messages from the host. Under `"m4l-jweb"` this
   * wraps `window.max.bindInlet`. Under either Extensions host kind, or
   * `"unknown"`, the handler is registered but will never fire — Extensions
   * modals have no push channel. Returns an unsubscribe function.
   */
  onMessage(handler: (message: unknown) => void): () => void;
}

export interface CreateBridgeOptions {
  win?: Window;
  /** Called when `send` is used more than once under an Extensions host, or before any host is detected. Defaults to `console.warn`. */
  onProtocolError?: (message: string) => void;
}

const INLET_SYMBOL = "message";

export function createBridge(options: CreateBridgeOptions = {}): Bridge {
  const win = options.win ?? window;
  const onProtocolError = options.onProtocolError ?? ((message: string) => console.warn(`[@platform/ui-kit] ${message}`));
  const host = detectHost(win);
  const w = win as unknown as BridgeCapableWindow;

  let hasSentOnce = false;

  const send = (message: unknown): void => {
    switch (host) {
      case "m4l-jweb":
        w.max!.outlet(INLET_SYMBOL, JSON.stringify(message));
        return;
      case "extension-webkit":
        if (hasSentOnce) {
          onProtocolError("send() called more than once — Extensions modals support exactly one close_and_send.");
          return;
        }
        hasSentOnce = true;
        w.webkit!.messageHandlers!.live!.postMessage({ method: "close_and_send", params: [JSON.stringify(message)] });
        return;
      case "extension-webview2":
        if (hasSentOnce) {
          onProtocolError("send() called more than once — Extensions modals support exactly one close_and_send.");
          return;
        }
        hasSentOnce = true;
        w.chrome!.webview!.postMessage({ method: "close_and_send", params: [JSON.stringify(message)] });
        return;
      case "unknown":
        onProtocolError("send() called with no detected host — message dropped.");
        return;
    }
  };

  const onMessage = (handler: (message: unknown) => void): (() => void) => {
    if (host !== "m4l-jweb") {
      // Extensions hosts have no push channel into an open modal — handler
      // is intentionally never invoked. See module doc comment.
      return () => {};
    }
    let unsubscribed = false;
    w.max!.bindInlet(INLET_SYMBOL, (...args: unknown[]) => {
      if (unsubscribed) return;
      const [payload] = args;
      handler(typeof payload === "string" ? JSON.parse(payload) : payload);
    });
    return () => {
      unsubscribed = true;
    };
  };

  return { host, send, onMessage };
}
