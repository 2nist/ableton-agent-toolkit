import { useMemo } from "react";
import { meanBeatsPerBar, type BlueprintSection, type BlueprintSong } from "../../../types/blueprint";
import { analyzeSection } from "../../../lib/harmony/analysis";
import { sectionView } from "../../../lib/harmony/sectionView";
import { repeatsFor } from "../../../lib/sections";

/**
 * Several sections read side by side.
 *
 * The Study desk answers "what is this progression doing?" for one section.
 * This answers the question the arrangement actually raises — *do these
 * sections share material, and where do they differ?* — which is why the
 * numeral matrix sits above the per-section numbers: seeing `♭VII` in every
 * chorus and nowhere else is the finding, and it is invisible one section at
 * a time.
 */

export interface SectionComparisonProps {
  song: BlueprintSong;
  sections: readonly BlueprintSection[];
  onFocus: (sectionId: string) => void;
}

export default function SectionComparison({ song, sections, onFocus }: SectionComparisonProps) {
  const columns = useMemo(
    () =>
      sections.map((section) => {
        const view = sectionView(song, section);
        const analysis = analyzeSection(section.chords, {
          key: view.keyName,
          scale: view.scale,
          regions: view.regions,
          beatsPerBar: meanBeatsPerBar(section),
        });
        const numerals = analysis.events.map((event) => event.roman);
        const peakTension = analysis.curve.length ? Math.max(...analysis.curve) : 0;
        return {
          section,
          view,
          analysis,
          numerals,
          counts: numerals.reduce((map, numeral) => map.set(numeral, (map.get(numeral) ?? 0) + 1), new Map<string, number>()),
          /** First-appearance order, deduped — the progression's shape, not
           *  every event (a 77-bar section would print 87 chips). */
          distinct: [...new Set(numerals)],
          peakTension,
          repeats: repeatsFor(song, section.id),
          chords: section.chords.length,
        };
      }),
    [song, sections],
  );

  /** Every numeral in the selection, ordered by how many sections use it. */
  const vocabulary = useMemo(() => {
    const seen = new Map<string, number[]>();
    columns.forEach((column, index) => {
      for (const numeral of column.counts.keys()) {
        const list = seen.get(numeral) ?? [];
        if (!list.includes(index)) list.push(index);
        seen.set(numeral, list);
      }
    });
    return [...seen.entries()]
      .map(([numeral, usedBy]) => ({ numeral, usedBy }))
      .sort((left, right) => right.usedBy.length - left.usedBy.length || left.numeral.localeCompare(right.numeral));
  }, [columns]);

  const sharedByAll = columns.length > 1;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded border border-edge bg-panel">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-panel px-2 py-1 text-left text-[9px] uppercase tracking-wider text-inkMuted/60">
                section
              </th>
              {columns.map((column, index) => (
                <th key={column.section.id} className="min-w-[130px] border-l border-edge/40 px-2 py-1 text-left align-bottom">
                  <button
                    type="button"
                    onClick={() => onFocus(column.section.id)}
                    className="font-semibold text-ink hover:text-accent"
                    title="Focus this section"
                  >
                    {index + 1}. {column.section.name}
                  </button>
                  <span className="ml-1 text-inkMuted/50">
                    {column.section.timeSignatureNumerator}/{2 ** column.section.timeSignatureDenPower}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-edge/40">
              <td className="sticky left-0 z-10 bg-panel px-2 py-1 text-inkMuted/60">bars × plays</td>
              {columns.map((column) => (
                <td key={column.section.id} className="border-l border-edge/40 px-2 py-1 tabular-nums">
                  {Math.round(column.section.bars)} ×{column.repeats}
                  <span className="text-inkMuted/50"> · {Math.round(column.section.bars * column.repeats)}</span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-edge/40">
              <td className="sticky left-0 z-10 bg-panel px-2 py-1 text-inkMuted/60">chords</td>
              {columns.map((column) => (
                <td key={column.section.id} className="border-l border-edge/40 px-2 py-1 tabular-nums">
                  {column.chords}
                </td>
              ))}
            </tr>
            <tr className="border-t border-edge/40">
              <td className="sticky left-0 z-10 bg-panel px-2 py-1 text-inkMuted/60">borrowed · applied</td>
              {columns.map((column) => (
                <td key={column.section.id} className="border-l border-edge/40 px-2 py-1 tabular-nums">
                  <span className={column.analysis.stats.borrowedCount > 0 ? "text-danger" : "text-inkMuted/50"}>
                    {column.analysis.stats.borrowedCount}
                  </span>
                  <span className="text-inkMuted/40"> · </span>
                  <span className={column.analysis.stats.appliedCount > 0 ? "text-accent" : "text-inkMuted/50"}>
                    {column.analysis.stats.appliedCount}
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-edge/40">
              <td className="sticky left-0 z-10 bg-panel px-2 py-1 text-inkMuted/60">tension avg · peak</td>
              {columns.map((column) => (
                <td key={column.section.id} className="border-l border-edge/40 px-2 py-1">
                  <span className="tabular-nums">{column.analysis.stats.averageTension.toFixed(2)}</span>
                  <span className="text-inkMuted/50"> · </span>
                  <span className={`tabular-nums ${column.peakTension > 0.6 ? "text-danger" : ""}`}>
                    {column.peakTension.toFixed(2)}
                  </span>
                  <span className="ml-1 inline-block h-1 w-10 overflow-hidden rounded bg-well align-middle">
                    <span
                      className="block h-full bg-accent"
                      style={{ width: `${Math.round(column.analysis.stats.averageTension * 100)}%` }}
                    />
                  </span>
                </td>
              ))}
            </tr>
            <tr className="border-t border-edge/40">
              <td className="sticky left-0 z-10 bg-panel px-2 py-1 text-inkMuted/60">cadences</td>
              {columns.map((column) => (
                <td key={column.section.id} className="border-l border-edge/40 px-2 py-1">
                  {column.analysis.cadences.length === 0 ? (
                    <span className="text-inkMuted/50">—</span>
                  ) : (
                    column.analysis.cadences
                      .slice(0, 4)
                      .map((cadence) => `${cadence.from}→${cadence.to}`)
                      .join("  ")
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-t border-edge/40">
              <td className="sticky left-0 z-10 bg-panel px-2 py-1 align-top text-inkMuted/60">numerals</td>
              {columns.map((column) => (
                <td
                  key={column.section.id}
                  className="border-l border-edge/40 px-2 py-1"
                  title={column.numerals.join(" ")}
                >
                  <span className="flex flex-wrap gap-1">
                    {column.distinct.map((numeral) => (
                      <span
                        key={numeral}
                        className="rounded border border-edge/60 px-1 text-[9px] leading-4 text-inkMuted"
                      >
                        {numeral}
                      </span>
                    ))}
                  </span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="rounded border border-edge bg-panel">
        <div className="flex items-center gap-2 border-b border-edge px-2 py-1 font-mono text-[9px] text-inkMuted/70">
          <span className="uppercase tracking-wider text-inkMuted">Shared vocabulary</span>
          <span className="text-inkMuted/60">
            {vocabulary.length} numerals across {columns.length} sections
          </span>
          {sharedByAll && (
            <span className="ml-auto text-inkMuted/50">
              ● = used by every section
            </span>
          )}
        </div>
        <div className="max-h-[260px] overflow-auto px-2 py-1">
          <table className="w-full border-collapse font-mono text-[10px]">
            <thead>
              <tr className="text-[9px] uppercase tracking-wider text-inkMuted/50">
                <th className="w-[28%] px-0 py-0.5 text-left font-normal">numeral</th>
                {columns.map((column, index) => (
                  <th
                    key={column.section.id}
                    className="px-0 py-0.5 text-center font-normal"
                    title={column.section.name}
                  >
                    {index + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vocabulary.map(({ numeral, usedBy }) => (
                <tr key={numeral} className="border-b border-edge/20 last:border-b-0">
                  <td className="py-0.5 pr-2 text-ink">
                    {usedBy.length === columns.length && columns.length > 1 ? "● " : ""}
                    {numeral}
                  </td>
                  {columns.map((column, index) => (
                    <td key={column.section.id} className="w-8 py-0.5 text-center">
                      {usedBy.includes(index) ? (
                        <span
                          className={column.counts.get(numeral)! > 1 ? "text-accent" : "text-inkMuted"}
                          title={`${numeral} ×${column.counts.get(numeral)}`}
                        >
                          {column.counts.get(numeral) === 1 ? "·" : `×${column.counts.get(numeral)}`}
                        </span>
                      ) : (
                        <span className="text-inkMuted/20">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
