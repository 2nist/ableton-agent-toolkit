import { useEffect, useState, useSyncExternalStore } from "react";
import { downloadLibraryBackup } from "../../lib/exportImport";
import { useSongStore } from "../../store/songStore";
import { getStorageFailure, subscribeStorageFailure } from "../../store/storage";

/**
 * Shell-level warning for a failed autosave. Writes used to fail silently
 * (quota, private mode), which meant the user kept editing a song that was
 * no longer being persisted. The banner stays until a write to the same key
 * succeeds, and offers the one action that still works when storage is
 * full: download the whole library as JSON.
 */
export default function StorageWarning() {
  const failure = useSyncExternalStore(subscribeStorageFailure, getStorageFailure, () => null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // A fresh failure re-opens the banner even if the previous one was dismissed.
  useEffect(() => {
    setDismissedAt(null);
  }, [failure?.at]);

  if (!failure || dismissedAt === failure.at) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 border border-danger/60 bg-panel px-3 py-2 rounded shadow-lg text-xs"
    >
      <span className="text-ink">
        <span className="text-danger font-medium">Autosave failed.</span> Recent edits may not
        survive a reload ({failure.message}).
      </span>
      <button
        type="button"
        className="bg-accent text-accentInk font-medium px-2 py-0.5 rounded whitespace-nowrap"
        onClick={() => downloadLibraryBackup(useSongStore.getState().songs)}
      >
        Download backup
      </button>
      <button
        type="button"
        className="text-inkMuted hover:text-ink"
        onClick={() => setDismissedAt(failure.at)}
      >
        Dismiss
      </button>
    </div>
  );
}
