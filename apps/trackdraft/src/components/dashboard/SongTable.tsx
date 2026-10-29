import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { BlueprintSong } from "../../types/blueprint";
import { computeConfidence } from "../../lib/confidence";
import { useSongStore } from "../../store/songStore";
import { downloadSongJson } from "../../lib/exportImport";
import { classifySong } from "../../lib/classification";

export type SortKey = "title" | "bpm" | "updatedAt" | "createdAt" | "confidence" | "sections";
export type SortDir = "asc" | "desc";

interface SongTableProps {
  songs: BlueprintSong[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

export default function SongTable({ songs, sortKey, sortDir, onSort }: SongTableProps) {
  const navigate = useNavigate();
  const deleteSong = useSongStore((s) => s.deleteSong);

  const sorted = useMemo(() => {
    const byConfidence = new Map(
      songs.map((s) => [s.id, computeConfidence(s).score]),
    );
    const sorted = [...songs].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        // Imported and hand-built songs can arrive without timestamps, and a
        // missing one used to take the whole dashboard down on the default
        // sort — compare as text, with an absent value sorting first.
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "bpm":
          cmp = (a.bpm ?? 0) - (b.bpm ?? 0);
          break;
        case "updatedAt":
          cmp = (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
          break;
        case "createdAt":
          cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
          break;
        case "confidence":
          cmp = (byConfidence.get(a.id) ?? 0) - (byConfidence.get(b.id) ?? 0);
          break;
        case "sections":
          cmp = a.sections.length - b.sections.length;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [songs, sortKey, sortDir]);

  function SortHeader({ column, label }: { column: SortKey; label: string }) {
    const isActive = sortKey === column;
    return (
      <button
        className={`text-[10px] uppercase tracking-wider font-semibold flex items-center gap-0.5 hover:text-ink ${
          isActive ? "text-ink" : "text-inkMuted"
        }`}
        onClick={() => onSort(column)}
      >
        {label}
        {isActive && <span className="text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="p-8 text-center text-inkMuted text-sm">
        No songs found. Create a new song or import one to get started.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-panel border-b border-edge">
          <tr>
            <th className="w-6 px-2 py-2" />
            <th className="text-left px-2 py-2">
              <SortHeader column="title" label="Title" />
            </th>
            <th className="text-left px-2 py-2 w-14">
              <SortHeader column="confidence" label="Conf" />
            </th>
            <th className="text-left px-2 py-2 w-12">
              <SortHeader column="bpm" label="BPM" />
            </th>
            <th className="text-left px-2 py-2 w-12">
              <SortHeader column="sections" label="Sec" />
            </th>
            <th className="text-left px-2 py-2 w-20">
              <SortHeader column="updatedAt" label="Updated" />
            </th>
            <th className="w-20 px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-edge">
          {sorted.map((song) => {
            const conf = computeConfidence(song);
            const updated = new Date(song.updatedAt);
            const updatedStr = updated.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            return (
              <tr
                key={song.id}
                className="hover:bg-panelAlt/50 cursor-pointer"
                onClick={() => navigate(`/song/${song.id}`)}
              >
                <td className="px-2 py-1.5">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${conf.color}`}
                    title={`${conf.label} (${Math.round(conf.score * 100)}%)`}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="hand-value truncate max-w-[300px] font-medium">{song.title}</div>
                  <div className="text-[10px] text-inkMuted">
                    {song.key} {song.scale}
                    {song.sections.length > 0 && <> · {classifySong(song).label}</>}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-xs text-inkMuted">{Math.round(conf.score * 100)}%</td>
                <td className="px-2 py-1.5 text-xs text-inkMuted">{song.bpm}</td>
                <td className="px-2 py-1.5 text-xs text-inkMuted">{song.sections.length}</td>
                <td className="px-2 py-1.5 text-[10px] text-inkMuted">{updatedStr}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      className="text-[10px] text-inkMuted hover:text-ink px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadSongJson(song);
                      }}
                      title="Export JSON"
                    >
                      Export
                    </button>
                    <button
                      className="text-[10px] text-inkMuted hover:text-danger px-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSong(song.id);
                      }}
                      title="Delete"
                    >
                      Del
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}