/**
 * The five Study panel bodies. They are deliberately dumb: the view computes
 * the projection (`lib/study/report.ts`) and these only draw it and report
 * clicks. No panel knows about another panel, which is what makes the
 * cross-filter a one-line prop rather than a subscription graph.
 */

import type { ReactNode } from "react";
import type { Lead } from "../../lib/study/leads";
import { measureDef } from "../../lib/study/fields";
import type { DistributionResult, GroupResult, MatrixResult } from "../../lib/study/report";
import type { Grain, StudyFilter, StudyRow } from "../../lib/study/types";

function formatValue(grain: Grain, key: string, value: number): string {
  // A corpus row has no tension/bars; "—" is the honest reading, not 0.
  if (!Number.isFinite(value)) return "—";
  const measure = measureDef(grain, key);
  if (!measure) return String(value);
  if (measure.kind === "share") return `${Math.round(value * 100)}%`;
  if (measure.kind === "count") return String(Math.round(value));
  if (measure.field === "tension" || measure.field === "avgTension") return value.toFixed(2);
  return value.toFixed(1);
}

export function PanelFrame({
  title,
  meta,
  selected,
  onSelect,
  onEdit,
  editor,
  children,
  className = "",
}: {
  title: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
  /** Toggles the inline editor (the Study desk's own tool, not shell chrome). */
  onEdit?: () => void;
  editor?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col rounded border bg-panel ${
        selected ? "border-accent/60" : "border-edge"
      } ${className}`}
    >
      <header className="flex shrink-0 items-baseline gap-2 border-b border-edge/70 px-2 py-1">
        <button
          type="button"
          onClick={onSelect}
          className="truncate text-left font-mono text-[10px] uppercase tracking-wider text-inkMuted hover:text-ink"
          title="Edit this panel in the inspector"
        >
          {title}
        </button>
        {meta ? <span className="ml-auto font-mono text-[9px] tabular-nums text-inkMuted/60">{meta}</span> : null}
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            aria-pressed={!!editor}
            title="Edit this panel"
            className={`shrink-0 font-mono text-[9px] ${editor ? "text-accent" : "text-inkMuted/60 hover:text-ink"}`}
          >
            ✎
          </button>
        ) : null}
      </header>
      {editor}
      <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
    </section>
  );
}

export function LeadsPanel({ leads, onFilter }: { leads: Lead[]; onFilter: (filter: StudyFilter) => void }) {
  if (leads.length === 0) {
    return <p className="font-mono text-[10px] text-inkMuted/60">Nothing to compare yet.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {leads.map((lead) => (
        <li key={lead.id}>
          <button
            type="button"
            disabled={!lead.filter}
            onClick={() => lead.filter && onFilter(lead.filter)}
            className={`w-full rounded border border-transparent px-1 py-0.5 text-left ${
              lead.filter ? "hover:border-edge hover:bg-panelAlt" : "cursor-default"
            }`}
          >
            <span className="block text-[11px] leading-4 text-ink">{lead.text}</span>
            <span className="block font-mono text-[9px] text-inkMuted/70">{lead.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BreakdownPanel({
  groups,
  grain,
  measures,
  onFilter,
}: {
  groups: GroupResult[];
  grain: Grain;
  measures: string[];
  onFilter: (value: string) => void;
}) {
  if (groups.length === 0) return <Empty />;
  if (measures.length === 0) {
    return <p className="font-mono text-[10px] text-inkMuted/60">Pick a measure in the inspector to rank the groups.</p>;
  }
  const max = Math.max(...groups.map((group) => group.values[measures[0] ?? ""] ?? 0), 1e-9);
  return (
    <table className="w-full border-collapse font-mono text-[10px]">
      <thead>
        <tr className="text-[8px] uppercase tracking-[0.08em] text-inkMuted">
          <th className="pb-1 text-left font-normal">value</th>
          <th className="pb-1 text-right font-normal">n</th>
          {measures.slice(0, 2).map((key) => (
            <th key={key} className="pb-1 text-right font-normal">
              {measureDef(grain, key)?.label ?? key}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => {
          const raw = group.values[measures[0] ?? ""];
          const first = Number.isFinite(raw) ? raw! : 0;
          return (
            <tr
              key={group.key}
              onClick={() => onFilter(group.key)}
              className="cursor-pointer border-t border-edge/30 hover:bg-panelAlt"
              title="Click to filter every panel by this value"
            >
              <td className="relative py-1 pr-1">
                <span
                  className="absolute inset-y-0.5 left-0 rounded-sm bg-accent/15"
                  style={{ width: `${Math.max(2, (first / max) * 100)}%` }}
                  aria-hidden
                />
                <span className="relative truncate">{group.key}</span>
              </td>
              <td className="py-1 text-right tabular-nums text-inkMuted">{group.n}</td>
              {measures.slice(0, 2).map((key) => (
                <td key={key} className="py-1 pl-2 text-right tabular-nums">
                  {formatValue(grain, key, group.values[key] ?? 0)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MatrixPanel({
  result,
  onCell,
}: {
  result: MatrixResult;
  onCell: (rowValue: string, colValue: string) => void;
}) {
  if (result.rowKeys.length === 0) return <Empty />;
  const max = Math.max(...result.cells.flat(), 1);
  return (
    <div className="overflow-auto">
      <table className="border-collapse font-mono text-[9px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-panel px-1 py-0.5 text-left font-normal text-inkMuted" />
            {result.colKeys.map((col) => (
              <th key={col} className="px-1 py-0.5 text-center font-normal text-inkMuted">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rowKeys.map((rowKey, rowIndex) => (
            <tr key={rowKey}>
              <th className="sticky left-0 z-10 bg-panel px-1 py-0.5 text-left font-normal text-inkMuted">
                {rowKey}
              </th>
              {result.colKeys.map((colKey, colIndex) => {
                const count = result.cells[rowIndex]![colIndex]!;
                return (
                  <td key={colKey} className="p-0">
                    <button
                      type="button"
                      disabled={count === 0}
                      onClick={() => onCell(rowKey, colKey)}
                      title={count === 0 ? "no occurrences" : `${rowKey} → ${colKey}: ${count} — click to filter`}
                      className="flex h-5 w-6 items-center justify-center tabular-nums text-ink/90 disabled:text-inkMuted/25"
                      style={{ background: count === 0 ? undefined : `rgb(var(--c-accent) / ${0.1 + 0.7 * (count / max)})` }}
                    >
                      {count || ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 font-mono text-[8px] text-inkMuted/50">
        {result.total} events · top {result.rowKeys.length} × {result.colKeys.length} · click a cell to filter
      </p>
    </div>
  );
}

export function DistributionPanel({ result }: { result: DistributionResult }) {
  if (result.buckets.length === 0) return <Empty />;
  const max = Math.max(...result.buckets.map((bucket) => bucket.count), 1);
  return (
    <ul className="space-y-0.5">
      {result.buckets.map((bucket) => (
        <li key={bucket.label} className="flex items-center gap-2 font-mono text-[9px]">
          <span className="w-14 shrink-0 truncate text-right text-inkMuted/70">{bucket.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-sm bg-panelAlt">
            <span
              className="block h-full rounded-sm bg-accent/60"
              style={{ width: `${(bucket.count / max) * 100}%` }}
            />
          </span>
          <span className="w-6 shrink-0 text-right tabular-nums text-inkMuted">{bucket.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function RowsPanel({
  rows,
  onOpen,
}: {
  rows: StudyRow[];
  onOpen: (row: StudyRow) => void;
}) {
  if (rows.length === 0) return <Empty />;
  return (
    <ul className="space-y-0.5">
      {rows.map((row, index) => {
        const label = row.grain === "song" ? row.title : `${row.title} · ${row.section}`;
        const detail = rowDetail(row);
        const key =
          row.grain === "song"
            ? `${row.songId}-${index}`
            : row.grain === "section"
              ? `${row.songId}-${row.sectionId}`
              : `${row.songId}-${row.sectionId}-${row.index}-${index}`;
        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-panelAlt"
              title="Open this section"
            >
              <span className="min-w-0 flex-1 truncate text-[10px] text-ink">{label}</span>
              <span className="shrink-0 font-mono text-[8.5px] text-inkMuted/70">{detail}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Only facts the row actually has — the corpus has no bars or tension, and
 *  "NaN bars" in a list reads as a bug. */
function rowDetail(row: StudyRow): string {
  const whenFinite = (value: number, format: (n: number) => string) => (Number.isFinite(value) ? format(value) : "");
  if (row.grain === "song") {
    return [
      `${row.sectionCount} sections`,
      whenFinite(row.totalBars, (v) => `${Math.round(v)} bars`),
      row.form,
    ].filter(Boolean).join(" · ");
  }
  if (row.grain === "section") {
    return [
      row.role,
      whenFinite(row.bars, (v) => `${Math.round(v)} bars`),
      `${row.chordCount} chords`,
      whenFinite(row.avgTension, (v) => `tension ${v.toFixed(2)}`),
    ].filter(Boolean).join(" · ");
  }
  return [
    `${row.roman} → ${row.nextRoman}`,
    whenFinite(row.tension, (v) => `tension ${v.toFixed(2)}`),
  ].filter(Boolean).join(" · ");
}

function Empty() {
  return <p className="font-mono text-[10px] text-inkMuted/60">No rows match the current filters.</p>;
}
