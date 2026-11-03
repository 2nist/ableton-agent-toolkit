// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SongOpening from "./SongOpening";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

function render(state: "opening" | "missing") {
  act(() => {
    root.render(
      <MemoryRouter>
        <SongOpening state={state} />
      </MemoryRouter>,
    );
  });
}

describe("SongOpening", () => {
  it("fills the wait with the shell's own shape instead of a blank page", () => {
    render("opening");
    const frame = container.firstElementChild as HTMLElement;
    expect(frame).not.toBeNull();
    // The frame is a full-height shell skeleton and says it is busy, so a
    // screen reader hears a loading state rather than an empty document.
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(frame.querySelector("main")).not.toBeNull();
    expect(container.textContent).toContain("Opening…");
  });

  it("announces the reason politely, in a live region", () => {
    render("opening");
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent).toContain("Reading the song library.");
  });

  it("offers the way out when the song is not in the library", () => {
    render("missing");
    expect(container.textContent).toContain("Song not found.");
    const back = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Dashboard"),
    );
    expect(back).toBeTruthy();
    // No skeleton for a dead end: it would suggest something is coming.
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
