import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { BlueprintSong, DrumTransitionModel, SectionRole } from "../../types/blueprint";
import { beatsPerBar } from "../../types/blueprint";
import type { NoteName } from "@music-theory/core";
import { NOTE_TO_PC, pitchClass } from "@music-theory/core";
import { chordDisplayName } from "../../lib/harmony/chordBuilder";
import HexReadout from "../harmony/HexReadout";
import { useRoleStyle } from "../../lib/roleColors";
import {
  buildLyricDocument,
  assignLinesToSection,
  mergeLinesIntoSection,
  splitSectionAt,
  unassignLines,
  updateLineText,
  detectRepeatedBlocks,
} from "../../lib/lyrics/sectionize";
import { buildSongTextModel, UNASSIGNED_NAME, type SongTextBlock, type SongTextLine, type SongTextModel } from "../../lib/lyrics/songTextRows";
import { playbackPosFor, samePlayPos, type SongTextPlayPos } from "../../lib/lyrics/songTextPlayback";
import { repeatsFor, updateRepeats, updateSection } from "../../lib/sections";
import { sectionSpans, type SectionSpan } from "../../lib/arrangement";
import { getSongTransport } from "../../lib/playback/songTransport";
import { planSectionTransitions } from "@drum/library";
import { velocityNumber } from "../../lib/playback/drumPreview";
import { useTransitionColors, TRANSITION_LABEL, TRANSITION_MODELS } from "../drums/transitionStyle";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { useInspectorStore, type InspectorTab } from "../../store/inspectorStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";

const ROLES: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

const INSTRUMENTAL_LABEL: Partial<Record<SectionRole, string>> = {
  solo: "🎸 Instrumental solo",
  breakdown: "🎵 Instrumental breakdown",
  intro: "🎬 Instrumental intro",
  outro: "🎬 Instrumental outro",
};

/** Auto-transition plans per section, keyed by the section's FIRST pass —
 *  the same role-driven planner the drum timeline renders ("build up INTO
 *  choruses, break down out of verses, drop out of bridges, cut into
 *  outros"), so a block's chip here matches what export will play. A manual
 *  `drumTransitionModel` always wins; the chip shows which one is active. */
function useAutoTransitions(spans: SectionSpan[]) {
  return useMemo(() => {
    const plans = planSectionTransitions(
      spans.map((sp) => ({
        sectionId: sp.sectionId,
        occurrenceIndex: sp.occurrenceIndex,
        role: sp.section.role ?? null,
        durationBeats: sp.durationBeats,
        beatsPerBar: beatsPerBar(sp.section),
        velocityTarget: velocityNumber(sp.section.velocity),
        manualModel: sp.section.drumTransitionModel != null,
        hasVariation: sp.section.drumVariationOutline != null,
      })),
    );
    const bySection = new Map<string, { model: DrumTransitionModel | null; bars: number }>();
    spans.forEach((sp, i) => {
      if (!bySection.has(sp.sectionId)) bySection.set(sp.sectionId, { model: plans[i].model, bars: plans[i].bars });
    });
    return bySection;
  }, [spans]);
}

interface LyricDocumentViewProps {
  song: BlueprintSong;
  onChange: (updater: (song: BlueprintSong) => BlueprintSong) => void;
}

/**
 * The Lyrics view's "Song text" mode — the whole song's words as one flow
 * of section blocks, built for getting the SECTIONS right: carve a block
 * out of the words, label it, set how many times it plays, split it where
 * the boundary is wrong, park lines that don't fit yet.
 *
 * Every row's selection index is a TRUE document index (songTextRows.ts —
 * the index-contract fix; the old display-order numbering acted on the
 * wrong lines whenever an instrumental placeholder or the hidden
 * "Unassigned" tray sat above a row). Blocks render in canonical document
 * order, so what the highlight shows is exactly what the ops move.
 *
 * The block header carries the systems the sections feed, one click away:
 * ♪ the hex (read-only walk + chord chips; clicking a chord selects it and
 * opens the ♪ facet), the transition chip (manual or the role-driven auto
 * plan — set/clear without leaving the words), and the repeats stepper
 * (arrangement form: chorus ×2). Parked lines show in place as a dashed
 * tray — nothing ever disappears.
 */
export default function LyricDocumentView({ song, onChange }: LyricDocumentViewProps) {
  const roleStyle = useRoleStyle();
  const TRANSITION_COLOR = useTransitionColors();
  const navigate = useNavigate();
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);

  const docLines = useMemo(() => buildLyricDocument(song), [song]);
  const model = useMemo(() => buildSongTextModel(song), [song]);
  const repeatedBlocks = useMemo(() => detectRepeatedBlocks(docLines), [docLines]);
  const spans = useMemo(() => sectionSpans(song), [song]);
  const autoTransitions = useAutoTransitions(spans);

  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [selMode, setSelMode] = useState<"idle" | "active">("idle");
  const dragAnchor = useRef<number | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const [addRole, setAddRole] = useState<SectionRole>("verse");
  const [addName, setAddName] = useState("");
  const [openHex, setOpenHex] = useState<Set<string>>(new Set());
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [editingLineKey, setEditingLineKey] = useState<string | null>(null);
  const [lineDraft, setLineDraft] = useState("");
  const [popover, setPopover] = useState<{ kind: "role" | "transition"; sectionId: string; x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── playhead follow ───────────────────────────────────────────────
  // The track (the spine's transport — on this route like every other)
  // drives the words: the playing block lights with its pass, the current
  // line highlights + scrolls into view, and the block's authored
  // progression shows as a live chord mini (looping exactly as playback/
  // export will sound it). Ticks arrive at 60fps — derive the minimal
  // play position and only set state when it actually changed.
  const [playPos, setPlayPos] = useState<SongTextPlayPos | null>(null);
  const followCtx = useRef<{ song: BlueprintSong; spans: SectionSpan[]; model: SongTextModel } | null>(null);
  followCtx.current = { song, spans, model };
  useEffect(() => {
    const transport = getSongTransport();
    return transport.onTick((tick) => {
      const ctx = followCtx.current;
      if (!ctx) return;
      const next = playbackPosFor(ctx.song, ctx.spans, ctx.model, tick);
      setPlayPos((prev) => (samePlayPos(prev, next) ? prev : next));
    });
  }, []);
  const playLineRef = useRef<HTMLDivElement | null>(null);
  const setPlayLineEl = useCallback((el: HTMLDivElement | null) => {
    playLineRef.current = el;
  }, []);
  useEffect(() => {
    if (!playPos?.playing || selMode === "active") return;
    playLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll on position changes only
  }, [playPos?.sectionId, playPos?.lineIdx, playPos?.playing, selMode]);

  function clearSelection() {
    setRange(null);
    setSelMode("idle");
    dragAnchor.current = null;
    setMoveTargetId("");
  }

  function selectSection(sectionId: string, facet: InspectorTab = "lyrics") {
    setSelectedSectionId(sectionId);
    useInspectorStore.getState().engage(facet);
  }

  function startRange(docIndex: number, sectionId: string) {
    dragAnchor.current = docIndex;
    setRange({ start: docIndex, end: docIndex });
    setSelMode("active");
    selectSection(sectionId);
  }
  function extendRange(docIndex: number) {
    if (selMode !== "active" || dragAnchor.current == null) return;
    const a = dragAnchor.current;
    setRange({ start: Math.min(a, docIndex), end: Math.max(a, docIndex) });
  }
  // A release anywhere ends the drag; the highlight stays until an op or ✕.
  useEffect(() => {
    function handleMouseUp() {
      setSelMode("idle");
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // ── selection operations (all in TRUE document space) ─────────────
  function handleMoveToSection() {
    if (!range || !moveTargetId) return;
    onChange((s) => mergeLinesIntoSection(s, buildLyricDocument(s), range, moveTargetId));
    clearSelection();
  }
  function handleAddSection() {
    if (!range) return;
    const name = addName.trim() || addRole.charAt(0).toUpperCase() + addRole.slice(1);
    onChange((s) => assignLinesToSection(s, buildLyricDocument(s), range, { role: addRole, name }));
    clearSelection();
  }
  function handleSplitAtSelection() {
    if (!range) return;
    const line = docLines[range.start];
    if (!line) return;
    onChange((s) => splitSectionAt(s, buildLyricDocument(s), line.sectionId, line.lineIndexInSection));
    clearSelection();
  }
  function handleUnassign() {
    if (!range) return;
    onChange((s) => unassignLines(s, buildLyricDocument(s), range));
    clearSelection();
  }
  function applyBlockAsChorus(occurrences: { start: number; end: number }[], baseName: string) {
    onChange((s) => {
      let current = s;
      occurrences.forEach((occ, i) => {
        current = assignLinesToSection(current, buildLyricDocument(current), occ, {
          role: "chorus",
          name: occurrences.length > 1 ? `${baseName} ${i + 1}` : baseName,
        });
      });
      return current;
    });
  }

  // ── block header writes ───────────────────────────────────────────
  function commitName(sectionId: string) {
    const name = nameDraft.trim();
    setEditingNameId(null);
    if (!name) return;
    onChange((s) => updateSection(s, sectionId, (sec) => (sec.name === name ? sec : { ...sec, name })));
  }
  function bumpRepeats(sectionId: string, delta: number) {
    onChange((s) => updateRepeats(s, sectionId, repeatsFor(s, sectionId) + delta));
  }
  function setRole(sectionId: string, role: SectionRole) {
    onChange((s) => updateSection(s, sectionId, (sec) => (sec.role === role ? sec : { ...sec, role })));
    setPopover(null);
  }
  function setTransitionModel(sectionId: string, model: DrumTransitionModel | null) {
    onChange((s) =>
      updateSection(s, sectionId, (sec) => ({
        ...sec,
        drumTransitionModel: model ?? undefined,
        drumTransitionBars: model ? (sec.drumTransitionBars ?? 1) : undefined,
      })),
    );
  }
  function setTransitionBars(sectionId: string, bars: number) {
    const clamped = Math.max(1, Math.min(2, bars));
    onChange((s) => updateSection(s, sectionId, (sec) => ({ ...sec, drumTransitionBars: clamped })));
  }
  function openDrumsTools(sectionId: string) {
    selectSection(sectionId, "drums");
    setPopover(null);
  }

  // Popover dismissal (same pattern as the workbench's role menu).
  useEffect(() => {
    if (!popover) return;
    const onDown = (e: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return;
      setPopover(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [popover]);

  function beginLineEdit(row: SongTextLine) {
    setEditingLineKey(`${row.line.sectionId}:${row.line.lineIndexInSection}`);
    setLineDraft(row.line.text);
  }
  function commitLineEdit(row: SongTextLine, text: string) {
    setEditingLineKey(null);
    if (text === row.line.text) return;
    onChange((s) => updateLineText(s, row.line, text));
  }

  const selectedCount = range ? range.end - range.start + 1 : 0;
  const namedSections = song.sections.filter((s) => s.name !== UNASSIGNED_NAME);

  return (
    <div className="space-y-2">
      {repeatedBlocks.length > 0 && (
        <div className="border border-edge rounded bg-panel p-2 space-y-1">
          <p className="text-[10px] text-inkMuted uppercase tracking-wide">Repeated lines detected</p>
          {repeatedBlocks.slice(0, 3).map((block, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-inkMuted truncate">
                &ldquo;{block.normalizedText.split("\n")[0]}&hellip;&rdquo; &times; {block.occurrences.length}
              </span>
              <button
                className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt whitespace-nowrap"
                onClick={() => applyBlockAsChorus(block.occurrences, "Chorus")}
              >
                Mark as Chorus
              </button>
            </div>
          ))}
        </div>
      )}

      {range != null && (
        <div className="flex items-center gap-1.5 flex-wrap border border-edge rounded bg-panel px-2 py-1.5">
          <span className="text-[10px] text-inkMuted">
            {selectedCount} line{selectedCount === 1 ? "" : "s"} &rarr;
          </span>
          <select
            className="bg-panelAlt border border-edge rounded text-[10px] px-1.5 py-0.5"
            value={moveTargetId}
            onChange={(e) => setMoveTargetId(e.target.value)}
          >
            <option value="">Move to…</option>
            {namedSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink disabled:opacity-30"
            disabled={!moveTargetId}
            onClick={handleMoveToSection}
          >
            Move
          </button>
          <span className="text-[10px] text-inkMuted mx-0.5">|</span>
          <select
            className="bg-panelAlt border border-edge rounded text-[10px] px-1.5 py-0.5"
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as SectionRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleStyle(r).label}
              </option>
            ))}
          </select>
          <input
            className="bg-panelAlt border border-edge rounded text-[10px] px-1.5 py-0.5 w-28"
            placeholder="Name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddSection();
            }}
          />
          <button className="text-[10px] bg-accent text-accentInk rounded px-2 py-0.5 font-medium" onClick={handleAddSection}>
            Add Section
          </button>
          <span className="text-[10px] text-inkMuted mx-0.5">|</span>
          <button
            className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink"
            title="Split the section so the first selected line starts a new one"
            onClick={handleSplitAtSelection}
          >
            Split
          </button>
          <button
            className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink"
            title="Park these lines in the Unassigned tray"
            onClick={handleUnassign}
          >
            Unassign
          </button>
          <button className="text-[10px] text-inkMuted hover:text-ink px-1" onClick={clearSelection}>
            ✕
          </button>
        </div>
      )}

      {/* The document — blocks in canonical order, indices true to the ops */}
      <div className="border border-edge rounded bg-panel p-2 font-mono text-sm leading-relaxed max-h-[60vh] overflow-y-auto select-none space-y-2">
        {model.blocks.map((block) => (
          <SongTextBlockView
            key={block.section.id}
            block={block}
            song={song}
            auto={autoTransitions.get(block.section.id) ?? null}
            play={playPos?.sectionId === block.section.id ? playPos : null}
            onPlayLineRef={setPlayLineEl}
            range={range}
            editingNameId={editingNameId}
            nameDraft={nameDraft}
            editingLineKey={editingLineKey}
            lineDraft={lineDraft}
            hexOpen={openHex.has(block.section.id)}
            onToggleHex={() => {
              selectSection(block.section.id);
              setOpenHex((prev) => {
                const next = new Set(prev);
                if (next.has(block.section.id)) next.delete(block.section.id);
                else next.add(block.section.id);
                return next;
              });
            }}
            onOpenRoleMenu={(x, y) => {
              selectSection(block.section.id, "structure");
              setPopover({ kind: "role", sectionId: block.section.id, x, y });
            }}
            onOpenTransitionMenu={(x, y) => {
              selectSection(block.section.id);
              setPopover({ kind: "transition", sectionId: block.section.id, x, y });
            }}
            onNameDraft={setNameDraft}
            onBeginNameEdit={(sectionId) => {
              selectSection(sectionId);
              setEditingNameId(sectionId);
            }}
            onCommitName={commitName}
            onCancelNameEdit={() => setEditingNameId(null)}
            onBumpRepeats={bumpRepeats}
            onStartRange={startRange}
            onExtendRange={extendRange}
            onBeginLineEdit={beginLineEdit}
            onLineDraft={setLineDraft}
            onCommitLineEdit={commitLineEdit}
            onCancelLineEdit={() => setEditingLineKey(null)}
            onSplitAt={(sectionId, lineIndex) => onChange((s) => splitSectionAt(s, buildLyricDocument(s), sectionId, lineIndex))}
            onChordClick={(sectionId, chordId) => {
              setSelectedSectionId(sectionId);
              setSelectedChordId(chordId);
              useInspectorStore.getState().engage("harmony");
            }}
            onOpenHarmony={() => {
              selectSection(block.section.id);
              navigate(`/song/${song.id}/harmony`);
            }}
          />
        ))}
        {model.blocks.length === 0 && (
          <p className="text-inkMuted text-xs p-2 italic">No sections yet — add one on the spine above.</p>
        )}
        {model.blocks.length > 0 && model.docLineCount === 0 && (
          <p className="text-inkMuted text-xs p-2 italic">
            No lyric lines yet — write them in “Per-section” mode, then come back to shape the form.
          </p>
        )}
      </div>

      {/* Role menu — fixed, dismissed on outside click / Esc */}
      {popover && popover.kind === "role" && (
        <div
          ref={popoverRef}
          className="fixed z-50 rounded border border-edge bg-panel shadow-lg p-1.5 flex flex-wrap gap-1 max-w-[230px]"
          style={{ left: popover.x, top: popover.y }}
        >
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className={`h-[22px] px-2 rounded-sm text-[10px] font-mono tracking-wide hover:brightness-125 ${
                r === song.sections.find((s) => s.id === popover.sectionId)?.role ? "ring-1 ring-accent" : ""
              }`}
              style={{ background: roleStyle(r).bg, color: roleStyle(r).text }}
              onClick={() => setRole(popover.sectionId, r)}
              title={`Make this section a ${roleStyle(r).label}`}
            >
              {roleStyle(r).label}
            </button>
          ))}
        </div>
      )}
      {popover && popover.kind === "transition" && (
        <div ref={popoverRef}>
          <TransitionPopover
            song={song}
            sectionId={popover.sectionId}
            auto={autoTransitions.get(popover.sectionId) ?? null}
            x={popover.x}
            y={popover.y}
            onSetModel={setTransitionModel}
            onSetBars={setTransitionBars}
            onOpenDrums={openDrumsTools}
          />
        </div>
      )}
    </div>
  );
}

/* ── transition popover ─────────────────────────────────────────────── */

interface TransitionPopoverProps {
  song: BlueprintSong;
  sectionId: string;
  auto: { model: DrumTransitionModel | null; bars: number } | null;
  x: number;
  y: number;
  onSetModel: (sectionId: string, model: DrumTransitionModel | null) => void;
  onSetBars: (sectionId: string, bars: number) => void;
  onOpenDrums: (sectionId: string) => void;
}

function TransitionPopover({ song, sectionId, auto, x, y, onSetModel, onSetBars, onOpenDrums }: TransitionPopoverProps) {
  const TRANSITION_COLOR = useTransitionColors();
  const section = song.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  const manual = section.drumTransitionModel ?? null;
  const manualBars = section.drumTransitionBars ?? 1;

  return (
    <div className="fixed z-50 w-48 rounded border border-edge bg-panel shadow-lg p-2 space-y-1.5" style={{ left: x, top: y }}>
      <div className="text-[9px] uppercase tracking-wide text-inkMuted">Ending gesture</div>
      <button
        type="button"
        className={`w-full text-left text-[10px] px-1.5 py-1 rounded border ${
          manual === null ? "border-accent text-accent" : "border-edge text-inkMuted hover:text-ink"
        }`}
        onClick={() => onSetModel(sectionId, null)}
        title="Let the role-driven planner decide (builds into a chorus, breaks out of a verse, drops out of a bridge…)"
      >
        Auto {auto?.model ? `— ${TRANSITION_LABEL[auto.model]}` : "— clean handoff"}
      </button>
      {TRANSITION_MODELS.map((m) => (
        <button
          key={m}
          type="button"
          className={`w-full text-left text-[10px] px-1.5 py-1 rounded border ${
            manual === m ? "border-edge bg-panelAlt" : "border-edge/60 hover:bg-panelAlt"
          }`}
          style={{ color: TRANSITION_COLOR[m] }}
          onClick={() => onSetModel(sectionId, m)}
        >
          {TRANSITION_LABEL[m]}
          {manual === m ? " ✓" : ""}
        </button>
      ))}
      {manual !== null && (
        <div className="flex items-center gap-1 text-[10px] text-inkMuted">
          <span>over last</span>
          <button className="px-1 border border-edge rounded hover:text-ink" onClick={() => onSetBars(sectionId, manualBars - 1)}>
            −
          </button>
          <span className="font-mono">{manualBars}</span>
          <button className="px-1 border border-edge rounded hover:text-ink" onClick={() => onSetBars(sectionId, manualBars + 1)}>
            ＋
          </button>
          <span>bar{manualBars === 1 ? "" : "s"}</span>
        </div>
      )}
      <button
        type="button"
        className="w-full text-left text-[10px] text-inkMuted hover:text-ink border-t border-edge/60 pt-1.5"
        onClick={() => onOpenDrums(sectionId)}
        title="Pattern · Detour · Transition tools for this section in the right rail"
      >
        Open drum tools &rarr;
      </button>
    </div>
  );
}

/* ── one section block ──────────────────────────────────────────────── */

interface SongTextBlockViewProps {
  block: SongTextBlock;
  song: BlueprintSong;
  auto: { model: DrumTransitionModel | null; bars: number } | null;
  play: SongTextPlayPos | null;
  onPlayLineRef: (el: HTMLDivElement | null) => void;
  range: { start: number; end: number } | null;
  editingNameId: string | null;
  nameDraft: string;
  editingLineKey: string | null;
  lineDraft: string;
  hexOpen: boolean;
  onToggleHex: () => void;
  onOpenRoleMenu: (x: number, y: number) => void;
  onOpenTransitionMenu: (x: number, y: number) => void;
  onNameDraft: (v: string) => void;
  onBeginNameEdit: (sectionId: string) => void;
  onCommitName: (sectionId: string) => void;
  onCancelNameEdit: () => void;
  onBumpRepeats: (sectionId: string, delta: number) => void;
  onStartRange: (docIndex: number, sectionId: string) => void;
  onExtendRange: (docIndex: number) => void;
  onBeginLineEdit: (row: SongTextLine) => void;
  onLineDraft: (v: string) => void;
  onCommitLineEdit: (row: SongTextLine, text: string) => void;
  onCancelLineEdit: () => void;
  onSplitAt: (sectionId: string, lineIndex: number) => void;
  onChordClick: (sectionId: string, chordId: string) => void;
  onOpenHarmony: () => void;
}

function SongTextBlockView(props: SongTextBlockViewProps) {
  const roleStyle = useRoleStyle();
  const TRANSITION_COLOR = useTransitionColors();
  const { block, song } = props;
  const section = block.section;
  const r = roleStyle(section.role);
  const manual = section.drumTransitionModel ?? null;
  const shownModel = manual ?? props.auto?.model ?? null;
  const shownBars = manual !== null ? (section.drumTransitionBars ?? 1) : (props.auto?.bars ?? 1);
  const rawKey = section.key ?? song.key;
  const effKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const isUnassigned = block.kind === "unassigned";
  const isPlayingBlock = props.play !== null;
  const meter = `${section.timeSignatureNumerator}/${2 ** section.timeSignatureDenPower}`;

  return (
    <div
      className={`rounded border ${
        isPlayingBlock ? "border-accent/50" : isUnassigned ? "border-dashed border-warn/40" : "border-edge/70"
      }`}
    >
      {/* header */}
      <div className="relative flex items-center gap-2 px-2 py-1 bg-panelAlt/40 border-b border-edge/40 rounded-t flex-wrap">
        <button
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: r.bg, boxShadow: `0 0 0 1px ${r.text}22` }}
          title={`Role: ${r.label} — click to change`}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            props.onOpenRoleMenu(rect.left, rect.bottom + 4);
          }}
        />
        {props.editingNameId === section.id ? (
          <input
            autoFocus
            className="bg-panel border border-edge rounded px-1.5 py-0.5 text-xs w-40"
            value={props.nameDraft}
            onChange={(e) => props.onNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onCommitName(section.id);
              if (e.key === "Escape") props.onCancelNameEdit();
            }}
            onBlur={() => props.onCommitName(section.id)}
          />
        ) : (
          <button
            className="hand-value text-xs font-semibold text-ink truncate hover:text-accent"
            title="Click to rename — this section also follows into the right rail's tools"
            onClick={() => props.onBeginNameEdit(section.id)}
          >
            {section.name}
          </button>
        )}
        {props.play && (
          <span
            className="text-[9px] font-mono px-1 py-0.5 rounded border border-accent/50 text-accent whitespace-nowrap"
            title={props.play.playing ? "Playing now" : "Playhead paused here — press play to resume"}
          >
            {props.play.playing ? "▶" : "⏸"}
            {props.play.passCount > 1 ? ` ${props.play.occurrenceIndex + 1}/${props.play.passCount}` : ""}
          </span>
        )}
        {block.kind === "instrumental" && <span className="text-[9px] px-1 rounded border border-edge text-inkMuted/70">instrumental</span>}
        {isUnassigned && <span className="text-[9px] px-1 rounded border border-dashed border-warn/40 text-warn/80">parked</span>}
        <span className="text-2xs text-inkMuted font-mono">
          {section.bars} bars · {section.beatsPerChord}/chord · {meter}
        </span>
        <span className="flex-1" />
        {/* repeats stepper — arrangement form right where the words are */}
        <div
          className="flex items-center gap-0.5"
          title="How many times this section plays in a row — ×2 is a chorus that comes back; 0 skips it without deleting"
        >
          <button className="text-inkMuted hover:text-ink px-1 text-xs" onClick={() => props.onBumpRepeats(section.id, -1)}>
            −
          </button>
          <span className={`text-2xs font-mono ${block.repeats === 0 ? "text-warn" : "text-inkMuted"}`}>&times;{block.repeats}</span>
          <button className="text-inkMuted hover:text-ink px-1 text-xs" onClick={() => props.onBumpRepeats(section.id, +1)}>
            ＋
          </button>
        </div>
        {/* chord mini — the chord sounding right now, as playback loops the
            section's authored progression */}
        {props.play?.chordLabel && (
          <button
            className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-accent/60 text-accent hover:bg-accent/10 whitespace-nowrap"
            title="Sounding now — click to open this chord's harmony tools"
            onClick={() => {
              if (props.play?.chordId) props.onChordClick(section.id, props.play.chordId);
            }}
          >
            {props.play.chordLabel}
          </button>
        )}
        {/* harmony (hex) disclosure */}
        <button
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
            props.hexOpen ? "border-accent/60 text-accent" : "border-edge text-inkMuted hover:text-ink"
          }`}
          title="Show this section's harmony — the hex walk and its chords"
          onClick={props.onToggleHex}
        >
          ♪ {section.chords.length}
        </button>
        {/* transition chip — manual (solid) or role-driven auto (dashed) */}
        <button
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
            manual !== null ? "border-edge" : "border-dashed border-edge/70"
          } ${shownModel ? "" : "opacity-60"}`}
          style={shownModel ? { color: TRANSITION_COLOR[shownModel] } : undefined}
          title={
            manual !== null
              ? `Manual ending gesture — ${TRANSITION_LABEL[manual]} over the last ${shownBars} bar${shownBars === 1 ? "" : "s"}. Click to change.`
              : shownModel
                ? `Auto (role-driven) — ${TRANSITION_LABEL[shownModel]}; click to override or open the drum tools.`
                : "Clean handoff — no gesture planned; click to set one."
          }
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            props.onOpenTransitionMenu(rect.left, rect.bottom + 4);
          }}
        >
          {shownModel ? `${TRANSITION_LABEL[shownModel]}${shownBars > 1 ? ` ${shownBars}b` : ""}${manual !== null ? "" : " · auto"}` : "clean"}
        </button>
      </div>

      {/* harmony disclosure — the hex readout + real chord chips */}
      {props.hexOpen && (
        <div className="px-2 py-1.5 border-b border-edge/40 bg-panel/60">
          {section.chords.length > 0 ? (
            <div className="flex items-start gap-3 flex-wrap">
              <div className="w-40 shrink-0">
                <HexReadout chords={section.chords} keyName={effKey} activeChordId={props.play?.chordId ?? null} />
              </div>
              <div className="flex-1 min-w-[200px] space-y-1">
                <div className="flex flex-wrap gap-1">
                  {section.chords.map((c) => (
                    <button
                      key={c.id}
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        props.play?.chordId === c.id
                          ? "border-accent/60 text-accent"
                          : "border-edge text-inkMuted hover:text-ink hover:border-accent/60"
                      }`}
                      title="Select this chord and open the harmony tools"
                      onClick={() => props.onChordClick(section.id, c.id)}
                    >
                      {c.romanNumeral}
                      <span className="text-inkMuted/50"> · {chordDisplayName(pitchClass(c.root), c.quality, effKey)}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[9px] text-inkMuted/60 font-sans">
                  {section.chords.length} chord{section.chords.length === 1 ? "" : "s"} · {harmonicRhythmNote(section.chords.length, section.bars)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px] font-sans text-inkMuted">
              <span className="italic">No chords yet for “{section.name}”.</span>
              <button className="border border-edge rounded px-2 py-0.5 hover:text-ink" onClick={props.onOpenHarmony}>
                Open Harmony &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {/* body */}
      {block.kind === "instrumental" ? (
        <div className="px-2 py-1 italic opacity-60 text-[11px]" style={{ color: r.text }}>
          &mdash; {INSTRUMENTAL_LABEL[section.role] ?? `Instrumental ${section.role}`} &mdash;
        </div>
      ) : (
        <div className="pb-0.5">
          {block.lines.map((row, i) => {
            const isSelected = props.range != null && row.docIndex >= props.range.start && row.docIndex <= props.range.end;
            const isPlayLine = props.play != null && props.play.lineIdx === i;
            const lineKey = `${row.line.sectionId}:${row.line.lineIndexInSection}`;
            return (
              <div key={row.docIndex}>
                {i > 0 && block.kind === "lyric" && (
                  <SplitHandle label={row.line.text || "(blank line)"} onSplit={() => props.onSplitAt(section.id, row.line.lineIndexInSection)} />
                )}
                <div
                  ref={isPlayLine ? props.onPlayLineRef : undefined}
                  className={`relative px-2 py-0.5 flex items-center gap-2 ${
                    isSelected ? "bg-accent/20" : isPlayLine ? "bg-accent/10" : "hover:bg-panelAlt cursor-pointer"
                  }`}
                  onMouseDown={() => props.onStartRange(row.docIndex, section.id)}
                  onMouseEnter={() => props.onExtendRange(row.docIndex)}
                  onDoubleClick={() => props.onBeginLineEdit(row)}
                  title="Click-drag to select lines · double-click to fix the text"
                >
                  {isPlayLine && (
                    <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${props.play?.playing ? "bg-accent" : "bg-accent/40"}`} />
                  )}
                  {props.editingLineKey === lineKey ? (
                    <input
                      autoFocus
                      className="bg-panel border border-edge rounded px-1.5 py-0.5 text-xs flex-1 font-mono"
                      value={props.lineDraft}
                      onChange={(e) => props.onLineDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") props.onCommitLineEdit(row, props.lineDraft);
                        if (e.key === "Escape") props.onCancelLineEdit();
                      }}
                      onBlur={() => props.onCommitLineEdit(row, props.lineDraft)}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className={row.line.text.trim().length === 0 ? "text-inkMuted" : "text-ink"}>{row.line.text || "\u00A0"}</span>
                  )}
                </div>
              </div>
            );
          })}
          {isUnassigned && block.lines.length > 0 && (
            <p className="px-2 pb-1 text-[9px] font-sans text-warn/70 italic">
              Parked — select lines and Move, or Add Section, to file them into the form.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function harmonicRhythmNote(count: number, bars: number): string {
  if (bars <= 0 || count === 0) return "";
  const perBar = count / bars;
  if (perBar >= 1.75) return "busy harmony — a change every bar or more often";
  if (perBar >= 0.75) return "about one change per bar";
  return "slow harmony — under one change per bar";
}

/** The hover divider between two lines of the same block: click to split
 *  the section so the line below starts a new one. Invisible until hovered
 *  so the word flow stays clean. */
function SplitHandle({ label, onSplit }: { label: string; onSplit: () => void }) {
  return (
    <button
      type="button"
      className="block w-full h-2 relative opacity-0 hover:opacity-100 focus:opacity-100"
      title={`Split here — “${label.slice(0, 40)}” starts a new section`}
      onClick={(e) => {
        e.stopPropagation();
        onSplit();
      }}
    >
      <span className="absolute left-3 right-3 top-1/2 border-t border-dashed border-accent/60" />
      <span className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 bg-panel px-1 text-[9px] text-accent font-sans">✂ split</span>
    </button>
  );
}
