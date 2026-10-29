import { useState } from "react";
import { useDirectoryStore } from "../../store/directoryStore";
import { getHost } from "../../lib/host";

interface DirSetupModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DirSetupModal({ open, onClose }: DirSetupModalProps) {
  const dirs = useDirectoryStore((s) => s.dirs);
  const addDirectory = useDirectoryStore((s) => s.addDirectory);
  const removeDirectory = useDirectoryStore((s) => s.removeDirectory);
  const setDefault = useDirectoryStore((s) => s.setDefault);
  const listings = useDirectoryStore((s) => s.listings);

  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const host = getHost();

  if (!open) return null;

  function handleAdd() {
    const path = newPath.trim();
    const label = newLabel.trim() || path.split("/").pop() || path;
    if (!path) {
      setAddError("Path is required");
      return;
    }
    // Check for duplicates
    if (dirs.some((d) => d.path === path)) {
      setAddError("Directory already exists");
      return;
    }
    addDirectory({ path, label, isDefault: dirs.length === 0 });
    setNewPath("");
    setNewLabel("");
    setAddError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-panel border border-edge rounded-lg w-[480px] max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
          <h2 className="text-sm font-medium">Manage Directories</h2>
          <button className="text-inkMuted hover:text-ink text-lg leading-none" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-inkMuted">
            Your song library is organized into directories. Each directory points to a folder of{" "}
            <code className="text-ink text-[11px]">.trackdraft.json</code> files.
          </p>

          {/* Existing directories */}
          {dirs.length > 0 && (
            <div className="space-y-1">
              {dirs.map((dir) => {
                const entries = listings[dir.path] ?? [];
                return (
                  <div
                    key={dir.path}
                    className="flex items-center gap-2 px-3 py-2 rounded border border-edge bg-canvas text-sm"
                  >
                    <span className="text-xs shrink-0">{dir.isDefault ? "⭐" : "📁"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-xs">{dir.label}</div>
                      <div className="text-[10px] text-inkMuted truncate">{dir.path}</div>
                    </div>
                    <span className="text-[10px] text-inkMuted shrink-0">{entries.length} songs</span>
                    {!dir.isDefault && (
                      <button
                        className="text-[10px] text-inkMuted hover:text-accent shrink-0"
                        onClick={() => setDefault(dir.path)}
                        title="Set as default"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      className="text-xs text-inkMuted hover:text-danger shrink-0"
                      onClick={() => removeDirectory(dir.path)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {dirs.length === 0 && (
            <p className="text-xs text-inkMuted italic">No directories configured yet.</p>
          )}

          {/* Add new directory */}
          <div className="border border-edge rounded p-3 space-y-2 bg-canvas">
            <span className="text-xs font-medium text-inkMuted">Add Directory</span>
            <div className="space-y-2">
              <div className="flex gap-1">
                <input
                  className="flex-1 min-w-0 bg-panel border border-edge rounded px-2 py-1.5 text-xs"
                  placeholder={host ? "Path — or choose a folder" : "Path (e.g. scripts/output)"}
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                />
                {/* The desktop app only reads folders the user granted it, so a
                    typed path can't work there — the picker is what creates
                    the grant. */}
                {host && (
                  <button
                    type="button"
                    className="shrink-0 border border-edge rounded px-2 py-1 text-xs text-inkMuted hover:text-ink"
                    onClick={async () => {
                      const picked = await host.pickDirectory();
                      if (picked) setNewPath(picked);
                    }}
                    title="Choose a folder — grants the app read access to it"
                  >
                    Choose…
                  </button>
                )}
              </div>
              <input
                className="w-full bg-panel border border-edge rounded px-2 py-1.5 text-xs"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            {addError && <p className="text-[10px] text-danger">{addError}</p>}
            <button
              className="bg-accent text-accentInk font-medium px-3 py-1 rounded text-xs"
              onClick={handleAdd}
            >
              Scan & Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}