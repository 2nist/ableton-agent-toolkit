import { useMemo, useState, useEffect } from "react";
import type { BlueprintSong, SectionRole } from "../../types/blueprint";
import {
  buildLyricDocument,
  assignLinesToSection,
  mergeLinesIntoSection,
  splitSectionAt,
  unassignLines,
  detectRepeatedBlocks,
  type LyricLine,
} from "../../lib/lyrics/sectionize";

const ROLE_COLOR: Partial<Record<SectionRole, string>> = {
  verse: "#60a5fa",
  chorus: "#f87171",
  pre_chorus: "#fb923c",
  bridge: "#a78bfa",
  solo: "#34d399",
  intro: "#8a8a92",
  outro: "#8a8a92",
  breakdown: "#facc15",
};

const ROLES: SectionRole[] = ["intro", "verse", "pre_chorus", "chorus", "bridge", "solo", "breakdown", "outro", "custom"];

const INSTRUMENTAL_LABEL: Partial<Record<SectionRole, string>> = {
  solo: "🎸 Instrumental solo",
  breakdown: "🎵 Instrumental breakdown",
  intro: "🎬 Instrumental intro",
  outro: "🎬 Instrumental outro",
};

// Combined row: either a lyric line or an instrumental placeholder
type DisplayRow =
  | { kind: "lyric"; line: LyricLine; docIndex: number }
  | { kind: "placeholder"; sectionId: string; sectionName: string; role: SectionRole };

interface LyricDocumentViewProps {
  song: BlueprintSong;
  onChange: (updater: (song: BlueprintSong) => BlueprintSong) => void;
}

export default function LyricDocumentView({ song, onChange }: LyricDocumentViewProps) {
  const document = useMemo(() => buildLyricDocument(song), [song]);
  const repeatedBlocks = useMemo(() => detectRepeatedBlocks(document), [document]);

  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [selMode, setSelMode] = useState<"idle" | "active">("idle");
  const [moveTargetId, setMoveTargetId] = useState<string>("");
  const [renameTargetId, setRenameTargetId] = useState<string>("");
  const [renameName, setRenameName] = useState("");
  const [addRole, setAddRole] = useState<SectionRole>("verse");
  const [addName, setAddName] = useState("");

  function clearSelection() {
    setRange(null);
    setSelMode("idle");
    setMoveTargetId("");
    setRenameTargetId("");
  }

  function lineMouseDown(index: number) {
    setRange({ start: index, end: index });
    setSelMode("active");
  }
  function lineMouseEnter(index: number) {
    if (selMode === "active" && range) {
      setRange({ start: Math.min(range.start, index), end: Math.max(range.start, index) });
    }
  }
  useEffect(() => {
    function handleMouseUp() { setSelMode("idle"); }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  // ── operations ────────────────────────────────────────────────────
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
  function handleRenameSection() {
    if (!renameTargetId || !renameName.trim()) return;
    onChange((s) => ({ ...s, sections: s.sections.map((sec) => sec.id === renameTargetId ? { ...sec, name: renameName.trim() } : sec) }));
    setRenameTargetId(""); setRenameName("");
  }
  function handleSplitHere() {
    if (!range) return;
    const line = document[range.start];
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
        current = assignLinesToSection(current, buildLyricDocument(current), occ, { role: "chorus", name: occurrences.length > 1 ? `${baseName} ${i + 1}` : baseName });
      });
      return current;
    });
  }

  // ── interleave lyric lines with instrumental placeholders ────────
  const displayRows = useMemo((): DisplayRow[] => {
    const rows: DisplayRow[] = [];
    const seen = new Set<string>();

    // Build section order from arrangement
    const orderedIds = song.arrangement.length > 0
      ? song.arrangement.map((a) => a.sectionId)
      : song.sections.map((s) => s.id);

    // Group lyrics by section
    const bySection = new Map<string, LyricLine[]>();
    document.forEach((l) => {
      const list = bySection.get(l.sectionId) ?? [];
      list.push(l);
      bySection.set(l.sectionId, list);
    });

    for (const id of orderedIds) {
      const sec = song.sections.find((s) => s.id === id);
      if (!sec || sec.name === "Unassigned") continue;
      const lines = bySection.get(id);
      if (lines && lines.length > 0) {
        for (const line of lines) rows.push({ kind: "lyric", line, docIndex: rows.length });
      } else {
        rows.push({ kind: "placeholder", sectionId: sec.id, sectionName: sec.name, role: sec.role });
      }
      seen.add(id);
    }

    // Catch any sections not in arrangement
    for (const sec of song.sections) {
      if (seen.has(sec.id) || sec.name === "Unassigned") continue;
      const lines = bySection.get(sec.id);
      if (lines && lines.length > 0) {
        for (const line of lines) rows.push({ kind: "lyric", line, docIndex: rows.length });
      } else {
        rows.push({ kind: "placeholder", sectionId: sec.id, sectionName: sec.name, role: sec.role });
      }
    }

    return rows;
  }, [document, song.sections, song.arrangement]);

  // Section boundaries in the display list
  const boundaries = useMemo(() => {
    const s = new Set<number>();
    for (let i = 1; i < displayRows.length; i++) {
      const pa = displayRows[i - 1];
      const pb = displayRows[i];
      const idA = pa.kind === "lyric" ? pa.line.sectionId : pa.sectionId;
      const idB = pb.kind === "lyric" ? pb.line.sectionId : pb.sectionId;
      if (idA !== idB) s.add(i);
    }
    return s;
  }, [displayRows]);

  const sections = song.sections.filter((s) => s.name !== "Unassigned");
  const selectedSection = range ? song.sections.find((s) => s.id === document[range.start]?.sectionId) : null;

  return (
    <div className="space-y-2">
      {repeatedBlocks.length > 0 && (
        <div className="border border-edge rounded bg-panel p-2 space-y-1">
          <p className="text-[10px] text-inkMuted uppercase tracking-wide">Repeated lines detected</p>
          {repeatedBlocks.slice(0, 3).map((block, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-inkMuted truncate">&ldquo;{block.normalizedText.split("\n")[0]}&hellip;&rdquo; &times; {block.occurrences.length}</span>
              <button className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt whitespace-nowrap" onClick={() => applyBlockAsChorus(block.occurrences, "Chorus")}>Mark as Chorus</button>
            </div>
          ))}
        </div>
      )}

      {range != null && (
        <div className="flex items-center gap-1.5 flex-wrap border border-edge rounded bg-panel px-2 py-1.5">
          <span className="text-[10px] text-inkMuted">{range.end - range.start + 1} line{range.end - range.start === 0 ? "" : "s"} &rarr;</span>
          <select className="bg-panelAlt border border-edge rounded text-[10px] px-1.5 py-0.5" value={moveTargetId} onChange={(e) => setMoveTargetId(e.target.value)}>
            <option value="">Move to…</option>
            {sections.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
          <button className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink disabled:opacity-30" disabled={!moveTargetId} onClick={handleMoveToSection}>Move</button>
          <span className="text-[10px] text-inkMuted mx-0.5">|</span>
          <select className="bg-panelAlt border border-edge rounded text-[10px] px-1.5 py-0.5" value={addRole} onChange={(e) => setAddRole(e.target.value as SectionRole)}>
            {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
          <input className="bg-panelAlt border border-edge rounded text-[10px] px-1.5 py-0.5 w-28" placeholder="Name" value={addName} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }} />
          <button className="text-[10px] bg-accent text-black rounded px-2 py-0.5 font-medium" onClick={handleAddSection}>Add Section</button>
          {selectedSection && (<><span className="text-[10px] text-inkMuted mx-0.5">|</span><button className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink" onClick={() => { setRenameTargetId(selectedSection.id); setRenameName(selectedSection.name); }}>Rename &ldquo;{selectedSection.name}&rdquo;</button></>)}
          <span className="text-[10px] text-inkMuted mx-0.5">|</span>
          <button className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink" onClick={handleSplitHere}>Split</button>
          <button className="text-[10px] border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink" onClick={handleUnassign}>Unassign</button>
          <button className="text-[10px] text-inkMuted hover:text-ink px-1" onClick={clearSelection}>✕</button>
        </div>
      )}

      {renameTargetId && (
        <div className="flex items-center gap-2 border border-accent/30 rounded bg-panel p-2">
          <span className="text-[10px] text-inkMuted">Rename:</span>
          <input className="bg-panelAlt border border-edge rounded text-xs px-2 py-1 flex-1" value={renameName} onChange={(e) => setRenameName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleRenameSection(); }} autoFocus />
          <button className="bg-accent text-black text-xs font-medium px-3 py-1 rounded" onClick={handleRenameSection}>Rename</button>
          <button className="text-inkMuted hover:text-ink text-xs px-1" onClick={() => { setRenameTargetId(""); setRenameName(""); }}>✕</button>
        </div>
      )}

      {/* lyric document with instrumentals */}
      <div className="border border-edge rounded bg-panel p-3 font-mono text-sm leading-relaxed max-h-[55vh] overflow-y-auto select-none">
        {displayRows.map((row, index) => {
          const isBoundary = boundaries.has(index);

          if (row.kind === "placeholder") {
            const color = ROLE_COLOR[row.role] ?? "#8a8a92";
            const ic = document.findIndex((l) => l.sectionId === row.sectionId);
            return (
              <div key={`ph-${row.sectionId}`}>
                {isBoundary && <div className="border-t border-edge/50 my-1 mx-1" />}
                <div className="px-2 py-1 rounded flex items-center gap-2 opacity-60 italic" style={{ color }}>
                  <span className="inline-block w-20 shrink-0 text-[10px] truncate" style={{ color }}>{row.sectionName}</span>
                  <span className="text-[10px] text-inkMuted/60">&mdash; {INSTRUMENTAL_LABEL[row.role] ?? `Instrumental ${row.role}`} &mdash;</span>
                </div>
              </div>
            );
          }

          const line = row.line;
          const isSelected = range != null && row.docIndex >= range.start && row.docIndex <= range.end;
          const color = ROLE_COLOR[song.sections.find((s) => s.id === line.sectionId)?.role ?? "custom"];

          return (
            <div key={row.docIndex}>
              {isBoundary && <div className="border-t border-edge/50 my-1 mx-1" />}
              <div
                className={`px-2 py-0.5 rounded flex items-center gap-2 group ${isSelected ? "bg-accent/20" : "hover:bg-panelAlt cursor-pointer"}`}
                onMouseDown={() => lineMouseDown(row.docIndex)}
                onMouseEnter={() => lineMouseEnter(row.docIndex)}
              >
                <span className="inline-block w-20 shrink-0 text-[10px] truncate" style={{ color: color ?? "#8a8a92" }}>{line.sectionName}</span>
                <span className={line.text.trim().length === 0 ? "text-inkMuted" : "text-ink"}>{line.text || "\u00A0"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { LyricLine };