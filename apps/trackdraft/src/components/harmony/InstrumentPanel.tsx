import { useState } from "react";
import { AVAILABLE_INSTRUMENTS, getPreviewPlayer, midiToFreq } from "../../lib/harmony/audioPreview";

const PREVIEW_CHORD_MIDI = [60, 64, 67]; // C4 major triad — a fixed, familiar reference for auditioning a voice

/** Instrument picker + volume for the shared chord-preview player — lives
 *  in the Harmony dock's Tools panel, always visible (not tied to chord
 *  selection) since it's a playback-wide setting, not a per-chord one.
 *  Talks straight to the `PreviewPlayer` singleton; nothing here is part
 *  of the song data model, so switching instruments never touches
 *  undo/redo or gets saved with the song. */
export default function InstrumentPanel() {
  const player = getPreviewPlayer();
  const [instrumentUrl, setInstrumentUrl] = useState(player.getCurrentInstrumentUrl());
  const [volume, setVolume] = useState(player.getVolume());
  const [loading, setLoading] = useState(false);

  function handleInstrumentChange(url: string) {
    setInstrumentUrl(url);
    setLoading(true);
    player.setInstrument(url).finally(() => setLoading(false));
  }

  function handleVolumeChange(value: number) {
    setVolume(value);
    player.setVolume(value);
  }

  function handlePreview() {
    player.playChord(PREVIEW_CHORD_MIDI.map(midiToFreq), 1.2);
  }

  return (
    <div>
      <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
        Instrument
      </span>
      <div className="space-y-1.5">
        <select
          className="w-full bg-panelAlt border border-edge rounded px-2 py-1 text-sm text-ink"
          value={instrumentUrl}
          onChange={(e) => handleInstrumentChange(e.target.value)}
          title="Sampled instrument used for chord-preview playback"
        >
          {AVAILABLE_INSTRUMENTS.map((inst) => (
            <option key={inst.url} value={inst.url}>{inst.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xs text-inkMuted w-10 shrink-0">Vol</span>
          <input
            type="range"
            min={0}
            max={127}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="flex-1"
          />
          <button
            className="font-mono text-3xs uppercase tracking-wider text-inkMuted border border-edge rounded px-2 py-1 hover:text-ink hover:border-inkMuted disabled:opacity-40 shrink-0"
            onClick={handlePreview}
            disabled={loading}
            title="Play a C major triad on the current instrument"
          >
            {loading ? "Loading…" : "Preview"}
          </button>
        </div>
      </div>
    </div>
  );
}
