import { useState } from "react";

interface ImportTarget {
  id: string;
  label: string;
  icon: string;
  formats: string;
  status: "ready" | "soon" | "planned";
}

const TARGETS: ImportTarget[] = [
  {
    id: "audio",
    label: "Audio",
    icon: "🎵",
    formats: ".mp3 .wav .aif",
    status: "soon",
  },
  {
    id: "midi",
    label: "MIDI",
    icon: "🎹",
    formats: ".mid .midi",
    status: "soon",
  },
  {
    id: "lyrics",
    label: "Lyrics",
    icon: "📝",
    formats: ".txt .lrc",
    status: "planned",
  },
  {
    id: "ableton",
    label: "Ableton",
    icon: "📦",
    formats: ".als .ablx",
    status: "planned",
  },
];

export default function ImportZone() {
  const [toast, setToast] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent, target: ImportTarget) {
    e.preventDefault();
    if (target.status === "ready") {
      // Future: process the dropped files based on target.id
      setToast(`${target.label} import: processing files…`);
    } else if (target.status === "soon") {
      setToast(`${target.label} import is coming soon. Currently supported: .json`);
    } else {
      setToast(`${target.label} import is planned for a future release.`);
    }
    setTimeout(() => setToast(null), 3000);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  return (
    <div className="border-t border-edge px-3 py-2 shrink-0">
      <div className="flex items-center gap-1 text-[10px] text-inkMuted mb-1.5">
        <span>Import (drop files)</span>
      </div>
      <div className="flex gap-2">
        {TARGETS.map((target) => (
          <div
            key={target.id}
            className="flex-1 border border-edge border-dashed rounded px-2 py-2 text-center cursor-default hover:border-inkMuted transition-colors"
            onDrop={(e) => handleDrop(e, target)}
            onDragOver={handleDragOver}
          >
            <div className="text-lg">{target.icon}</div>
            <div className="text-[10px] font-medium text-inkMuted">{target.label}</div>
            <div className="text-[9px] text-inkMuted/60">{target.formats}</div>
            <div
              className={`inline-block text-[8px] px-1 rounded mt-1 ${
                target.status === "ready"
                  ? "bg-emerald-400/20 text-emerald-400"
                  : target.status === "soon"
                    ? "bg-amber-400/20 text-amber-400"
                    : "bg-neutral-500/20 text-neutral-500"
              }`}
            >
              {target.status === "ready" ? "Ready" : target.status === "soon" ? "Soon" : "Planned"}
            </div>
          </div>
        ))}
      </div>

      {/* Toast */}
      {toast && (
        <div className="mt-2 text-[10px] text-accent text-center animate-pulse">{toast}</div>
      )}
    </div>
  );
}