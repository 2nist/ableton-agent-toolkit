/**
 * The Study board's state — what you are looking at, not what it says.
 *
 * Each scope keeps its own board: "this song" wants role/tension panels, the
 * catalogue has no roles or tension and wants degree transitions and section
 * lengths. Sharing one panel list between them made two of five panels read
 * "untagged" the moment you switched.
 *
 * Panels and scope persist (a `ui` preference); the filter stack is
 * deliberately ephemeral, because reopening the app with a stale cross-filter
 * hides most of the data and reads as a broken view.
 */

import { create } from "zustand";
import { createDebouncedWriter, readStorage } from "./storage";
import { STORAGE_KEYS } from "../lib/persistence/keys";
import { dimensionDef } from "../lib/study/fields";
import type { PanelKind, PanelSpec, StudyFilter, StudyScope } from "../lib/study/types";

export const STUDY_BOARD_KEY = STORAGE_KEYS.studyBoard.key;

const SCOPES: StudyScope[] = ["song", "library", "catalogue"];

interface PersistedBoard {
  scope?: StudyScope;
  boards?: Partial<Record<StudyScope, PanelSpec[]>>;
  selectedPanelId?: string | null;
}

/** A new panel of each kind, with the fields that kind actually uses. */
export function newPanelSpec(kind: PanelKind): PanelSpec {
  const id = `${kind}-${Date.now().toString(36)}`;
  if (kind === "matrix") {
    return { id, kind, title: "Degree transitions", grain: "chord", row: "roman", col: "nextRoman", measures: [] };
  }
  if (kind === "distribution") {
    return { id, kind, title: "Section length", grain: "section", dimension: "bars", measures: [] };
  }
  if (kind === "rows") {
    return { id, kind, title: "Sections", grain: "section", measures: ["meanBars"], limit: 12 };
  }
  if (kind === "leads") {
    return { id, kind, title: "Leads", grain: "section", measures: [], limit: 6 };
  }
  return { id, kind, title: "By role", grain: "section", dimension: "role", measures: ["count", "meanTension", "meanBars"], limit: 9 };
}

export function defaultPanels(scope: StudyScope): PanelSpec[] {
  const base = ["leads", "matrix", "breakdown", "distribution", "rows"].map((kind) =>
    newPanelSpec(kind as PanelKind),
  );
  if (scope !== "catalogue") return base;
  // The corpus has degrees, not roles/bars/tension: section length is chord
  // count, and the breakdown groups by degree.
  return [
    { ...newPanelSpec("leads"), grain: "chord" },
    newPanelSpec("matrix"),
    { ...newPanelSpec("breakdown"), grain: "chord", dimension: "roman", title: "By degree", measures: ["count", "borrowShare"] },
    { ...newPanelSpec("distribution"), dimension: "chordCount" },
    { ...newPanelSpec("rows"), measures: ["meanChords"] },
  ];
}

function validPanels(value: unknown): PanelSpec[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const panels = value.filter((entry): entry is PanelSpec =>
    !!entry
    && typeof entry === "object"
    && typeof (entry as PanelSpec).id === "string"
    && typeof (entry as PanelSpec).title === "string"
    && ["breakdown", "matrix", "distribution", "rows", "leads"].includes((entry as PanelSpec).kind)
    && ["song", "section", "chord"].includes((entry as PanelSpec).grain)
    && Array.isArray((entry as PanelSpec).measures),
  );
  return panels.length === value.length && panels.length > 0 ? panels : null;
}

function autoTitle(panel: PanelSpec): string | null {
  if (panel.kind !== "breakdown" || !panel.dimension) return null;
  const label = dimensionDef(panel.grain, panel.dimension)?.label ?? panel.dimension;
  return `By ${label}`;
}

/** Keeps a breakdown's auto title honest after a grouping change — a panel
 *  called "By role" showing meters is the kind of drift that makes a report
 *  look broken. A title the user typed does not start with "By ", so it wins. */
function normalizePanel(panel: PanelSpec): PanelSpec {
  const grain: PanelSpec["grain"] = ["song", "section", "chord"].includes(panel.grain) ? panel.grain : "section";
  const next: PanelSpec = { ...panel, grain };
  // Drop keys the panel's grain cannot group by (a stale board from an older
  // field registry must not render chords for a "song" panel).
  for (const key of ["dimension", "row", "col"] as const) {
    const value = next[key];
    if (value && !dimensionDef(grain, value)) delete next[key];
  }
  // A panel that lost its grouping (an older field registry) gets the
  // factory default back instead of rendering an empty projection.
  if (!next.dimension && (next.kind === "breakdown" || next.kind === "distribution")) {
    const fallback = newPanelSpec(next.kind).dimension;
    if (fallback && dimensionDef(grain, fallback)) next.dimension = fallback;
  }
  const title = autoTitle(next);
  if (title && next.title.startsWith("By ")) next.title = title;
  return next;
}

function defaultBoards(): Record<StudyScope, PanelSpec[]> {
  return {
    song: defaultPanels("song"),
    library: defaultPanels("library"),
    catalogue: defaultPanels("catalogue"),
  };
}

function loadBoard(): { scope: StudyScope; boards: Record<StudyScope, PanelSpec[]>; selectedPanelId: string | null } {
  const raw = readStorage<PersistedBoard>(STUDY_BOARD_KEY, {});
  const boards = defaultBoards();
  for (const scope of SCOPES) {
    const stored = validPanels(raw.boards?.[scope]);
    if (stored) boards[scope] = stored.map(normalizePanel);
  }
  const scope: StudyScope = SCOPES.includes(raw.scope as StudyScope) ? (raw.scope as StudyScope) : "song";
  const selectedPanelId = boards[scope].some((panel) => panel.id === raw.selectedPanelId) ? raw.selectedPanelId! : null;
  return { scope, boards, selectedPanelId };
}

const persist = createDebouncedWriter<PersistedBoard>(STUDY_BOARD_KEY, 300);

interface StudyState {
  scope: StudyScope;
  /** The current scope's panels. */
  panels: PanelSpec[];
  /** Every scope's board, so switching back restores what you built. */
  boards: Record<StudyScope, PanelSpec[]>;
  selectedPanelId: string | null;
  filters: StudyFilter[];
  setScope: (scope: StudyScope) => void;
  selectPanel: (id: string | null) => void;
  updatePanel: (id: string, patch: Partial<PanelSpec>) => void;
  addPanel: (panel: PanelSpec) => void;
  removePanel: (id: string) => void;
  addFilter: (filter: StudyFilter) => void;
  removeFilter: (index: number) => void;
  clearFilters: () => void;
}

const initial = loadBoard();

export const useStudyStore = create<StudyState>((set, get) => {
  const commit = (panels: PanelSpec[], extra: Partial<StudyState> = {}) => {
    const boards = { ...get().boards, [get().scope]: panels };
    set({ panels, boards, ...extra });
    const { scope, selectedPanelId } = get();
    persist.write({ scope, boards, selectedPanelId });
  };

  return {
    scope: initial.scope,
    panels: initial.boards[initial.scope],
    boards: initial.boards,
    selectedPanelId: initial.selectedPanelId,
    filters: [],

    setScope: (scope) => {
      if (get().scope === scope) return;
      const boards = { ...get().boards, [get().scope]: get().panels };
      set({
        scope,
        boards,
        panels: boards[scope] ?? defaultPanels(scope),
        filters: [],
        selectedPanelId: null,
      });
      persist.write({ scope, boards, selectedPanelId: null });
    },

    selectPanel: (selectedPanelId) => {
      set({ selectedPanelId });
      const { scope, boards } = get();
      persist.write({ scope, boards, selectedPanelId });
    },

    updatePanel: (id, patch) => {
      const panels = get().panels.map((panel) => {
        if (panel.id !== id) return panel;
        const next = { ...panel, ...patch };
        if (patch.dimension && patch.title === undefined) {
          const title = autoTitle(next);
          if (title && panel.title.startsWith("By ")) next.title = title;
        }
        return normalizePanel(next);
      });
      commit(panels);
    },

    addPanel: (panel) => commit([...get().panels, panel], { selectedPanelId: panel.id }),

    removePanel: (id) => {
      commit(get().panels.filter((panel) => panel.id !== id), {
        selectedPanelId: get().selectedPanelId === id ? null : get().selectedPanelId,
      });
    },

    addFilter: (filter) => {
      const exists = get().filters.some(
        (entry) => entry.field === filter.field && entry.op === filter.op && String(entry.value) === String(filter.value),
      );
      if (exists) return;
      set({ filters: [...get().filters, filter] });
    },

    removeFilter: (index) => set({ filters: get().filters.filter((_, i) => i !== index) }),
    clearFilters: () => set({ filters: [] }),
  };
});

export function resetStudyBoardForTests(): void {
  const boards = defaultBoards();
  useStudyStore.setState({ scope: "song", panels: boards.song, boards, selectedPanelId: null, filters: [] });
}
