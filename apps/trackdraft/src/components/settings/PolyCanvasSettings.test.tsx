// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePolyStore } from "../../store/polyStore";
import PolyCanvasSettings from "./PolyCanvasSettings";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  usePolyStore.getState().resetPrefs();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  usePolyStore.getState().resetPrefs();
});

function render() {
  act(() => root.render(<PolyCanvasSettings />));
  return container;
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === label,
  ) as HTMLButtonElement;
}

describe("PolyCanvasSettings", () => {
  it("lists every lane around the spine, top of the canvas first", () => {
    const el = render();
    const rows = [...el.querySelectorAll("ol li")].map((li) =>
      li.textContent?.trim(),
    );
    expect(rows[0]).toContain("Lyric");
    expect(rows[1]).toContain("Bass");
    expect(rows[2]).toContain("Drums");
    expect(rows[3]).toContain("Time");
    expect(rows[4]).toContain("Chords");
    expect(rows[6]).toContain("Melody");
  });

  it("moves a lane along its own side", () => {
    render();
    act(() => button("Move Lyric nearer the spine").click());
    expect(usePolyStore.getState().prefs.laneOrder.above).toEqual([
      "drums",
      "lyric",
      "bass",
    ]);
  });

  it("disables the move that would leave the side", () => {
    render();
    expect(button("Move Lyric further from the spine").disabled).toBe(true);
    expect(button("Move Chords nearer the spine").disabled).toBe(true);
  });

  it("switches the chord label style", () => {
    render();
    const letters = [...container.querySelectorAll("button")].find(
      (el) => el.textContent === "Am · F · G",
    ) as HTMLButtonElement;
    act(() => letters.click());
    expect(usePolyStore.getState().prefs.chordLabels).toBe("letter");
    expect(letters.getAttribute("aria-pressed")).toBe("true");
  });

  it("resets everything back to the designed order", () => {
    render();
    act(() => button("Move Lyric nearer the spine").click());
    const reset = [...container.querySelectorAll("button")].find(
      (el) => el.textContent === "Reset",
    ) as HTMLButtonElement;
    act(() => reset.click());
    expect(usePolyStore.getState().prefs.laneOrder.above).toEqual([
      "drums",
      "bass",
      "lyric",
    ]);
  });
});
