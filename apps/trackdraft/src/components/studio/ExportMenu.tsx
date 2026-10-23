import { useEffect, useRef, useState } from "react";
import type { BlueprintSong } from "../../types/blueprint";
import { downloadSongJson, pushSongToAbleton } from "../../lib/exportImport";
import { downloadSongMidi } from "../../lib/midiExport";

/** Studio's export/send actions tucked under a single button — Export JSON,
 *  Export MIDI, and Send to Ableton — so the transport bar stays one tight
 *  row. Closes on outside click or Escape. */
export default function ExportMenu({ song }: { song: BlueprintSong }) {
  const [open, setOpen] = useState(false);
  const [sendingToAbleton, setSendingToAbleton] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function sendToAbleton() {
    // Ableton's cue-point creation isn't safe against two near-simultaneous
    // applyBlueprint runs for the same song (observed directly: it can
    // crash the whole extension host) — disabling while a request's in
    // flight keeps an accidental double-click from recreating that race.
    if (sendingToAbleton) return;
    setSendingToAbleton(true);
    setOpen(false);
    try {
      const result = await pushSongToAbleton(song);
      alert(`Sent "${result.title}" to Ableton — cue points, tempo, and the template's chord/crave/kit/color tracks are being populated with real MIDI now (the extension polls its command queue every 2s). Load an instrument on each track in Ableton to hear it.`);
    } catch (err) {
      alert(`Couldn't reach the Ableton bridge (osc-bridge at localhost:5200). Make sure it's running, then try again.\n\nError: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSendingToAbleton(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className="bg-accent text-accentInk text-xs font-medium px-2.5 py-1 rounded flex items-center gap-1"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export this song — JSON blueprint, multi-track MIDI, or straight to Ableton"
        onClick={() => setOpen((o) => !o)}
      >
        Export
        <span className={`text-[9px] opacity-70 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-md border border-edge bg-panel shadow-xl overflow-hidden">
          <button
            className="w-full text-left text-xs px-3 py-1.5 text-ink hover:bg-panelAlt"
            onClick={() => {
              setOpen(false);
              downloadSongJson(song);
            }}
          >
            Export JSON
          </button>
          <button
            className="w-full text-left text-xs px-3 py-1.5 text-ink hover:bg-panelAlt"
            title="Export this song as a multi-track MIDI file (.mid) — chords, bass, and drums. Works with any DAW."
            onClick={() => {
              setOpen(false);
              downloadSongMidi(song);
            }}
          >
            Export MIDI
          </button>
          <button
            className="w-full text-left text-xs px-3 py-1.5 text-ink hover:bg-panelAlt disabled:opacity-40 border-t border-edge"
            disabled={sendingToAbleton}
            title="Push this song's blueprint to Ableton via the osc-bridge — the bridge itself queues an apply command, which reuses the template's chord, crave, kit, and color MIDI tracks (creating them if absent) and fills them with real clips — no manual right-clicking needed"
            onClick={sendToAbleton}
          >
            {sendingToAbleton ? "Sending…" : "Send to Ableton"}
          </button>
        </div>
      )}
    </div>
  );
}
