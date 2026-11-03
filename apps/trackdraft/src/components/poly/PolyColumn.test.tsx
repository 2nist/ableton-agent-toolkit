// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlueprintSection, BlueprintSong } from "../../types/blueprint";
import {
  POLY_HEIGHT,
  POLY_TOP,
  laneGeometry,
  type PolyNode,
} from "../../lib/poly/layout";
import { LONG_PRESS_MS } from "../../hooks/useLongPress";
import { stepsBlockId } from "../../lib/poly/drumSteps";
import PolyColumn, { type PolyColumnActions } from "./PolyColumn";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const song = {
  id: "song",
  key: "C",
  scale: "ionian",
  bpm: 120,
} as BlueprintSong;

const section = {
  id: "chorus",
  name: "Chorus",
  role: "chorus",
  bars: 4,
  chords: [
    { id: "c1", romanNumeral: "", root: "C", quality: "maj", beats: 4 },
    { id: "c2", romanNumeral: "", root: "A", quality: "min", beats: 4 },
    { id: "c3", romanNumeral: "", root: "F", quality: "maj", beats: 4 },
    { id: "c4", romanNumeral: "", root: "G", quality: "maj", beats: 4 },
  ],
  beatsPerChord: 4,
  velocity: "mf",
  timeSignatureNumerator: 4,
  timeSignatureDenPower: 2,
  drumPattern: "standard",
  lyrics: "when the night comes down\nwe are still here",
  melody: {
    notes: [
      { pitch: 64, startTime: 0, duration: 1 },
      { pitch: 67, startTime: 4, duration: 1 },
      { pitch: 62, startTime: 8, duration: 1 },
    ],
  },
} as BlueprintSection;

const node: PolyNode = {
  key: "chorus#0",
  sectionId: "chorus",
  occurrenceIndex: 0,
  name: "Chorus",
  role: "chorus",
  ordinal: 3,
  startBeat: 64,
  durationBeats: 16,
  startBar: 4,
  bars: 4,
  x: 0,
  y: POLY_TOP,
  w: 384,
  h: POLY_HEIGHT,
  facts: { chords: 4, drums: true, melody: true, lyrics: true, meter: "4/4" },
  startSeconds: 32,
};

const role = { bg: "#ffa500", text: "#1a1200", label: "Chorus" };

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

function actions(
  overrides: Partial<PolyColumnActions> = {},
): PolyColumnActions {
  return {
    select: () => {},
    hover: () => {},
    beginRename: () => {},
    rename: () => {},
    cancelRename: () => {},
    beginResize: () => {},
    beginMove: () => {},
    openMenu: () => {},
    pickLane: () => {},
    pickChord: () => {},
    beginChordEdit: () => {},
    beginChordMove: () => {},
    openChordMenu: () => {},
    beginChordResize: () => {},
    commitChordEdit: () => {},
    cancelChordEdit: () => {},
    toggleDrumLane: () => {},
    toggleDrumStep: () => {},
    beginDrumGate: () => {},
    cycleDrumRatchet: () => {},
    openStepMenu: () => {},
    toggleDrumFlam: () => {},
    stepGroove: () => {},
    snapClock: () => {},
    stepVariant: () => {},
    beginNote: () => {},
    addNote: () => {},
    beginLyric: () => {},
    commitLyric: () => {},
    cancelLyric: () => {},
    ...overrides,
  };
}

function render(props: Partial<ComponentProps<typeof PolyColumn>> = {}) {
  act(() => {
    root.render(
      <PolyColumn
        node={node}
        section={section}
        song={song}
        role={role}
        lod="compact"
        inverseZoom={1}
        selected={false}
        hovered={false}
        editingName={false}
        editingLyric={false}
        selectedNote={null}
        editingChordId={null}
        placed={false}
        actions={actions()}
        {...props}
      />,
    );
  });
  return container;
}

describe("PolyColumn", () => {
  it("is one clickable band per section", () => {
    const el = render({ lod: "compact" });
    const button = el.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Chorus, 4 bars, 4/4");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
  });

  it("reads a lifted section as lifted, without renaming it", () => {
    const el = render({ placed: true });
    const band = el.querySelector("button") as HTMLElement;
    expect(band.getAttribute("aria-label")).toContain("lifted off the spine");
    // jsdom drops the `outline` shorthand; the dashed ring is checked in the
    // browser, the accessible name is checked here.
    const home = render({ placed: false });
    expect(
      home.querySelector("button")?.getAttribute("aria-label"),
    ).not.toContain("lifted");
  });

  it("keeps the section named at compact zoom", () => {
    expect(render({ lod: "compact" }).textContent).toContain("Chorus");
  });

  it("draws the material lanes at full", () => {
    const el = render({ lod: "full" });
    const text = el.textContent ?? "";
    expect(text).toContain("Chorus");
    expect(text).toContain("#3");
    // The playing progression, derived: C Am F G in C is I vi IV V.
    expect(text).toContain("I");
    expect(text).toContain("vi");
    expect(text).toContain("when the night comes down");
    // The groove signature carries one glyph per voice.
    expect(el.querySelectorAll("[class*='font-mono']").length).toBeGreaterThan(
      0,
    );
    expect(text).toMatch(/[KSH]/);
  });

  it("shows every element lane at the standard face", () => {
    const el = render({ lod: "full" });
    // Melody notes, its contour and the colour layer are part of the 50% view,
    // not a reward for zooming further.
    expect(el.querySelectorAll("[data-poly-note]").length).toBe(3);
    expect(el.querySelector("polyline")).not.toBeNull();
    expect(el.querySelectorAll("[title$='colour']").length).toBe(4);
  });

  it("draws a melody note where it sounds, at its own pitch", () => {
    const el = render({ lod: "full" });
    const notes = [...el.querySelectorAll("[data-poly-note]")] as HTMLElement[];
    const tops = notes.map((note) =>
      Number.parseFloat(note.style.top.replace("calc(", "")),
    );
    // 64 sounds above 62, so its bar sits higher in the lane.
    expect(tops[0]).toBeLessThan(tops[2]);
    // 16-beat section: the notes at beat 4 and beat 8 sit a quarter and half
    // of the way across.
    expect(notes[1].style.left).toBe("25%");
    expect(notes[2].style.left).toBe("50%");
  });

  it("reports the note you press", () => {
    const beginNote = vi.fn();
    const el = render({ lod: "full", actions: actions({ beginNote }) });
    const note = el.querySelector("[data-poly-note='1']") as HTMLElement;
    act(() => {
      note.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
    expect(beginNote).toHaveBeenCalledWith(node, 1, expect.anything());
  });

  it("rings the held note", () => {
    const el = render({ lod: "full", selectedNote: 1 });
    const held = el.querySelector("[data-poly-note='1']") as HTMLElement;
    expect(held.style.border).toContain("solid");
    const other = el.querySelector("[data-poly-note='0']") as HTMLElement;
    expect(other.style.border).not.toContain("solid");
  });

  it("drops a note where the melody lane is double-clicked", () => {
    const addNote = vi.fn();
    const el = render({ lod: "full", actions: actions({ addNote }) });
    const lane = el.querySelector("[data-poly-note='0']")
      ?.parentElement as HTMLElement;
    // jsdom has no layout, so the lane is given one.
    lane.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 88,
        right: 200,
        bottom: 88,
        x: 0,
        y: 0,
      }) as DOMRect;
    act(() => {
      lane.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          clientX: 100,
          clientY: 44,
        }),
      );
    });
    expect(addNote).toHaveBeenCalledWith(node, { x: 0.5, y: 0.5 });
  });

  it("adds the facts line only at detail", () => {
    expect(render({ lod: "full" }).textContent).not.toContain("0:32");
    expect(render({ lod: "detail" }).textContent).toContain("0:32");
  });

  it("draws nothing but the band on the spine at dot", () => {
    const el = render({ lod: "dot" });
    expect(el.textContent).toBe("");
  });

  it("opens that element's tools when a lane is clicked", () => {
    const pickLane = vi.fn();
    const el = render({ lod: "full", actions: actions({ pickLane }) });
    const strips = el.querySelectorAll("[aria-hidden='true']");
    expect(strips.length).toBeGreaterThan(0);
    // The chord lane is the fourth lane rect; click every strip and check the
    // set of lanes reported.
    const seen: string[] = [];
    act(() => {
      el.querySelectorAll("div").forEach((node) => {
        const click = node.getAttribute("aria-hidden");
        if (click === "true" && node.style.pointerEvents === "auto") {
          node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      });
    });
    for (const call of pickLane.mock.calls) seen.push(call[1] as string);
    expect(seen).toContain("chords");
    expect(seen).toContain("drums");
  });

  it("opens a rename box when asked", () => {
    const el = render({ lod: "full", editingName: true });
    const input = el.querySelector("input");
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).defaultValue).toBe("Chorus");
  });

  it("commits a rename on Enter", () => {
    const rename = vi.fn();
    const el = render({
      lod: "full",
      editingName: true,
      actions: actions({ rename }),
    });
    const input = el.querySelector("input") as HTMLInputElement;
    input.value = "Big Chorus";
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(rename).toHaveBeenCalledWith(node, "Big Chorus");
  });

  it("reports the node it belongs to when clicked", () => {
    const select = vi.fn();
    const el = render({ actions: actions({ select }) });
    const button = el.querySelector("button");
    act(() => button?.click());
    expect(select).toHaveBeenCalledWith(node);
  });

  it("selects the chord you click", () => {
    const pickChord = vi.fn();
    const el = render({ lod: "full", actions: actions({ pickChord }) });
    const cell = el.querySelector('[title^="vi — Am"]');
    expect(cell).not.toBeNull();
    act(() => {
      (cell as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(pickChord).toHaveBeenCalledWith(node, "c2");
  });

  it("mutes the drum lane whose row you click", () => {
    const toggleDrumLane = vi.fn();
    const el = render({ lod: "full", actions: actions({ toggleDrumLane }) });
    const kick = el.querySelector('button[aria-label^="Kick"]');
    expect(kick).not.toBeNull();
    act(() => (kick as HTMLElement).click());
    expect(toggleDrumLane).toHaveBeenCalledWith("kick", "mute");
  });

  it("solos instead of muting on an alt-click", () => {
    const toggleDrumLane = vi.fn();
    const el = render({ lod: "full", actions: actions({ toggleDrumLane }) });
    const snare = el.querySelector('button[aria-label^="Snare"]');
    act(() => {
      (snare as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true, altKey: true }),
      );
    });
    expect(toggleDrumLane).toHaveBeenCalledWith("snare", "solo");
  });

  it("reads a muted lane as pressed and struck through", () => {
    const muted = { ...section, drumLaneMute: ["hat" as const] };
    const el = render({ lod: "full", section: muted });
    const hat = el.querySelector('button[aria-label^="Hat"]');
    expect(hat?.getAttribute("aria-pressed")).toBe("true");
    expect(hat?.getAttribute("aria-label")).toContain("unmute");
  });

  it("shows the groove on the focused column only", () => {
    const el = render({ lod: "full", selected: true });
    expect(
      el.querySelector("button[aria-label^='Groove standard']"),
    ).not.toBeNull();
    const cold = render({ lod: "full", selected: false });
    expect(cold.querySelector("button[aria-label^='Groove']")).toBeNull();
  });

  it("steps the groove up on click and down on alt-click", () => {
    const stepGroove = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      actions: actions({ stepGroove }),
    });
    const chip = el.querySelector(
      "button[aria-label^='Groove']",
    ) as HTMLElement;
    act(() => chip.click());
    act(() => {
      chip.dispatchEvent(
        new MouseEvent("click", { bubbles: true, altKey: true }),
      );
    });
    expect(stepGroove.mock.calls).toEqual([[1], [-1]]);
  });

  it("steps the preset's variants from the chip", () => {
    const stepVariant = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      actions: actions({ stepVariant }),
    });
    const variant = el.querySelector("button[aria-label^='Variant']");
    expect(variant).not.toBeNull();
    act(() => (variant as HTMLElement).click());
    expect(stepVariant).toHaveBeenCalledWith(1);
  });

  it("offers no variant when nothing is chosen yet", () => {
    // Auto and muted have no variants — the chip steps intensity only.
    const auto = { ...section, drumPattern: undefined };
    const el = render({ lod: "full", selected: true, section: auto });
    expect(el.querySelector("button[aria-label^='Variant']")).toBeNull();
    expect(
      el.querySelector("button[aria-label^='Groove auto']"),
    ).not.toBeNull();
  });

  it("opens the chord editor on a double-click on a chord cell", () => {
    const beginChordEdit = vi.fn();
    const el = render({ lod: "full", actions: actions({ beginChordEdit }) });
    const cell = el.querySelector('[title^="vi — Am"]') as HTMLElement;
    act(() => {
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(beginChordEdit).toHaveBeenCalledWith(node, "c2");
  });

  it("retypes the numeral in place and commits on Enter", () => {
    const commitChordEdit = vi.fn();
    const el = render({
      lod: "full",
      editingChordId: "c2",
      actions: actions({ commitChordEdit }),
    });
    const input = el.querySelector(
      'input[aria-label^="Retype vi"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => {
      input.value = "IV";
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(commitChordEdit).toHaveBeenCalledWith(node, "c2", "IV");
  });

  it("hosts the editor on the first cell of a repeated chord only", () => {
    const el = render({ lod: "full", editingChordId: "c2" });
    // The 4-bar section laps twice, so "vi" is drawn twice — one definition.
    expect(el.querySelectorAll("input[aria-label^='Retype vi']").length).toBe(
      1,
    );
  });

  it("starts a chord move with the cell centres it will choose between", () => {
    const beginChordMove = vi.fn();
    const el = render({ lod: "full", actions: actions({ beginChordMove }) });
    const cell = el.querySelector('[data-chord-id="c2"]') as HTMLElement;
    expect(cell).not.toBeNull();
    act(() => {
      cell.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: 40,
        }),
      );
    });
    expect(beginChordMove).toHaveBeenCalledWith(
      node,
      "c2",
      expect.any(Array),
      expect.anything(),
    );
  });

  it("re-times a chord from its cell edge", () => {
    const beginChordResize = vi.fn();
    const el = render({ lod: "full", actions: actions({ beginChordResize }) });
    const handle = el.querySelector(
      '[aria-label^="Re-time vi"]',
    ) as HTMLElement;
    expect(handle).not.toBeNull();
    act(() => {
      handle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
    });
    expect(beginChordResize).toHaveBeenCalledWith(
      node,
      "c2",
      expect.anything(),
    );
  });

  it("leaves the chart alone when the editor is dismissed", () => {
    const cancelChordEdit = vi.fn();
    const commitChordEdit = vi.fn();
    const el = render({
      lod: "full",
      editingChordId: "c2",
      actions: actions({ cancelChordEdit, commitChordEdit }),
    });
    const input = el.querySelector(
      'input[aria-label^="Retype vi"]',
    ) as HTMLInputElement;
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(cancelChordEdit).toHaveBeenCalled();
    expect(commitChordEdit).not.toHaveBeenCalled();
  });

  it("opens the lyric editor on a double-click in the lyric lane", () => {
    const beginLyric = vi.fn();
    const el = render({ lod: "full", actions: actions({ beginLyric }) });
    const strips = [...el.querySelectorAll("div[aria-hidden='true']")].filter(
      (strip) => (strip as HTMLElement).style.pointerEvents === "auto",
    );
    act(() => {
      strips[2].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(beginLyric).toHaveBeenCalledWith(node);
  });

  it("grows its content into a taller row, and stops", () => {
    // The column is 750 units, so at the 50% standard view it is 375 px and
    // its content is scaled by 375/280.
    const standard = render({ lod: "full", inverseZoom: 2 });
    const name = standard.querySelector(
      "span.truncate.font-medium",
    ) as HTMLElement;
    expect(parseFloat(name.style.fontSize)).toBeCloseTo(
      11 * 2 * (375 / 280),
      5,
    );

    // Zoomed in, the scale stops at the height the rows bought.
    const desk = render({ lod: "full", inverseZoom: 1 });
    const big = desk.querySelector("span.truncate.font-medium") as HTMLElement;
    expect(parseFloat(big.style.fontSize)).toBeCloseTo(11 * 1 * 1.35, 5);

    // Zoomed far out the row is shorter than the base size: content keeps its
    // base size and the LOD ladder — not the scale — is what trims the face.
    const far = render({ lod: "full", inverseZoom: 6 });
    const small = far.querySelector("span.truncate.font-medium") as HTMLElement;
    expect(parseFloat(small.style.fontSize)).toBeCloseTo(11 * 6, 5);
  });
});

describe("reading preferences", () => {
  it("moves lanes when the order changes", () => {
    const flipped = render({
      lod: "full",
      lanes: laneGeometry({
        above: ["lyric", "bass", "drums"],
        below: ["melody", "color", "chords"],
      }),
    });
    const strip = (id: string) => {
      const rect = laneGeometry({
        above: ["lyric", "bass", "drums"],
        below: ["melody", "color", "chords"],
      }).byId.get(id as never)!;
      return [...flipped.querySelectorAll("div[aria-hidden='true']")].some(
        (el) =>
          Math.abs(
            parseFloat((el as HTMLElement).style.top) - (rect.y - node.y),
          ) < 0.5,
      );
    };
    expect(strip("melody")).toBe(true);
  });

  it("shows chord names instead of numerals on request", () => {
    const roman = render({ lod: "full" });
    expect(roman.textContent).toContain("I");
    const letters = render({ lod: "full", chordLabels: "letter" });
    expect(letters.textContent).toContain("C");
  });
});

describe("painting drum steps", () => {
  it("is a picture, not an editor, when the column is not selected", () => {
    // One button per cell on every column was 48 × 6 targets for a 12-bar verse,
    // none of them reachable in a way that made sense. Only the selected column
    // gets targets; the rest paint one mark per hit.
    const el = render({ lod: "full" });
    expect(el.querySelectorAll('button[aria-label*="step"]').length).toBe(0);
    // …and the pattern is still visible: the row is drawn, with marks on it.
    expect(el.querySelectorAll("[aria-hidden] span").length).toBeGreaterThan(0);
  });

  it("gives every cell of a lane its own target — on the column you can edit", () => {
    const toggleDrumStep = vi.fn();
    // §S1.5: cells are buttons only on the selected column; everywhere else a
    // column is a picture of the pattern, one mark per hit.
    const el = render({
      lod: "full",
      selected: true,
      actions: actions({ toggleDrumStep }),
    });
    const cells = [...el.querySelectorAll('button[aria-label*="step"]')];
    expect(cells.length).toBeGreaterThan(0);
    const first = cells[0];
    act(() => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toggleDrumStep).toHaveBeenCalledTimes(1);
    // node, lane, index, columns, on — the inverse of what is drawn.
    const [calledNode, lane, index, columns, on] = toggleDrumStep.mock.calls[0];
    expect(calledNode.key).toBe(node.key);
    expect(typeof lane).toBe("string");
    expect(index).toBe(0);
    expect(columns).toBeGreaterThan(1);
    expect(typeof on).toBe("boolean");
  });
});

describe("feel on a painted step (§S1.9)", () => {
  // The first cell of the kick row, authored: a `steps` block over beat 0..1.
  const painted = {
    ...section,
    drumBlocks: [
      {
        id: stepsBlockId("kick", 0, 1),
        lane: "kick" as const,
        startBeat: 0,
        endBeat: 1,
        mode: "steps" as const,
        notes: [{ beat: 0, voice: "kick" as const, velocity: 100 }],
      },
    ],
  };
  const click = (el: Element, init: MouseEventInit) =>
    act(() => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
    });
  const firstCell = (el: Element) =>
    el.querySelector('button[aria-label*="step"]') as HTMLElement;

  it("rolls the step on ⇧-click, and does not clear it", () => {
    const cycleDrumRatchet = vi.fn();
    const toggleDrumStep = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      section: painted,
      actions: actions({ cycleDrumRatchet, toggleDrumStep }),
    });
    click(firstCell(el), { shiftKey: true });
    expect(cycleDrumRatchet).toHaveBeenCalledTimes(1);
    expect(toggleDrumStep).not.toHaveBeenCalled();
  });

  it("flams the step on ⌥-click, and does not clear it", () => {
    const toggleDrumFlam = vi.fn();
    const toggleDrumStep = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      section: painted,
      actions: actions({ toggleDrumFlam, toggleDrumStep }),
    });
    click(firstCell(el), { altKey: true });
    expect(toggleDrumFlam).toHaveBeenCalledTimes(1);
    expect(toggleDrumStep).not.toHaveBeenCalled();
  });

  it("still clears on a plain click", () => {
    const cycleDrumRatchet = vi.fn();
    const toggleDrumStep = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      section: painted,
      actions: actions({ cycleDrumRatchet, toggleDrumStep }),
    });
    click(firstCell(el), {});
    expect(toggleDrumStep).toHaveBeenCalledTimes(1);
    expect(cycleDrumRatchet).not.toHaveBeenCalled();
  });

  it("offers no feel verbs on a generated step", () => {
    // There is no note to roll, and baking one would replace the pocket — so a
    // modifier click on generated material has to fall through to the toggle.
    const cycleDrumRatchet = vi.fn();
    const toggleDrumStep = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      actions: actions({ cycleDrumRatchet, toggleDrumStep }),
    });
    click(firstCell(el), { shiftKey: true });
    expect(toggleDrumStep).toHaveBeenCalledTimes(1);
    expect(cycleDrumRatchet).not.toHaveBeenCalled();
  });

  it("opens the step menu on right-click", () => {
    const openStepMenu = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      section: painted,
      actions: actions({ openStepMenu }),
    });
    act(() => {
      firstCell(el).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    expect(openStepMenu).toHaveBeenCalledTimes(1);
    const [, lane, index, columns] = openStepMenu.mock.calls[0];
    expect(lane).toBe("kick");
    expect(index).toBe(0);
    expect(columns).toBeGreaterThan(1);
  });

  it("leaves a generated step's right-click to the section menu", () => {
    // Nothing to edit on the generated groove, so the canvas's section menu
    // should get the event — swallowing it would make right-click dead here.
    const openStepMenu = vi.fn();
    const el = render({
      lod: "full",
      selected: true,
      actions: actions({ openStepMenu }),
    });
    act(() => {
      firstCell(el).dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    });
    expect(openStepMenu).not.toHaveBeenCalled();
  });

  it("names the roll in the cell's own label", () => {
    const el = render({
      lod: "full",
      selected: true,
      section: {
        ...section,
        drumBlocks: [
          {
            ...painted.drumBlocks[0],
            notes: [
              { beat: 0, voice: "kick" as const, velocity: 100, ratchet: 3 },
            ],
          },
        ],
      },
    });
    expect(firstCell(el).getAttribute("aria-label")).toContain("×3");
  });
});

describe("hold instead of a modifier", () => {
  // jsdom has no PointerEvent; React's synthetic handler only needs the
  // coordinates, so a MouseEvent dispatched under the pointer name is enough.
  const pointer = (type: string, x = 10, y = 10) =>
    new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  const down = (el: Element, x = 10, y = 10) =>
    el.dispatchEvent(pointer("pointerdown", x, y));

  it("solos the drum lane when its glyph is held", () => {
    vi.useFakeTimers();
    try {
      const toggleDrumLane = vi.fn();
      const el = render({ lod: "full", actions: actions({ toggleDrumLane }) });
      const glyph = el.querySelector(
        'button[aria-label*="hold to solo"]',
      ) as HTMLElement;
      act(() => down(glyph));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      });
      expect(toggleDrumLane).toHaveBeenCalledWith("kick", "solo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the hold when the pointer moves", () => {
    vi.useFakeTimers();
    try {
      const toggleDrumLane = vi.fn();
      const el = render({ lod: "full", actions: actions({ toggleDrumLane }) });
      const glyph = el.querySelector(
        'button[aria-label*="hold to solo"]',
      ) as HTMLElement;
      act(() => down(glyph));
      act(() => {
        glyph.dispatchEvent(pointer("pointermove", 60, 60));
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      });
      expect(toggleDrumLane).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("steps the groove back when the chip is held, without also stepping it on", () => {
    vi.useFakeTimers();
    try {
      const stepGroove = vi.fn();
      const el = render({
        lod: "full",
        selected: true,
        actions: actions({ stepGroove }),
      });
      const chip = el.querySelector(
        'button[aria-label^="Groove"]',
      ) as HTMLElement;
      act(() => down(chip));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      });
      expect(stepGroove).toHaveBeenCalledWith(-1);
      // The click that follows the release must not also step forward.
      act(() => {
        chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(stepGroove).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the role palette when the column is held", () => {
    vi.useFakeTimers();
    try {
      const openMenu = vi.fn();
      const el = render({ lod: "compact", actions: actions({ openMenu }) });
      const band = el.querySelector("button.absolute.inset-0") as HTMLElement;
      act(() => down(band, 40, 50));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      });
      expect(openMenu).toHaveBeenCalledWith(
        node,
        expect.objectContaining({ clientX: 40, clientY: 50 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the bass lane", () => {
  it("draws the generated line before anything is authored", () => {
    const el = render({ lod: "full" });
    const notes = [...el.querySelectorAll("[data-poly-bass-note]")];
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].getAttribute("aria-label")).toMatch(/pitch \d+, beat/);
  });

  it("takes a note for a drag, on the bass lane", () => {
    const beginNote = vi.fn();
    const el = render({ lod: "full", actions: actions({ beginNote }) });
    const note = el.querySelector("[data-poly-bass-note]") as HTMLElement;
    act(() => {
      note.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 5,
          clientY: 5,
        }),
      );
    });
    expect(beginNote).toHaveBeenCalledTimes(1);
    expect(beginNote.mock.calls[0][3]).toBe("bass");
  });

  it("drops a new note where the lane is double-clicked", () => {
    const addNote = vi.fn();
    const el = render({ lod: "full", actions: actions({ addNote }) });
    const lane = el.querySelector("[data-poly-bass]") as HTMLElement;
    // jsdom has no layout, so the lane is given one.
    lane.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 130,
        right: 200,
        bottom: 130,
        x: 0,
        y: 0,
      }) as DOMRect;
    act(() => {
      lane.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, clientX: 20, clientY: 20 }),
      );
    });
    expect(addNote).toHaveBeenCalledTimes(1);
    expect(addNote.mock.calls[0][2]).toBe("bass");
  });

  it("draws the authored line when the section has one", () => {
    const authored = {
      ...section,
      bassNotes: [{ pitch: 41, startTime: 0, duration: 8 }],
    } as BlueprintSection;
    const el = render({ lod: "full", section: authored });
    expect(el.querySelectorAll("[data-poly-bass-note]")).toHaveLength(1);
    expect(
      el.querySelector("[data-poly-bass-note]")?.getAttribute("aria-label"),
    ).toContain("pitch 41");
  });
});

describe("⌥-drag", () => {
  it("starts a move with the option key down, so the view can copy instead", () => {
    const beginMove = vi.fn();
    const el = render({ lod: "compact", actions: actions({ beginMove }) });
    const band = el.querySelector("button.absolute.inset-0") as HTMLElement;
    act(() => {
      band.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
          altKey: true,
        }),
      );
    });
    expect(beginMove).toHaveBeenCalledTimes(1);
    // The modifier travels with the event — that is where the view reads it.
    expect(beginMove.mock.calls[0][1].altKey).toBe(true);
  });
});

describe("PolyColumn tonality", () => {
  const withTonality = (tonality: PolyNode["tonality"]): PolyNode => ({
    ...node,
    tonality,
  });

  it("says nothing when the section is in the song's key", () => {
    const el = render({
      node: withTonality({
        key: "C",
        scale: "ionian",
        own: false,
        modulations: 0,
      }),
      lod: "detail",
    });
    expect(el.textContent).not.toContain("ionian");
  });

  it("shows the section's own key when it has one", () => {
    const el = render({
      node: withTonality({
        key: "D",
        scale: "aeolian",
        own: true,
        modulations: 0,
      }),
      lod: "detail",
    });
    expect(el.textContent).toContain("D aeolian");
  });

  it("counts modulations inside the section", () => {
    const el = render({
      node: withTonality({
        key: "C",
        scale: "ionian",
        own: false,
        modulations: 2,
      }),
      lod: "detail",
    });
    expect(el.textContent).toContain("+2");
  });

  it("shows both when a section has its own key and modulates", () => {
    const el = render({
      node: withTonality({
        key: "F",
        scale: "dorian",
        own: true,
        modulations: 1,
      }),
      lod: "detail",
    });
    expect(el.textContent).toContain("F dorian +1");
  });
});

describe("PolyColumn modulation ticks", () => {
  it("marks where a section changes key", () => {
    const el = render({
      node,
      section: {
        ...section,
        tonicRegions: [
          { startBeat: 0, key: "C", scale: "ionian", source: "authored" },
          { startBeat: 8, key: "D", scale: "dorian", source: "authored" },
        ],
      } as BlueprintSection,
      lod: "detail",
    });
    const tick = el.querySelector('[title*="Key changes to D dorian"]');
    expect(tick).not.toBeNull();
  });

  it("draws nothing when the section has one home", () => {
    const el = render({ lod: "detail" });
    expect(el.querySelector('[title*="Key changes"]')).toBeNull();
  });
});

describe("PolyColumn clock drift", () => {
  const clocked = (timeDomain: BlueprintSection["timeDomain"]) =>
    ({ ...section, timeDomain }) as BlueprintSection;

  it("shows the clock alone when nothing drifted", () => {
    const el = render({
      section: clocked({ rate: 2 }),
      lod: "full",
      selected: true,
    });
    const badge = [...el.querySelectorAll("button, span")].find(
      (node) => (node.textContent ?? "").trim() === "×2",
    );
    console.log(
      "NOW:",
      el.textContent,
      "| badges:",
      [...el.querySelectorAll("span,button")]
        .map((n) => n.textContent)
        .filter((t) => t && t.includes("×2")),
    );
    expect(badge).toBeDefined();
    expect(badge?.tagName).toBe("SPAN");
  });

  it("becomes a snap control once hits have drifted", () => {
    const snapClock = vi.fn();
    const el = render({
      // Half swing pushes the off-eighths off the 16th grid.
      section: clocked({ rate: 1, swing: 0.5 }),
      lod: "full",
      selected: true,
      actions: actions({ snapClock }),
    });
    const badge = [...el.querySelectorAll("button")].find((node) =>
      /swing/.test(node.getAttribute("aria-label") ?? ""),
    );
    expect(badge).toBeDefined();
    expect(badge?.textContent ?? "").toMatch(/swing 50% · \d+/);
    act(() => (badge as HTMLButtonElement).click());
    expect(snapClock).toHaveBeenCalledWith("chorus");
  });
});
