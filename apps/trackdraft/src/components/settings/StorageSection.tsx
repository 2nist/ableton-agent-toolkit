import { useCallback, useEffect, useState } from "react";
import { downloadLibraryBackup } from "../../lib/exportImport";
import { formatBytes, measureLibraryStorage, type LibraryStorageInfo } from "../../lib/persistence/libraryStorageInfo";
import { useSongStore } from "../../store/songStore";
import TapeLabel from "../common/TapeLabel";

const BACKEND_LABELS: Record<LibraryStorageInfo["backend"], string> = {
  disk: "one file per song in the library folder",
  indexeddb: "IndexedDB — one record per song",
  localstorage: "localStorage — no IndexedDB in this browser",
};

const LEVEL_STYLES = {
  ok: { dot: "bg-inkMuted/40", text: "text-inkMuted/70" },
  watch: { dot: "bg-warn", text: "text-warn" },
  danger: { dot: "bg-danger", text: "text-danger" },
} as const;

/**
 * Library storage readout. The quota failure this was built for was invisible
 * until the write failed — and by then the library could not be shrunk,
 * because shrinking it was also a write. Seeing the number grow is the cheap
 * way to avoid ever being in that position again.
 */
export default function StorageSection() {
  const songs = useSongStore((s) => s.songs);
  const [info, setInfo] = useState<LibraryStorageInfo | null>(null);
  const [measuring, setMeasuring] = useState(false);

  const measure = useCallback(async () => {
    setMeasuring(true);
    try {
      setInfo(await measureLibraryStorage(useSongStore.getState().songs));
    } finally {
      setMeasuring(false);
    }
  }, []);

  // Re-measured on mount and whenever the song count changes: the point is a
  // number you can watch, not a snapshot from login.
  useEffect(() => {
    void measure();
  }, [measure, songs.length]);

  const level = LEVEL_STYLES[info?.level ?? "ok"];

  return (
    <section className="border border-edge rounded-lg bg-panel overflow-hidden">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/70">
        <TapeLabel size="md" className="text-3xs font-mono uppercase tracking-widest text-inkMuted">
          Library storage
        </TapeLabel>
        <span className="flex-1" />
        <button
          type="button"
          className="border border-edge/70 rounded px-2 py-0.5 text-2xs font-mono text-inkMuted hover:text-ink disabled:opacity-50"
          onClick={() => void measure()}
          disabled={measuring}
          title="Re-measure the library and refresh the browser's quota figures"
        >
          {measuring ? "measuring…" : "Measure"}
        </button>
      </header>
      <div className="p-3 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${level.dot}`} aria-hidden />
          <span className={`text-xs ${info?.level === "ok" ? "text-ink" : level.text}`} data-testid="storage-headline">
            {info ? info.headline : "Measuring…"}
          </span>
        </div>
        <p className="text-2xs text-inkMuted/60 pl-3.5">
          {info ? BACKEND_LABELS[info.backend] : "—"}
          {info?.usageBytes != null && info.quotaBytes
            ? ` · this site uses ${formatBytes(info.usageBytes)} of ${formatBytes(info.quotaBytes)}`
            : ""}
        </p>
        {info?.advice && (
          <div className="flex items-start gap-2 pl-3.5">
            <p className={`text-2xs flex-1 ${level.text}`}>{info.advice}</p>
            <button
              type="button"
              className="bg-accent text-accentInk text-2xs font-medium px-2 py-0.5 rounded whitespace-nowrap"
              onClick={() => downloadLibraryBackup(useSongStore.getState().songs)}
            >
              Download backup
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
