// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PolySpanRuler, { rulerTicks, viewportBracket } from "./PolySpanRuler";
import { arrangeSections } from "../../lib/poly/layout";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** `count` sections of `bars` bars each, laid out by the ONE layout the canvas
 *  draws — the ruler is tested against the real thing, not a hand-built box. */
function layoutFor(count: number, bars = 4) {
  const spans = Array.from({ length: count }, (_, index) => ({
    sectionId: `s${index}`,
    occurrenceIndex: 0,
    startBeat: index * bars * 4,
    durationBeats: bars * 4,
    startBar: index * bars + 1,
    bars,
    section: {
      id: `s${index}`,
      name: `Section ${index + 1}`,
      role: index % 2 ? "verse" : "chorus",
      bars,
      chords: [
        {
          id: `c${index}`,
          root: "C",
          quality: "maj",
          beats: 4,
          romanNumeral: "",
        },
      ],
      beatsPerChord: 4,
      velocity: "mf",
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
    },
  }));
  return arrangeSections(spans as never);
}

const viewport = { width: 470, height: 690 };

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

function render(props: Partial<Parameters<typeof PolySpanRuler>[0]> = {}) {
  const layout = props.layout ?? layoutFor(4);
  act(() => {
    root.render(
      <PolySpanRuler
        layout={layout}
        camera={props.camera ?? { x: 200, y: 0, zoom: 0.5 }}
        viewport={props.viewport ?? viewport}
        focusedId={props.focusedId ?? null}
        parkedKeys={props.parkedKeys}
        onFocus={props.onFocus ?? (() => {})}
      />,
    );
  });
  return container;
}

describe("rulerTicks", () => {
  it("gives every section a tick across the whole song", () => {
    const ticks = rulerTicks(layoutFor(40), null);
    expect(ticks).toHaveLength(40);
    // Equal sections → equal widths; the remainder is the gaps between them.
    expect(ticks[0].left).toBeCloseTo(0, 6);
    const widths = new Set(ticks.map((tick) => tick.width.toFixed(9)));
    expect(widths.size).toBe(1);
    expect(ticks[0].width).toBeLessThan(1 / 40);
    expect(ticks[39].left + ticks[39].width).toBeCloseTo(1, 6);
  });

  it("numbers repeated passes so two ticks never share a name", () => {
    const layout = layoutFor(4);
    // Pretend the second column is a second pass of the first section.
    const repeated = {
      ...layout,
      nodes: layout.nodes.map((node, index) =>
        index === 1 ? { ...node, sectionId: "s0", occurrenceIndex: 1 } : node,
      ),
    };
    const ticks = rulerTicks(repeated, null);
    expect(ticks.map((tick) => tick.pass)).toEqual([1, 2, 1, 1]);
  });

  it("marks the focused section", () => {
    const ticks = rulerTicks(layoutFor(40), "s7");
    expect(
      ticks.filter((tick) => tick.focused).map((tick) => tick.index),
    ).toEqual([7]);
  });

  it("survives a layout with no bounds", () => {
    const empty = { nodes: [], bounds: { x: 0, y: 0, w: 0, h: 0 } } as never;
    expect(rulerTicks(empty, null)).toEqual([]);
  });
});

describe("viewportBracket", () => {
  it("brackets a fraction of a long song", () => {
    const layout = layoutFor(40);
    const bracket = viewportBracket(
      layout,
      { x: 0, y: 0, zoom: 0.5 },
      viewport,
    );
    expect(bracket.left).toBeCloseTo(0, 6);
    expect(bracket.width).toBeGreaterThan(0);
    expect(bracket.width).toBeLessThan(0.1);
  });

  it("stays inside the strip however far the camera wanders", () => {
    const layout = layoutFor(40);
    for (const x of [-9000, 0, 5000, 99999]) {
      const bracket = viewportBracket(layout, { x, y: 0, zoom: 2 }, viewport);
      expect(bracket.left).toBeGreaterThanOrEqual(0);
      expect(bracket.left).toBeLessThanOrEqual(1);
      expect(bracket.left + bracket.width).toBeLessThanOrEqual(1.0001);
    }
  });

  it("never collapses to nothing when the song is a sliver on screen", () => {
    const layout = layoutFor(4);
    const bracket = viewportBracket(
      layout,
      { x: 0, y: 0, zoom: 0.08 },
      viewport,
    );
    expect(bracket.width).toBeGreaterThan(0);
  });
});

describe("PolySpanRuler", () => {
  it("draws one target per section at any song length", () => {
    const el = render({ layout: layoutFor(40) });
    expect(el.querySelectorAll("button[aria-label^='Go to']").length).toBe(40);
  });

  it("jumps to the section you click", () => {
    const onFocus = vi.fn();
    const el = render({ layout: layoutFor(40), onFocus });
    const ticks = el.querySelectorAll("button[aria-label^='Go to']");
    act(() => (ticks[7] as HTMLElement).click());
    expect(onFocus).toHaveBeenCalledWith(7);
  });

  it("names the focused section as current for a screen reader", () => {
    const el = render({ layout: layoutFor(40), focusedId: "s3" });
    const current = el.querySelectorAll("[aria-current='true']");
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute("aria-label")).toBe("Go to Section 4");
  });
});

describe("parked sections on the ruler", () => {
  const layout = layoutFor(4);

  it("marks the parked tick, and only that one", () => {
    const ticks = rulerTicks(layout, null, [layout.nodes[1].key]);
    expect(ticks[1].parked).toBe(true);
    expect(ticks.filter((tick) => tick.parked)).toHaveLength(1);
  });

  it("leaves every tick plain when nothing is parked", () => {
    expect(rulerTicks(layout, null).every((tick) => !tick.parked)).toBe(true);
  });

  it("says so in the tick's title, so the state is not colour-only", () => {
    const el = render({ parkedKeys: [layout.nodes[1].key] });
    const parked = el.querySelector('[data-parked="true"]') as HTMLElement;
    expect(parked).toBeTruthy();
    expect(parked.getAttribute("title")).toContain("on the shelf");
  });
});
