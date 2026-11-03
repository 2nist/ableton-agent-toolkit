import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PolyColumn, { type PolyColumnActions } from "./PolyColumn";
import {
  arrangeSections,
  laneGeometry,
  nodesInView,
  polyContentScale,
} from "../../lib/poly/layout";
import { DEFAULT_LANE_ORDER } from "../../lib/poly/layout";
import { sectionSpans } from "../../lib/arrangement";
import { useRoleStyle } from "../../lib/roleColors";
import { LOD_TIERS, stickyLodIndex } from "../../lib/poly/lod";
import { synthesiseSong } from "../../lib/poly/perfSong";
import {
  frameDeltas,
  summariseFrames,
  sweepCamera,
  type FrameSummary,
} from "../../lib/poly/perfProbe";
import { visibleWorldRect, type PolyCamera } from "../../lib/poly/camera";

/**
 * Spike S3 — the canvas at scale, measured rather than assumed.
 *
 * A synthetic song (64 sections, all six lanes full) is rendered through the
 * real `PolyColumn` with the real layout, and a scripted camera pans the whole
 * arrangement and zooms out and back while frame deltas are collected. Nothing
 * here writes to a song: the sections come from `synthesiseSong` and every
 * column action is a no-op, so the spike cannot corrupt the open project.
 *
 * Dev-only route (`/perf`). The number it prints is what the ledger records.
 */

const RUN_MS = 5000;
/**
 * Frames before this are not recorded (§S1.11).
 *
 * A 5 s window that starts on the same click that mounts 64 columns measures the
 * MOUNT, not the canvas: React inserting ~20k nodes, the first style/layout pass,
 * and JIT warm-up all land in the first few hundred milliseconds and drag p50,
 * max and fps with them. That is how a 1.4 fps reading was recorded for a canvas
 * whose steady state is ~17 ms. Warm-up is discarded, and the reason is printed
 * with the result so nobody compares a run against a differently-sized window.
 */
const WARMUP_MS = 1000;

export default function PolyPerfLab() {
  const roleStyle = useRoleStyle();
  const lanes = useMemo(() => laneGeometry(DEFAULT_LANE_ORDER), []);
  const [count, setCount] = useState(64);
  const [culling, setCulling] = useState(true);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<FrameSummary | null>(null);
  /** How many of the run's frames were drawn at each LOD (§S1.11). Without this
   *  a run cannot be compared with another: the sweep zoom decides the LOD, so
   *  a wider song spends its run zoomed out and looks "faster" for a reason that
   *  has nothing to do with the number of columns. */
  const [lodFrames, setLodFrames] = useState<Record<string, number> | null>(
    null,
  );
  const [progress, setProgress] = useState(0);

  const song = useMemo(() => synthesiseSong(count), [count]);
  const layout = useMemo(
    () =>
      arrangeSections(sectionSpans(song), {
        bpm: song.bpm,
        key: song.key,
        scale: song.scale,
      }),
    [song],
  );

  const stageRef = useRef<HTMLDivElement | null>(null);
  /** How many columns the last frame actually drew — read by the log line
   *  without making the run callback depend on the culling result. */
  const drawnRef = useRef(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<PolyCamera>({ x: 0, y: 0, zoom: 0.5 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const world = useMemo(
    () => ({
      x: layout.bounds.x,
      y: layout.bounds.y,
      w: layout.bounds.w,
      h: layout.bounds.h,
    }),
    [layout],
  );

  const run = useCallback(() => {
    if (viewport.width === 0) return;
    setRunning(true);
    setSummary(null);
    setLodFrames(null);
    const perLod: Record<string, number> = {};
    const samples: number[] = [];
    const start = performance.now();
    let first = true;

    const step = (now: number) => {
      const steady = now - start > WARMUP_MS;
      samples.push(now);
      // The delta just measured is the cost of the frame rendered at whatever
      // LOD was current when it began — which is the lod still in the ref.
      if (!first && steady)
        perLod[lodRef.current] = (perLod[lodRef.current] ?? 0) + 1;
      first = false;
      const t = Math.min(1, (now - start) / RUN_MS);
      setProgress(t);
      setCamera(sweepCamera(t, world, viewport));
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      const result = summariseFrames(frameDeltas(samples, WARMUP_MS));
      setSummary(result);
      setLodFrames(perLod);
      setRunning(false);
      // One line, so a run can be pasted straight into a note.
      console.info("[poly-perf]", {
        sections: count,
        culling,
        columnsDrawn: drawnRef.current,
        lodFrames: perLod,
        warmupMs: WARMUP_MS,
        ...result,
      });
    };
    requestAnimationFrame(step);
  }, [culling, count, viewport, world]);

  const [lodIndex, setLodIndex] = useState(() =>
    stickyLodIndex(camera.zoom, 0),
  );
  useEffect(() => {
    setLodIndex((current) => stickyLodIndex(camera.zoom, current));
  }, [camera.zoom]);
  const lod = LOD_TIERS[lodIndex];
  /** Read by the sweep so a run can attribute its frames to a LOD. */
  const lodRef = useRef(lod);
  lodRef.current = lod;
  const inverseZoom = 1 / camera.zoom;
  const contentScale = polyContentScale(
    (layout.nodes[0]?.h ?? 0) * camera.zoom,
  );

  const visible = useMemo(() => {
    if (!culling || viewport.width === 0) return layout.nodes;
    // The same culling the real canvas uses: an on-screen rect plus a margin.
    return nodesInView(
      layout.nodes,
      visibleWorldRect(camera, viewport),
      camera.zoom,
    );
  }, [culling, camera, layout.nodes, viewport]);

  drawnRef.current = visible.length;
  const drawn = visible.length;

  const actions = useMemo<PolyColumnActions>(() => {
    const noop = () => {};
    return {
      select: noop,
      hover: noop,
      beginRename: noop,
      rename: noop,
      cancelRename: noop,
      beginResize: noop,
      beginMove: noop,
      openMenu: noop,
      pickLane: noop,
      pickChord: noop,
      beginChordEdit: noop,
      beginChordMove: noop,
      openChordMenu: noop,
      beginChordResize: noop,
      commitChordEdit: noop,
      cancelChordEdit: noop,
      toggleDrumLane: noop,
      toggleDrumStep: noop,
      beginDrumGate: noop,
      cycleDrumRatchet: noop,
      openStepMenu: noop,
      toggleDrumFlam: noop,
      stepGroove: noop,
      snapClock: noop,
      stepVariant: noop,
      beginNote: noop,
      addNote: noop,
      beginLyric: noop,
      commitLyric: noop,
      cancelLyric: noop,
    };
  }, []);

  const sectionByKey = useMemo(
    () =>
      new Map(
        sectionSpans(song).map((span) => [
          `${span.sectionId}#${span.occurrenceIndex}`,
          span.section,
        ]),
      ),
    [song],
  );

  const transform = `translate(${-camera.x * camera.zoom + viewport.width / 2}px, ${
    -camera.y * camera.zoom + viewport.height / 2
  }px) scale(${camera.zoom})`;

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-panel px-3 py-1.5 font-mono text-[11px]">
        <span className="uppercase tracking-wide text-inkMuted">
          Canvas perf · S3
        </span>
        <label className="flex items-center gap-1">
          sections
          <select
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            className="rounded border border-edge bg-panelAlt px-1 py-0.5"
          >
            {[16, 32, 64, 96].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={culling}
            onChange={(event) => setCulling(event.target.checked)}
          />
          cull to viewport
        </label>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="rounded border border-edge bg-panelAlt px-2 py-0.5 enabled:hover:bg-panel disabled:opacity-40"
        >
          {running ? `running ${Math.round(progress * 100)}%` : "run 5s sweep"}
        </button>
        {summary ? (
          <span className="tabular-nums">
            {summary.frames} frames (warm) · p50 {summary.p50.toFixed(1)} · p95{" "}
            {summary.p95.toFixed(1)} · max {summary.max.toFixed(1)} ms · late{" "}
            {summary.overBudget} ({Math.round(summary.overBudgetShare * 100)}%)
            · {summary.fps.toFixed(1)} fps · {drawn} drawn
            {lodFrames ? (
              <span className="text-inkMuted">
                {" "}
                ·{" "}
                {Object.entries(lodFrames)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, frames]) => `${name} ${frames}`)
                  .join(" / ")}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-inkMuted">
            {layout.nodes.length} columns · {layout.totalBars} bars · {drawn}{" "}
            drawn · lod {lod}
          </span>
        )}
      </div>

      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ contain: "strict" }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform }}
        >
          {visible.map((node) => {
            const section = sectionByKey.get(node.key);
            if (!section) return null;
            return (
              <PolyColumn
                key={node.key}
                node={node}
                placed={false}
                section={section}
                song={song}
                role={roleStyle(node.role)}
                lod={lod}
                lanes={lanes}
                chordLabels="roman"
                inverseZoom={inverseZoom * contentScale}
                selected={false}
                hovered={false}
                editingName={false}
                editingLyric={false}
                selectedNote={null}
                selectedBassNote={null}
                editingChordId={null}
                actions={actions}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
