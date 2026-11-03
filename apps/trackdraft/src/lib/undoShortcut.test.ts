import { describe, expect, it } from "vitest";
import { undoIntent, undoShortcutLabel } from "./undoShortcut";

const cmd = (key: string, extra: Partial<Parameters<typeof undoIntent>[0]> = {}) => ({
  key,
  metaKey: true,
  ctrlKey: false,
  shiftKey: false,
  ...extra,
});

describe("undoIntent", () => {
  it("is undo for the plain modifier chord", () => {
    expect(undoIntent(cmd("z"))).toBe("undo");
    expect(undoIntent(cmd("Z"))).toBe("undo");
  });

  it("accepts Ctrl as well as ⌘, because the app runs on both platforms", () => {
    expect(undoIntent(cmd("z", { metaKey: false, ctrlKey: true }))).toBe("undo");
  });

  it("is redo for both spellings", () => {
    expect(undoIntent(cmd("z", { shiftKey: true }))).toBe("redo");
    expect(undoIntent(cmd("y"))).toBe("redo");
  });

  it("does nothing without a modifier", () => {
    // A bare `z` is the canvas's "jump to the focused node" — the one key the
    // poly surface would most hate to lose to an undo.
    expect(undoIntent({ ...cmd("z"), metaKey: false, ctrlKey: false })).toBe(
      null,
    );
  });

  it("ignores modifier chords it does not own", () => {
    expect(undoIntent(cmd("d"))).toBeNull();
    expect(undoIntent(cmd("s"))).toBeNull();
    expect(undoIntent(cmd("a", { shiftKey: true }))).toBeNull();
  });
});

describe("undoShortcutLabel", () => {
  it("speaks Mac", () => {
    expect(undoShortcutLabel("MacIntel")).toEqual({
      undo: "⌘Z",
      redo: "⇧⌘Z",
    });
  });

  it("speaks everything else", () => {
    expect(undoShortcutLabel("Win32")).toEqual({
      undo: "Ctrl+Z",
      redo: "Ctrl+Y",
    });
  });
});
