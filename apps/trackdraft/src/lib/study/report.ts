/**
 * Report math — pure functions over `StudyRow[]`.
 *
 * A panel is a spec, not a component: same rows, different projection. That is
 * what keeps "add another data type" cheap, and it is why the view can
 * cross-filter every panel from one click without any panel knowing about the
 * others.
 */

import { displayValue, measureDef, type MeasureDef } from "./fields";
import type { PanelSpec, StudyFilter, StudyRow } from "./types";

export function rowValue(row: StudyRow, field: string): unknown {
  return (row as unknown as Record<string, unknown>)[field];
}

const rawValue = rowValue;

function hasField(row: StudyRow, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, field);
}

/** A filter only applies to a row that carries its field. A `roman` filter
 *  narrows the chord grain and leaves section/song panels alone, instead of
 *  blanking them for a column they never had. */
export function matchesFilter(row: StudyRow, filter: StudyFilter): boolean {
  if (!hasField(row, filter.field)) return true;
  const raw = rawValue(row, filter.field);
  const asText = displayValue(row, filter.field).toLowerCase();
  switch (filter.op) {
    case "eq":
      return asText === String(filter.value).toLowerCase();
    case "neq":
      return asText !== String(filter.value).toLowerCase();
    case "contains":
      return asText.includes(String(filter.value).toLowerCase());
    case "gt":
      return Number(raw) > Number(filter.value);
    case "lt":
      return Number(raw) < Number(filter.value);
    case "in":
      return Array.isArray(filter.value)
        && filter.value.map((entry) => String(entry).toLowerCase()).includes(asText);
    default:
      return true;
  }
}

export function applyFilters(rows: readonly StudyRow[], filters: readonly StudyFilter[]): StudyRow[] {
  // No copy when nothing is filtered: the board asks five panels for the same
  // 65k rows, and a defensive copy per panel was pure waste. Callers that
  // sort must copy first (`runRows` does).
  if (filters.length === 0) return rows as StudyRow[];
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

export function measureValue(rows: readonly StudyRow[], measure: MeasureDef): number {
  if (measure.kind === "count") return rows.length;
  if (!measure.field) return 0;
  if (measure.kind === "share") {
    if (rows.length === 0) return Number.NaN;
    let hit = 0;
    for (const row of rows) {
      const value = rawValue(row, measure.field);
      if (typeof value === "number" ? value > 0 : !!value) hit += 1;
    }
    return hit / rows.length;
  }
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const value = Number(rawValue(row, measure.field));
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count === 0 ? Number.NaN : sum / count;
}

export interface GroupResult {
  key: string;
  n: number;
  values: Record<string, number>;
  rows: StudyRow[];
}

function resolvedMeasures(panel: PanelSpec): MeasureDef[] {
  return panel.measures
    .map((key) => measureDef(panel.grain, key))
    .filter((measure): measure is MeasureDef => !!measure);
}

export function groupRows(rows: readonly StudyRow[], dimension: string): GroupResult[] {
  const groups = new Map<string, StudyRow[]>();
  for (const row of rows) {
    const key = displayValue(row, dimension);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups].map(([key, groupRowsOut]) => ({ key, n: groupRowsOut.length, values: {}, rows: groupRowsOut }));
}

/** Grouped bars: one row per dimension value, one number per measure. */
export function runBreakdown(
  rows: readonly StudyRow[],
  panel: PanelSpec,
  filters: readonly StudyFilter[],
): GroupResult[] {
  const filtered = applyFilters(rows, filters);
  if (!panel.dimension) return [];
  const measures = resolvedMeasures(panel);
  const groups = groupRows(filtered, panel.dimension);
  // Rank on the first measure, then measure only the groups that survive the
  // limit — grouping by song on the corpus would otherwise measure 5,877
  // groups to show nine.
  const first = measures[0];
  if (first) {
    for (const group of groups) group.values[first.key] = measureValue(group.rows, first);
  }
  const rest = measures.slice(1);
  const firstKey = first?.key;
  const score = (group: GroupResult) => {
    const value = firstKey ? group.values[firstKey] : Number.NaN;
    return Number.isFinite(value) ? value! : Number.NEGATIVE_INFINITY;
  };
  groups.sort((a, b) => {
    const delta = score(b) - score(a);
    if (Number.isFinite(delta) && Math.abs(delta) > 1e-9) return delta;
    return b.n - a.n || a.key.localeCompare(b.key);
  });
  const kept = groups.slice(0, panel.limit ?? 12);
  for (const group of kept) {
    for (const measure of rest) group.values[measure.key] = measureValue(group.rows, measure);
  }
  return kept;
}

export interface MatrixResult {
  rowKeys: string[];
  colKeys: string[];
  /** cells[rowIndex][colIndex] — raw counts. */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  total: number;
}

const MATRIX_AXIS = 8;

/** Two dimensions at once: the transition matrix, role × form, key × meter — */
export function runMatrix(
  rows: readonly StudyRow[],
  panel: PanelSpec,
  filters: readonly StudyFilter[],
): MatrixResult {
  const filtered = applyFilters(rows, filters);
  const rowField = panel.row;
  const colField = panel.col;
  if (!rowField || !colField) {
    return { rowKeys: [], colKeys: [], cells: [], rowTotals: [], colTotals: [], total: filtered.length };
  }
  const counts = new Map<string, Map<string, number>>();
  const rowTotalsMap = new Map<string, number>();
  const colTotalsMap = new Map<string, number>();
  for (const row of filtered) {
    const rowKey = displayValue(row, rowField);
    const colKey = displayValue(row, colField);
    rowTotalsMap.set(rowKey, (rowTotalsMap.get(rowKey) ?? 0) + 1);
    colTotalsMap.set(colKey, (colTotalsMap.get(colKey) ?? 0) + 1);
    const byCol = counts.get(rowKey) ?? new Map<string, number>();
    byCol.set(colKey, (byCol.get(colKey) ?? 0) + 1);
    counts.set(rowKey, byCol);
  }
  const top = (totals: Map<string, number>) =>
    [...totals]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MATRIX_AXIS)
      .map(([key]) => key);
  const rowKeys = top(rowTotalsMap);
  const colKeys = top(colTotalsMap);
  const cells = rowKeys.map((rowKey) =>
    colKeys.map((colKey) => counts.get(rowKey)?.get(colKey) ?? 0),
  );
  return {
    rowKeys,
    colKeys,
    cells,
    rowTotals: rowKeys.map((key) => rowTotalsMap.get(key) ?? 0),
    colTotals: colKeys.map((key) => colTotalsMap.get(key) ?? 0),
    total: filtered.length,
  };
}

export interface DistributionBucket {
  label: string;
  count: number;
}

export interface DistributionResult {
  buckets: DistributionBucket[];
  numeric: boolean;
  min?: number;
  max?: number;
}

const BINS = 9;

/** One field's shape — the fastest way to notice "this corpus is bimodal". */
export function runDistribution(
  rows: readonly StudyRow[],
  panel: PanelSpec,
  filters: readonly StudyFilter[],
): DistributionResult {
  const filtered = applyFilters(rows, filters);
  const field = panel.dimension;
  if (!field) return { buckets: [], numeric: false };
  const missing = (value: unknown) =>
    value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
  const present = filtered.filter((row) => !missing(rawValue(row, field)));
  if (present.length === 0) return { buckets: [], numeric: false };
  const values = present.map((row) => rawValue(row, field));
  const numeric = values.every((value) => typeof value === "number" && Number.isFinite(value));
  if (!numeric) {
    const counts = new Map<string, number>();
    for (const row of present) {
      const key = displayValue(row, field);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const buckets = [...counts]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, panel.limit ?? 12)
      .map(([label, count]) => ({ label, count }));
    return { buckets, numeric: false };
  }
  const numbers = values as number[];
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min || 1;
  // "Nice" bin width (1 · 2 · 5 × 10ⁿ) so the axis reads 2–4 · 4–6 · 6–8
  // instead of fractional ranges that round into each other.
  const raw = span / BINS;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(min / step) * step;
  const bucketCount = Math.max(1, Math.ceil((max - start) / step));
  const edge = (value: number) => (Number.isInteger(step) ? String(Math.round(value)) : value.toFixed(step < 0.1 ? 2 : 1));
  const buckets: DistributionBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    label: `${edge(start + index * step)}–${edge(start + (index + 1) * step)}`,
    count: 0,
  }));
  for (const value of numbers) {
    if (!Number.isFinite(value)) continue;
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((value - start) / step)));
    buckets[index]!.count += 1;
  }
  return { buckets, numeric: true, min, max };
}

/** The rows themselves, for drilling. Sorted by the first measure's field when
 *  it is a real column, so "the longest sections" are the first ones listed. */
export function runRows(
  rows: readonly StudyRow[],
  panel: PanelSpec,
  filters: readonly StudyFilter[],
): StudyRow[] {
  const filtered = applyFilters(rows, filters);
  const first = resolvedMeasures(panel)[0];
  const field = first?.kind === "mean" ? first.field : undefined;
  // `applyFilters` may hand back the dataset array itself; sort a copy.
  const ordered = field ? [...filtered] : filtered;
  if (field) {
    const score = (row: StudyRow) => {
      const value = Number(rowValue(row, field));
      return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
    };
    ordered.sort((a, b) => score(b) - score(a));
  }
  return ordered.slice(0, panel.limit ?? 40);
}
