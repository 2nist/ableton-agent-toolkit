import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { NOTE_TO_PC } from "@music-theory/core";
import type { NoteName, ScaleType } from "@music-theory/core";
import { resolveChordOccurrences, resolveStyleProfile, styleSpacing } from "@drum/library";
import { useSongStore } from "../../store/songStore";
import { useStudioSelectionStore } from "../../store/studioSelectionStore";
import { useHarmonySelectionStore } from "../../store/harmonySelectionStore";
import { useTimeSelectionStore } from "../../store/timeSelectionStore";
import { sectionSpans, type SectionSpan } from "../../lib/arrangement";
import { updateSection } from "../../lib/sections";
import { roleStyle } from "../../lib/roleColors";
import { drumFamilyLabel, resolveSectionVoiceNecklaces } from "../../lib/playback/drumPreview";
import { getSongTransport, type TransportTick } from "../../lib/playback/songTransport";
import DrumLineEmbed from "./DrumLineEmbed";
import { useInspectorStore } from "../../store/inspectorStore";
import { playSectionLoop, seekTo } from "../../lib/playback/transportControl";
import IconBtn from "../common/IconBtn";
import Icon from "../common/Icon";
import ProgressionTrack from "../harmony/ProgressionTrack";
import HexReadout from "../harmony/HexReadout";
import BassSettings from "../harmony/BassSettings";
import ColorSettings from "../harmony/ColorSettings";
import LyricsEditor from "../lyrics/LyricsEditor";
import NecklaceRow from "../drums/NecklaceRow";
import MelodyStaff from "../melody/MelodyStaff";
import MelodyGenerateBar from "../melody/MelodyGenerateBar";
import MelodyNoteEditor from "../melody/MelodyNoteEditor";
import { useWriteMelodyNotes } from "../../hooks/useWriteMelodyNotes";
import { SectionGridProvider } from "./layers/LayerGrid";
import SectionTimeRuler from "./layers/SectionTimeRuler";
import DrumFace from "./layers/DrumFace";
import HarmonyFace from "./layers/HarmonyFace";
import MelodyFace from "./layers/MelodyFace";
import LyricsFace from "./layers/LyricsFace";
import { beatsPerBar } from "../../types/blueprint";
import type { BlueprintSection, BlueprintSong, Chord, SectionRole } from "../../types/blueprint";

/** Canonical role order for the header's role menu (same list everywhere). */
const ROLE_OPTIONS: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

/**
 * The Workbench — first slice of the new workspace (docs/design/workspace.md).
 *
 * Bands: zones row (library rail · section workspace · inspector rail).
 * The spine is shell chrome now (mounted by SongEditorLayout above every
 * song route — P2). Layout grammar (user decision, 2026-09-21): LEFT =
 * Library (the sources) · CENTER = the canvas · RIGHT = the contextual
 * INSPECTOR (the focused object's facets; it slides open on engagement
 * and collapses to a strip) · NO BOTTOM band (the old stub/dock role is
 * retired; wide surfaces belong to the canvas itself).
 *
 * Deliberately transitional: element rows jump to the existing editor tabs
 * (?section=) until P3 embeds them in place; the legacy nav tabs live
 * above until P4 retires them (the header transport already folded into
 * the spine's strip in P2).
 */
export default function WorkbenchView() {
  const currentSong = useSongStore((s) => s.currentSong());
  const navigate = useNavigate();
  const selectedSectionId = useStudioSelectionStore((s) => s.selectedSectionId);
  const setSelectedSectionId = useStudioSelectionStore((s) => s.setSelectedSectionId);
  const [tick, setTick] = useState<TransportTick | null>(null);

  useEffect(() => getSongTransport().onTick(setTick), []);

  const song = currentSong;
  const spans = useMemo(() => (song ? sectionSpans(song) : []), [song]);

  // A direct route (or a reload) can land here with no section selected;
  // the workspace falls back to the first span, so make that real in the
  // shared selection too — the inspector, bend overrides and MCP tools all
  // read the same id.
  useEffect(() => {
    if (!song || spans.length === 0) return;
    if (spans.some((span) => span.sectionId === selectedSectionId)) return;
    setSelectedSectionId(spans[0]!.sectionId);
  }, [song, spans, selectedSectionId, setSelectedSectionId]);

  // The ladder's first navigation step: ←→ walks sections. Ignored while
  // typing / interacting with form controls (the bend rail's selects, the
  // song browser) so those stay usable.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (spans.length === 0) return;
      e.preventDefault();
      const idx = Math.max(0, spans.findIndex((sp) => sp.sectionId === selectedSectionId));
      const next = Math.max(0, Math.min(spans.length - 1, idx + (e.key === "ArrowRight" ? 1 : -1)));
      setSelectedSectionId(spans[next].sectionId);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spans, selectedSectionId, setSelectedSectionId]);

  if (!song) {
    return (
      <div className="p-4">
        <p className="text-inkMuted">Song not found.</p>
        <button className="text-accent text-sm mt-2" onClick={() => navigate("/")}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const activeIndex = spans.length === 0 ? -1 : Math.max(0, spans.findIndex((sp) => sp.sectionId === selectedSectionId));
  const activeSpan = activeIndex >= 0 ? spans[activeIndex] : null;
  const isLive = activeSpan != null && tick?.isPlaying === true && tick.sectionIndex === activeIndex;
  const beatInSection = isLive && tick && activeSpan ? tick.beat - activeSpan.startBeat : null;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* The section workspace is the CANVAS — the library (left) and the
          inspector (right) are shell chrome around it since slice C, and
          the spine band above mounts in SongEditorLayout too. */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-3">
          {activeSpan ? (
            <SectionWorkspace
              song={song}
              span={activeSpan}
              index={activeIndex}
              count={spans.length}
              isLive={isLive}
              beatInSection={beatInSection}
              onEngageDrums={() => useInspectorStore.getState().engage("drums")}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-inkMuted text-sm">This song has no sections yet — add the first one on the spine above, then pick it here.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/** One element row — title, hint, jump-open, collapsible body (state is
 *  owned by the workspace and persisted), centered content. Module scope
 *  so the transport-tick re-renders don't remount the content (same
 *  lesson as StudioConsole's Pane). */
function ElementRow({
  title,
  hint,
  onOpen,
  collapsed = false,
  onToggle,
  face,
  children,
}: {
  title: string;
  hint: string;
  onOpen: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
  face?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-edge rounded-lg bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-2.5 py-1.5 border-b border-edge/70">
        {onToggle && (
          <button
            type="button"
            className="w-4 h-4 shrink-0 flex items-center justify-center text-inkMuted hover:text-ink"
            onClick={onToggle}
            title={collapsed ? "Expand this element" : "Collapse this element"}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
          </button>
        )}
        <span className="text-3xs font-mono uppercase tracking-widest text-inkMuted">{title}</span>
        <span className="text-[9px] font-mono text-inkMuted/50 truncate flex-1" title={hint}>
          {hint}
        </span>
        <button
          className="shrink-0 text-[9px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-1.5 py-0.5"
          onClick={onOpen}
          title={`Open the ${title.toLowerCase()} editor for this section`}
        >
          open →
        </button>
      </header>
      {face && <div className="pt-1.5">{face}</div>}
      {!collapsed && (
        <div className={`p-2.5 flex items-center justify-center ${face ? "pt-2" : ""}`}>{children}</div>
      )}
    </section>
  );
}

/** Clicking the drum line view engages the inspector's ▦ Drums facet —
 *  the thing you touched becomes the thing you edit. */
type SectionWorkspaceProps = {
  song: BlueprintSong;
  span: SectionSpan;
  index: number;
  count: number;
  isLive: boolean;
  beatInSection: number | null;
  onEngageDrums?: () => void;
};

function SectionWorkspace({
  song,
  span,
  index,
  count,
  isLive,
  beatInSection,
  onEngageDrums,
}: SectionWorkspaceProps) {
  const navigate = useNavigate();
  const { songId } = useParams<{ songId: string }>();
  const id = songId ?? song.id;
  const section: BlueprintSection = span.section;
  const role = roleStyle(section.role);
  const rawKey = section.key ?? song.key;
  const effKey: NoteName = rawKey in NOTE_TO_PC ? (rawKey as NoteName) : "C";
  const effScale: ScaleType = section.scale ?? song.scale;
  const jump = (tab: string) => navigate(`/song/${id}/${tab}?section=${section.id}`);
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const clockSource = useSongStore((s) => s.clockSource);
  const undo = useSongStore((s) => s.undo);
  const canUndo = useSongStore((s) => s.canUndo());
  const writeMelodyNotes = useWriteMelodyNotes();
  const [melodyMode, setMelodyMode] = useState<"staff" | "notes">("staff");
  const selectedChordId = useHarmonySelectionStore((s) => s.selectedChordId);
  const setSelectedChordId = useHarmonySelectionStore((s) => s.setSelectedChordId);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [roleMenu, setRoleMenu] = useState<{ x: number; y: number } | null>(null);
  const roleMenuRef = useRef<HTMLDivElement>(null);
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("trackdraft-workbench-rows") || "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });

  // Dismiss the role menu on outside click / Esc (same pattern as the
  // spine's context palette).
  useEffect(() => {
    if (!roleMenu) return;
    const onDown = (e: MouseEvent) => {
      if (roleMenuRef.current && roleMenuRef.current.contains(e.target as Node)) return;
      setRoleMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRoleMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [roleMenu]);

  /** Chord writes from the embedded progression strip — the same
   *  updateSection path the harmony editor uses, so the spine's chords
   *  lane, playback and the rail's Fit readout all follow immediately. */
  function updateChords(chords: Chord[]) {
    updateCurrentSong((s) => updateSection(s, section.id, (sec) => ({ ...sec, chords })));
  }

  function updateSingleChord(chordId: string, update: Partial<Chord>) {
    updateCurrentSong((s) =>
      updateSection(s, section.id, (sec) => ({
        ...sec,
        chords: sec.chords.map((c) => (c.id === chordId ? { ...c, ...update } : c)),
      })),
    );
  }

  function selectChord(chordId: string) {
    setSelectedChordId(chordId);
    useInspectorStore.getState().engage("harmony");
  }

  /** In-place header basics (the P3 depth pass): rename · bars · role —
   *  each a single undo step, no trip to the inspector for the obvious. */
  function commitName() {
    setRenaming(false);
    const next = nameDraft.trim();
    if (!next || next === section.name) return;
    updateCurrentSong((s) => updateSection(s, section.id, (sec) => ({ ...sec, name: next })));
  }

  function bumpBars(delta: number) {
    const next = Math.max(1, Math.round(span.bars) + delta);
    if (next === Math.round(span.bars)) return;
    updateCurrentSong((s) => updateSection(s, section.id, (sec) => ({ ...sec, bars: next })));
  }

  function setRole(next: SectionRole) {
    setRoleMenu(null);
    if (next === section.role) return;
    updateCurrentSong((s) => updateSection(s, section.id, (sec) => ({ ...sec, role: next })));
  }

  function toggleRow(rowId: string) {
    setCollapsedRows((c) => {
      const next = { ...c, [rowId]: !c[rowId] };
      try {
        localStorage.setItem("trackdraft-workbench-rows", JSON.stringify(next));
      } catch {
        /* collapse state is a nicety, not data — storage full/blocked is fine to ignore */
      }
      return next;
    });
  }

  const activeChordId = useMemo(() => {
    if (beatInSection == null) return null;
    const profile = resolveStyleProfile(section, song);
    const occurrences = resolveChordOccurrences(section, span.durationBeats, styleSpacing(profile.density));
    let active: string | null = null;
    for (let i = occurrences.length - 1; i >= 0; i--) {
      if (occurrences[i].startTime <= beatInSection) {
        active = occurrences[i].chord.id;
        break;
      }
    }
    return active;
  }, [section, song, span.durationBeats, beatInSection]);

  const necklaces = useMemo(
    () => resolveSectionVoiceNecklaces(section, song, span.occurrenceIndex),
    [section, song, span.occurrenceIndex],
  );
  const melody = section.melody?.notes?.length
    ? [...section.melody.notes].sort((a, b) => a.startTime - b.startTime)
    : null;

  const bass = section.bassProfile;
  const bassBits = bass
    ? [bass.motion, bass.rhythm, bass.octave != null ? `oct ${bass.octave}` : null, bass.velocity != null ? `vel ${bass.velocity}` : null]
        .filter(Boolean)
        .join(" · ")
    : null;
  const lyricLines = (section.lyrics ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  const bpb = beatsPerBar(section);
  const sectionSelection = useTimeSelectionStore((s) =>
    s.selection && s.selection.sectionId === section.id ? s.selection : null,
  );
  const clearSelection = useTimeSelectionStore((s) => s.clearSelection);
  const selectionStartBar = sectionSelection ? Math.floor(sectionSelection.startBeat / bpb) + 1 : 0;
  const selectionEndBar = sectionSelection
    ? Math.max(selectionStartBar, Math.ceil(sectionSelection.endBeat / bpb))
    : 0;

  function seekInSection(beat: number) {
    void seekTo(song, clockSource, span.startBeat + beat);
  }

  return (
    <div className="space-y-2 w-full">
      {/* Section header — you are HERE, and since the depth pass the basics
          live right here: rename (click the name), bars (−/+), role (the
          dot) — single undo steps each; the ≣ facet is for detail. Tagged
          data-section-header: the spine's grow animation flies the clicked
          block's clone into this rect. */}
      <div className="flex items-center gap-2 px-1" data-section-header>
        <button
          type="button"
          className="w-3.5 h-3.5 rounded-[3px] shrink-0 border border-transparent hover:border-inkMuted/60"
          style={{ background: role.bg, boxShadow: `0 0 0 1px ${role.text}55` }}
          title={`${role.label} — click to change the role`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setRoleMenu({ x: r.left, y: r.bottom + 4 });
          }}
        />
        {renaming ? (
          <input
            autoFocus
            className="text-sm font-medium bg-panelAlt border border-edge rounded px-1.5 py-0.5 w-56 text-ink"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              else if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commitName}
            aria-label="Section name"
          />
        ) : (
          <h2
            className="text-sm font-medium text-ink truncate cursor-text hover:text-accent/90"
            title="Click to rename"
            onClick={() => {
              setNameDraft(section.name);
              setRenaming(true);
            }}
          >
            {section.name}
          </h2>
        )}
        <div className="flex items-center gap-0.5 shrink-0" title="Section length — one undo step per click">
          <button
            type="button"
            className="w-4 h-4 flex items-center justify-center rounded border border-edge/70 text-inkMuted hover:text-ink text-[10px] leading-none"
            onClick={() => bumpBars(-1)}
            title="One bar shorter"
          >
            −
          </button>
          <span className="text-[10px] font-mono text-inkMuted/70 tabular-nums w-[46px] text-center">{Math.round(span.bars)} bars</span>
          <button
            type="button"
            className="w-4 h-4 flex items-center justify-center rounded border border-edge/70 text-inkMuted hover:text-ink text-[10px] leading-none"
            onClick={() => bumpBars(1)}
            title="One bar longer"
          >
            +
          </button>
        </div>
        <span className="text-[10px] font-mono text-inkMuted/40 tabular-nums">block {index + 1}/{count}</span>
        {sectionSelection && (
          <span className="flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-mono tabular-nums text-accent/90">
            {selectionStartBar === selectionEndBar
              ? `bar ${selectionStartBar}`
              : `bars ${selectionStartBar}–${selectionEndBar}`}
            <button
              type="button"
              className="text-accent/60 hover:text-accent"
              onClick={clearSelection}
              title="Clear the time selection"
              aria-label="Clear time selection"
            >
              ✕
            </button>
          </span>
        )}
        {isLive && (
          <span className="text-[9px] font-mono text-accent animate-pulse" title="Following the playhead">
            ● now playing
          </span>
        )}
        <span className="flex-1" />
        {/* Section-level actions live with the section (P3): loop auditions
            this section through the SAME transport path the spine's ⟳
            uses, so the two can't drift. Disabled under Ableton's clock,
            which owns position. */}
        <IconBtn
          icon="loop"
          title={`Loop "${section.name}" — audition it while you edit (the spine's loop lights up)`}
          disabled={clockSource === "ableton"}
          onClick={() => void playSectionLoop(song, section.id)}
        />
        <span className="text-[9px] font-mono text-inkMuted/40" title="Navigation grammar: ←→ walks sections anywhere in the workbench">
          ←→ sections
        </span>
      </div>

      {/* Role menu — the dot opens the same role list every other picker
          uses, each chip a miniature section block (role colour + label). */}
      {roleMenu && (
        <div
          ref={roleMenuRef}
          className="fixed z-50 rounded border border-edge bg-panel shadow-lg p-1.5 flex flex-wrap gap-1 max-w-[230px]"
          style={{ left: roleMenu.x, top: roleMenu.y }}
        >
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={`h-[22px] px-2 rounded-sm text-[10px] font-mono tracking-wide hover:brightness-125 ${
                r === section.role ? "ring-1 ring-accent" : ""
              }`}
              style={{ background: roleStyle(r).bg, color: roleStyle(r).text }}
              onClick={() => setRole(r)}
              title={`Make this section a ${roleStyle(r).label}`}
            >
              {roleStyle(r).label}
            </button>
          ))}
        </div>
      )}

      <SectionGridProvider
        sectionId={section.id}
        bars={span.bars}
        beatsPerBar={bpb}
        durationBeats={span.durationBeats}
        playheadBeat={beatInSection}
        onSeek={seekInSection}
      >
        <div className="space-y-2">
          <SectionTimeRuler />

      {/* Drums — the clock, with the classic line view as the broad face:
          the whole arrangement cropped to this section + context, so its
          transitions in/out and detours are in view; clicks dive to the
          beat-by-beat Blocks editor on the clicked range. */}
      <ElementRow
        title="Drums"
        hint={drumFamilyLabel(section, song)}
        onOpen={() => jump("drums")}
        collapsed={collapsedRows.drums}
        onToggle={() => toggleRow("drums")}
        face={
          <DrumFace
            section={section}
            song={song}
            occurrenceIndex={span.occurrenceIndex}
            onOpen={() => jump("drums")}
            onEngage={onEngageDrums}
          />
        }
      >
        <div className="w-full space-y-2">
          <DrumLineEmbed song={song} span={span} onEngage={onEngageDrums} />
          {necklaces ? (
            <NecklaceRow necklaces={necklaces} />
          ) : (
            <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">
              {section.drumPattern === "none"
                ? "Muted — no kit on this section."
                : "No resolvable groove yet — author one in the drums editor."}
            </p>
          )}
        </div>
      </ElementRow>

      {/* Bass — the real controls inline (P3 slice 3): register · motion ·
          rhythm · velocity, writing the same per-section `bassProfile`
          that the MIDI export and Send to Ableton plan from. */}
      <ElementRow title="Bass" hint={bassBits ?? "auto — follows the chords"} onOpen={() => jump("harmony")} collapsed={collapsedRows.bass} onToggle={() => toggleRow("bass")}>
        <div className="w-full">
          <BassSettings
            section={section}
            onChange={(updater) => updateCurrentSong((s) => updateSection(s, section.id, updater))}
          />
        </div>
      </ElementRow>

      {/* Chords — the wheel readout plus the REAL progression strip, live
          and editable in place (the drums-row template: embed the actual
          canvas, never a preview). Cell edits write the same updateSection
          path the harmony editor uses, so the spine lane and playback
          follow immediately; clicking a chord selects it and engages the
          ♪ facet — the thing you touched becomes the thing you edit. The
          header's open → still dives to the wheel. */}
      <ElementRow
        title="Chords"
        hint={section.chords.length ? `${section.chords.length} chords · ${effKey}` : "no chords yet"}
        onOpen={() => jump("harmony")}
        collapsed={collapsedRows.chords}
        onToggle={() => toggleRow("chords")}
        face={
          <HarmonyFace
            section={section}
            keyName={effKey}
            selectedChordId={selectedChordId}
            activeChordId={activeChordId}
            onSelectChord={selectChord}
            onOpen={() => jump("harmony")}
          />
        }
      >
        {section.chords.length > 0 ? (
          <div className="w-full">
            <HexReadout chords={section.chords} keyName={effKey} activeChordId={activeChordId} />
            <div className="mt-2 rounded border border-edge/60 bg-[#0a0d12] px-2 py-1.5 overflow-x-auto">
              <ProgressionTrack
                key={section.id}
                section={section}
                keyName={effKey}
                scale={effScale}
                selectedChordId={selectedChordId}
                activeChordId={activeChordId}
                onSelectChord={selectChord}
                onChangeChords={updateChords}
                onUpdateChord={updateSingleChord}
              />
            </div>
          </div>
        ) : (
          <p className="text-2xs text-inkMuted/60 italic font-mono text-center px-2">No chords yet — add a progression in the harmony editor.</p>
        )}
      </ElementRow>

      {/* Color — flavor chips + register, inline (the same settings the ♪
          Layers facet hosts); writes `colorFlavor` / `colorOctave`. */}
      <ElementRow title="Color" hint={`register oct ${section.colorOctave ?? 6}`} onOpen={() => jump("harmony")} collapsed={collapsedRows.color} onToggle={() => toggleRow("color")}>
        <div className="w-full">
          <ColorSettings
            section={section}
            onChange={(updater) => updateCurrentSong((s) => updateSection(s, section.id, updater))}
          />
        </div>
      </ElementRow>

      {/* Melody */}
      <ElementRow
        title="Melody"
        hint={melody ? `${melody.length} note${melody.length === 1 ? "" : "s"}` : "not recorded"}
        onOpen={() => jump("melody")}
        collapsed={collapsedRows.melody}
        onToggle={() => toggleRow("melody")}
        face={<MelodyFace section={section} onOpen={() => jump("melody")} />}
      >
        <div className="w-full space-y-2">
          <MelodyGenerateBar song={song} section={section} sectionId={section.id} compact />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1 border border-edge rounded p-0.5">
              <button
                type="button"
                className={`text-[10px] px-1.5 py-0.5 rounded ${melodyMode === "staff" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
                onClick={() => setMelodyMode("staff")}
                title="Read the line as notation"
              >
                Staff
              </button>
              <button
                type="button"
                className={`text-[10px] px-1.5 py-0.5 rounded ${melodyMode === "notes" ? "bg-accent text-black" : "text-inkMuted hover:text-ink"}`}
                onClick={() => setMelodyMode("notes")}
                title={`Edit "${section.name}"'s notes right here — tap the grid to add, drag to move, drag an edge to resize`}
              >
                ✎ Notes
              </button>
            </div>
            {melodyMode === "notes" && (
              <span className="text-[9px] font-mono text-inkMuted/60">
                tap to add · drag to move · edge = length · vel lane
              </span>
            )}
          </div>
          {melodyMode === "notes" ? (
            <MelodyNoteEditor
              notes={melody ?? []}
              sectionBeats={span.durationBeats}
              beatsPerBar={bpb}
              keyName={effKey}
              scale={effScale}
              maxHeight={260}
              onChange={(next) => writeMelodyNotes(section.id, next)}
              onUndo={undo}
              canUndo={canUndo}
            />
          ) : melody ? (
            <div className="w-full">
              <MelodyStaff
                notes={melody}
                sectionBeats={span.durationBeats}
                songKey={effKey}
                scale={effScale}
                height={128}
                activeBeat={beatInSection}
                onSeekBeat={(beat) => void seekTo(song, clockSource, span.startBeat + beat)}
              />
            </div>
          ) : (
            <div className="text-center px-2 space-y-1.5">
              <p className="text-2xs text-inkMuted/60 italic font-mono">No melody yet — auto-fill from the corpus or hum one in the melody workspace.</p>
              <button
                type="button"
                className="text-[10px] font-mono text-accent/80 hover:text-accent border border-edge/70 rounded px-2 py-0.5"
                onClick={() => jump("melody")}
                title={`Open the melody workspace on "${section.name}" — press ● Record there to hum this section`}
              >
                ● Record…
              </button>
            </div>
          )}
        </div>
      </ElementRow>

      {/* Lyrics — pinned last: the annotation layer, and since P3 slice 2
          the pad itself, live and editable in place (the chords-row
          template — the real editor, not a preview). Writes the same
          updateSection path the Lyrics view uses, so the syllable
          gutter, the song-text view and the coverage gauge all follow
          immediately; the header's open → still dives to the view for
          the metrical/rhyme tools. */}
      <ElementRow
        title="Lyrics"
        hint={lyricLines.length ? `${lyricLines.length} line${lyricLines.length === 1 ? "" : "s"}` : "not written"}
        onOpen={() => jump("lyrics")}
        collapsed={collapsedRows.lyrics}
        onToggle={() => toggleRow("lyrics")}
        face={<LyricsFace section={section} onOpen={() => jump("lyrics")} />}
      >
        <div className="w-full">
          <LyricsEditor
            value={section.lyrics ?? ""}
            onChange={(lyrics) =>
              updateCurrentSong((s) => updateSection(s, section.id, (sec) => ({ ...sec, lyrics })))
            }
          />
        </div>
      </ElementRow>
        </div>
      </SectionGridProvider>
    </div>
  );
}
