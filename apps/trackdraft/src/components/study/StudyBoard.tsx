import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSongStore } from "../../store/songStore";
import { useStudyStore } from "../../store/studyStore";
import { buildDataset, buildDatasetChunked, datasetFingerprint } from "../../lib/study/dataset";
import { corpusDataset, loadCorpusIndex } from "../../lib/study/corpus";
import { dimensionDef } from "../../lib/study/fields";
import { computeLeads, filterLabel } from "../../lib/study/leads";
import { applyFilters, runBreakdown, runDistribution, runMatrix, runRows } from "../../lib/study/report";
import { rowsOf, type Grain, type PanelKind, type PanelSpec, type StudyDataset, type StudyFilter, type StudyRow } from "../../lib/study/types";
import type { BlueprintSong } from "../../types/blueprint";
import Icon from "../common/Icon";
import Segmented from "../common/Segmented";
import PanelEditor from "./PanelEditor";
import {
  BreakdownPanel,
  DistributionPanel,
  LeadsPanel,
  MatrixPanel,
  PanelFrame,
  RowsPanel,
} from "./StudyPanels";

const datasetCache = new Map<string, StudyDataset>();
const CACHE_LIMIT = 3;

function filterFor(dimension: string, grain: Grain, value: string): StudyFilter {
  const def = dimensionDef(grain, dimension);
  return { field: dimension, op: "eq", value, grain: def?.grain ?? grain };
}

function panelSpec(kind: PanelKind): PanelSpec {
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
  return { id, kind, title: "By role", grain: "section", dimension: "role", measures: ["count", "meanTension"], limit: 9 };
}

/**
 * The Study desk's discovery board.
 *
 * It is a block inside the Harmony view's Study desk — not a route of its own.
 * The desk already answers "what is this cycle doing"; the board answers "how
 * does that compare", across the song or the loaded library, without leaving
 * the desk. Panels are specs (`PanelSpec`), so adding a data type is a field
 * descriptor; the inline ✎ editor keeps the controls next to the panel they
 * change instead of adding a station-wide tool rail.
 */
export default function StudyBoard({ song }: { song: BlueprintSong }) {
  const navigate = useNavigate();
  const songs = useSongStore((s) => s.songs);

  const scope = useStudyStore((s) => s.scope);
  const setScope = useStudyStore((s) => s.setScope);
  const panels = useStudyStore((s) => s.panels);
  const addPanel = useStudyStore((s) => s.addPanel);
  const selectPanel = useStudyStore((s) => s.selectPanel);
  const selectedPanelId = useStudyStore((s) => s.selectedPanelId);
  const filters = useStudyStore((s) => s.filters);
  const addFilter = useStudyStore((s) => s.addFilter);
  const removeFilter = useStudyStore((s) => s.removeFilter);
  const clearFilters = useStudyStore((s) => s.clearFilters);

  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    clearFilters();
  }, [song.id, clearFilters]);

  const fingerprint = useMemo(() => datasetFingerprint(songs), [songs]);
  const single = useMemo(() => buildDataset([song], "song"), [song]);

  const [library, setLibrary] = useState<StudyDataset | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [corpus, setCorpus] = useState<StudyDataset | null>(null);
  const [corpusError, setCorpusError] = useState<string | null>(null);

  useEffect(() => {
    if (scope !== "catalogue" || corpus) return;
    let cancelled = false;
    void loadCorpusIndex()
      .then((index) => {
        if (!cancelled) setCorpus(corpusDataset(index));
      })
      .catch((error: unknown) => {
        if (!cancelled) setCorpusError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [scope, corpus]);

  useEffect(() => {
    if (scope !== "library") return;
    const key = `library:${fingerprint}`;
    const cached = datasetCache.get(key);
    if (cached) {
      setLibrary(cached);
      setProgress(null);
      return;
    }
    let cancelled = false;
    setProgress({ done: 0, total: songs.length });
    void buildDatasetChunked(songs, "library", (done, total) => {
      if (!cancelled) setProgress({ done, total });
    }).then((built) => {
      if (cancelled) return;
      datasetCache.set(key, built);
      while (datasetCache.size > CACHE_LIMIT) {
        const oldest = datasetCache.keys().next().value;
        if (!oldest) break;
        datasetCache.delete(oldest);
      }
      setLibrary(built);
      setProgress(null);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, fingerprint, songs]);

  const dataset = scope === "song" ? single : scope === "library" ? library : corpus;

  const openRow = (row: StudyRow) => {
    if (row.grain === "song") navigate(`/song/${row.songId}/harmony`);
    else navigate(`/song/${row.songId}/harmony?section=${row.sectionId}`);
  };

  return (
    <section className="rounded border border-edge bg-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-edge/70 px-2 py-1.5">
        <Icon name="study" size={11} />
        <span className="font-mono text-[10px] uppercase tracking-wider text-inkMuted">Discovery</span>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { id: "song", label: "This song", hint: "Only the open song — instant, no index build" },
            { id: "library", label: "Library", hint: `Every loaded song (${songs.length})` },
            {
              id: "catalogue",
              label: "Catalogue",
              hint: "5,877 lead-sheet songs · degrees only (no key, meter, lyrics or melody)",
            },
          ]}
        />
        <span className="font-mono text-[9px] tabular-nums text-inkMuted/70">
          {dataset
            ? `${dataset.sections.length} sections · ${dataset.songs.length} songs · ${dataset.chords.length} chords${scope === "catalogue" ? " · degrees only" : ""}`
            : progress
              ? `indexing ${progress.done}/${progress.total}…`
              : scope === "catalogue"
                ? "loading corpus…"
                : "indexing…"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {filters.map((filter, index) => (
            <button
              key={`${filter.field}-${String(filter.value)}-${index}`}
              type="button"
              onClick={() => removeFilter(index)}
              title={`Remove this filter (${filter.grain})`}
              className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] text-accent hover:bg-accent/20"
            >
              {filterLabel(filter)} ✕
            </button>
          ))}
          {filters.length > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded border border-edge px-1.5 py-0.5 font-mono text-[9px] text-inkMuted hover:text-ink"
            >
              reset
            </button>
          )}
          <select
            value=""
            onChange={(event) => {
              const kind = event.target.value as PanelKind;
              if (!kind) return;
              addPanel(panelSpec(kind));
              setEditing(null);
            }}
            className="rounded border border-edge bg-panelAlt px-1 py-0.5 font-mono text-[9px] text-inkMuted"
            title="Add a panel"
          >
            <option value="">＋ panel</option>
            <option value="breakdown">bars</option>
            <option value="matrix">matrix</option>
            <option value="distribution">shape</option>
            <option value="rows">rows</option>
            <option value="leads">leads</option>
          </select>
        </span>
      </header>

      {corpusError && scope === "catalogue" ? (
        <p className="p-2 font-mono text-[10px] text-danger">Corpus unavailable — {corpusError}</p>
      ) : !dataset ? (
        <p className="p-2 font-mono text-[10px] text-inkMuted">
          {progress
            ? `Indexing ${progress.done} of ${progress.total} songs…`
            : scope === "catalogue"
              ? "Loading the harmony corpus…"
              : "Indexing…"}
        </p>
      ) : (
        <div className="grid gap-2 p-2 md:grid-cols-2">
          {panels.map((panel) => {
            const rows = rowsOf(dataset, panel.grain);
            const filtered = applyFilters(rows, filters);
            let body: React.ReactNode;
            let meta = `${filtered.length}`;
            if (panel.kind === "leads") {
              body = <LeadsPanel leads={computeLeads(filtered, panel.grain)} onFilter={addFilter} />;
            } else if (panel.kind === "breakdown") {
              const groups = runBreakdown(rows, panel, filters);
              meta = `${groups.length} groups · ${filtered.length}`;
              body = (
                <BreakdownPanel
                  groups={groups}
                  grain={panel.grain}
                  measures={panel.measures}
                  onFilter={(value) => panel.dimension && addFilter(filterFor(panel.dimension, panel.grain, value))}
                />
              );
            } else if (panel.kind === "matrix") {
              const result = runMatrix(rows, panel, filters);
              meta = `${result.total}`;
              body = (
                <MatrixPanel
                  result={result}
                  onCell={(rowValue, colValue) => {
                    if (panel.row) addFilter(filterFor(panel.row, panel.grain, rowValue));
                    if (panel.col) addFilter(filterFor(panel.col, panel.grain, colValue));
                  }}
                />
              );
            } else if (panel.kind === "distribution") {
              body = <DistributionPanel result={runDistribution(rows, panel, filters)} />;
            } else {
              body = <RowsPanel rows={runRows(rows, panel, filters)} onOpen={openRow} />;
            }
            return (
              <PanelFrame
                key={panel.id}
                title={panel.title}
                meta={meta}
                selected={selectedPanelId === panel.id}
                onSelect={() => selectPanel(panel.id)}
                onEdit={() => {
                  selectPanel(panel.id);
                  setEditing((current) => (current === panel.id ? null : panel.id));
                }}
                editor={editing === panel.id ? <PanelEditor panel={panel} /> : null}
              >
                {body}
              </PanelFrame>
            );
          })}
        </div>
      )}
    </section>
  );
}
