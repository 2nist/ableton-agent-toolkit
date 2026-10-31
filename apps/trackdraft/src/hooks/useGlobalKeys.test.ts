// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { KEY_PRIORITY, registerKeyHandler, type KeyHandler } from "./useGlobalKeys";

function press(key: string, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (target ?? window).dispatchEvent(event);
  return event;
}

function track(): { calls: string[]; handler: (name: string) => KeyHandler } {
  const calls: string[] = [];
  return {
    calls,
    handler: (name) => (context) => {
      if (context.event.key !== "Escape") return;
      calls.push(name);
      return name !== "pass";
    },
  };
}

describe("useGlobalKeys — one registry, arbitrated by priority", () => {
  let cleanups: (() => void)[] = [];

  beforeEach(() => {
    cleanups.forEach((off) => off());
    cleanups = [];
  });

  it("runs the higher priority handler first and stops the stack", () => {
    const { calls, handler } = track();
    cleanups.push(registerKeyHandler(handler("shell"), KEY_PRIORITY.shell));
    cleanups.push(registerKeyHandler(handler("overlay"), KEY_PRIORITY.overlay));

    const event = press("Escape");

    // The modal consumed it; the shell never saw it. This is the exact
    // bug the registry was written for: two Escape owners firing at once.
    expect(calls).toEqual(["overlay"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("falls through to the next handler when one declines", () => {
    const { calls, handler } = track();
    cleanups.push(registerKeyHandler(handler("pass"), KEY_PRIORITY.overlay));
    cleanups.push(registerKeyHandler(handler("shell"), KEY_PRIORITY.shell));

    const event = press("Escape");

    expect(calls).toEqual(["pass", "shell"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the event alone when nobody claims it", () => {
    const event = press("Escape");
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores an unsubscribed handler", () => {
    const { calls, handler } = track();
    const off = registerKeyHandler(handler("gone"), KEY_PRIORITY.shell);
    off();
    press("Escape");
    expect(calls).toEqual([]);
  });

  it("reports typing so text fields keep their own keys", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    let typing: boolean | undefined;
    cleanups.push(
      registerKeyHandler((context) => {
        typing = context.typing;
        return true;
      }, KEY_PRIORITY.shell),
    );

    press("Escape", input);

    expect(typing).toBe(true);
    input.remove();
  });
});
