// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PolyClockChip from "./PolyClockChip";
import type { BlueprintSong } from "../../types/blueprint";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const song = {
  id: "s",
  title: "Test",
  key: "C",
  scale: "ionian",
  bpm: 120,
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  sections: [],
  arrangement: [],
  createdAt: "",
  updatedAt: "",
} as unknown as BlueprintSong;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(overrides: Partial<BlueprintSong> = {}, onChange = vi.fn()) {
  act(() =>
    root.render(
      <PolyClockChip
        song={{ ...song, ...overrides }}
        bottom={12}
        onChange={onChange}
      />,
    ),
  );
  return onChange;
}

function button(label: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((entry) =>
    typeof label === "string"
      ? entry.textContent?.trim() === label
      : label.test(entry.textContent ?? ""),
  );
  if (!found) throw new Error(`no button matching ${String(label)}`);
  return found as HTMLButtonElement;
}

function pointer(
  node: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
) {
  const event = new MouseEvent(type, { clientX, bubbles: true, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => {
    node.dispatchEvent(event);
  });
}

describe("PolyClockChip", () => {
  it("reads out the song's clock", () => {
    render();
    expect(container.textContent).toContain("120 bpm");
    expect(container.textContent).toContain("C");
    expect(container.textContent).toContain("ionian");
    expect(container.textContent).toContain("4/4");
  });

  it("shows the meter the song actually has", () => {
    render({ timeSignatureNumerator: 7, timeSignatureDenominator: 8 });
    expect(container.textContent).toContain("7/8");
  });

  it("writes a tempo only when the scrub is released", () => {
    const onChange = render();
    const tempo = button(/bpm/);
    // jsdom has no pointer capture.
    tempo.setPointerCapture = () => {};
    pointer(tempo, "pointerdown", 100);
    pointer(tempo, "pointermove", 130);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain("130 bpm");
    pointer(tempo, "pointerup", 130);
    expect(onChange).toHaveBeenCalledWith({ bpm: 130 });
  });

  it("does not write a tempo the scrub never changed", () => {
    const onChange = render();
    const tempo = button(/bpm/);
    tempo.setPointerCapture = () => {};
    pointer(tempo, "pointerdown", 100);
    pointer(tempo, "pointerup", 100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("writes a key from the list and closes it", () => {
    const onChange = render();
    act(() => button("C").click());
    expect(container.textContent).toContain("G");
    act(() => button("G").click());
    expect(onChange).toHaveBeenCalledWith({ key: "G" });
    // The list is gone again.
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });

  it("does not write the key it already has", () => {
    const onChange = render();
    act(() => button("C").click());
    act(() => button("C").click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("writes a scale", () => {
    const onChange = render();
    act(() => button("ionian").click());
    act(() => button("dorian").click());
    expect(onChange).toHaveBeenCalledWith({ scale: "dorian" });
  });

  it("closes a list on an outside press", () => {
    render();
    act(() => button("C").click());
    expect(container.querySelectorAll("button").length).toBeGreaterThan(3);
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(container.querySelectorAll("button")).toHaveLength(3);
  });
});
