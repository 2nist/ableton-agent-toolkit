// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PolyShelfStrip, { type PolyShelfItem } from "./PolyShelfStrip";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const role = { bg: "#ffa500", text: "#1a1200", label: "Chorus" };
const items: PolyShelfItem[] = [
  { key: "chorus#1", name: "Chorus 2", role, summary: "8b · 4/4", ordinal: 3 },
  { key: "verse#0", name: "Verse", role, summary: "16b · 4/4", ordinal: 1 },
];

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

function render(props: Partial<React.ComponentProps<typeof PolyShelfStrip>>) {
  act(() =>
    root.render(
      <PolyShelfStrip items={items} onRestore={() => {}} {...props} />,
    ),
  );
  return container;
}

describe("PolyShelfStrip", () => {
  it("is nothing at all when the shelf is empty", () => {
    const el = render({ items: [] });
    expect(el.textContent).toBe("");
    expect(el.querySelector('[role="group"]')).toBeNull();
  });

  it("lists every parked section with the facts that name it", () => {
    const el = render({});
    const group = el.querySelector('[role="group"]');
    expect(group?.getAttribute("aria-label")).toContain("2 parked sections");
    const buttons = [...el.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain("Chorus 2");
    expect(buttons[0].textContent).toContain("#3");
    expect(buttons[0].textContent).toContain("8b · 4/4");
  });

  it("restores the section you click", () => {
    const onRestore = vi.fn();
    const el = render({ onRestore });
    const buttons = [...el.querySelectorAll("button")];
    act(() =>
      buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(onRestore).toHaveBeenCalledWith("verse#0");
  });
});
