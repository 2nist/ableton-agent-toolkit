import { useEffect, useState } from "react";
import {
  listMidiOutputs,
  getMidiOutput,
  midiOutSupported,
  sendTestNote,
  type LiveMidiChannelMap,
  type MidiOutputInfo,
} from "../../lib/playback/liveMidiOut";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { TEMPLATE_TRACK_NAMES } from "../../lib/liveTemplate";

/** One row of the channel editor: the stem it streams, the template track
 *  it lands on, and (via the channel select + Test button) how to wire it
 *  into Live. */
const STEM_ROWS: { stem: keyof LiveMidiChannelMap; label: string; track: string }[] = [
  { stem: "drums", label: "Drums", track: TEMPLATE_TRACK_NAMES[0] },
  { stem: "bass", label: "Bass", track: TEMPLATE_TRACK_NAMES[1] },
  { stem: "chords", label: "Chords", track: TEMPLATE_TRACK_NAMES[2] },
  { stem: "color", label: "Color", track: TEMPLATE_TRACK_NAMES[3] },
  { stem: "melody", label: "Melody", track: TEMPLATE_TRACK_NAMES[4] },
];

const CHANNEL_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1);

/** The MIDI Out setup panel — the real control surface for getting
 *  TrackDraft's live MIDI into Ableton. Replaces the old tiny dropdown:
 *  a proper output-port picker, an editable per-track channel map that
 *  persists (so it can match however your Live template actually listens),
 *  and a per-track Test button that fires a note so you can verify the
 *  port + channel reach Live before pressing Play. */
export default function MidiSetupPanel({ onClose }: { onClose: () => void }) {
  const midiOutputId = useMidiSettingsStore((s) => s.midiOutputId);
  const setMidiOutputId = useMidiSettingsStore((s) => s.setMidiOutputId);
  const channels = useMidiSettingsStore((s) => s.channels);
  const setChannel = useMidiSettingsStore((s) => s.setChannel);
  const resetChannels = useMidiSettingsStore((s) => s.resetChannels);

  const [outputs, setOutputs] = useState<MidiOutputInfo[]>([]);
  const supported = midiOutSupported();

  // Refresh the port list each time the panel opens — the IAC bus may
  // have appeared/disappeared since the page loaded. Also reconcile the
  // persisted port id: Web MIDI ids aren't stable across browser restarts,
  // so a saved id from a previous session can point at nothing — clear it
  // so the "MIDI ●" dot and Play don't silently target a phantom port.
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    listMidiOutputs()
      .then((outs) => {
        if (!alive) return;
        setOutputs(outs);
        const ids = new Set(outs.map((o) => o.id));
        const current = useMidiSettingsStore.getState().midiOutputId;
        if (current && !ids.has(current)) {
          useMidiSettingsStore.getState().setMidiOutputId("");
        }
      })
      .catch(() => setOutputs([]));
    return () => {
      alive = false;
    };
  }, [supported]);

  async function testStem(stem: keyof LiveMidiChannelMap) {
    if (!midiOutputId) return;
    const output = await getMidiOutput(midiOutputId);
    if (output) sendTestNote(output, channels[stem]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-[30rem] max-w-full max-h-[85vh] overflow-y-auto rounded border border-edge bg-panel p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">MIDI Out — Live setup</h3>
          <button className="text-inkMuted hover:text-ink leading-none text-sm" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        {!supported ? (
          <div className="text-xs text-inkMuted space-y-2">
            <p>
              Web MIDI isn't available in this browser — it's desktop-Chrome only (no Safari, iPad, or iPhone browser
              supports it).
            </p>
            <p>
              Open TrackDraft in <span className="text-ink">desktop Chrome on the Mac</span> for real-time MIDI out. From
              here you can still use <span className="text-ink">Send to Ableton</span> (committed clips via the bridge)
              instead.
            </p>
          </div>
        ) : (
          <>
            <label className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Output port
            </label>
            <div className="space-y-1 mb-4">
              <label className="flex items-center gap-2 text-xs text-inkMuted cursor-pointer">
                <input type="radio" checked={!midiOutputId} onChange={() => setMidiOutputId("")} />
                Off
              </label>
              {outputs.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                  <input type="radio" checked={midiOutputId === o.id} onChange={() => setMidiOutputId(o.id)} />
                  <span className="font-mono">{o.name}</span>
                </label>
              ))}
              {outputs.length === 0 && (
                <p className="text-xs text-inkMuted">
                  No MIDI outputs found — set up the IAC Driver in Audio MIDI Setup, then reopen this panel.
                </p>
              )}
            </div>

            <label className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1">
              Channels → template tracks
            </label>
            <div className="border border-edge rounded overflow-hidden mb-1">
              {STEM_ROWS.map((row) => (
                <div
                  key={row.stem}
                  className="flex items-center gap-2 px-2 py-1.5 border-b border-edge last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-ink">{row.label}</div>
                    <div className="font-mono text-3xs text-inkMuted">→ {row.track}</div>
                  </div>
                  <select
                    className="bg-panelAlt border border-edge rounded px-1 py-0.5 text-xs font-mono text-ink"
                    value={channels[row.stem]}
                    onChange={(e) => setChannel(row.stem, parseInt(e.target.value, 10))}
                    title={`${row.label} streams on MIDI channel ${channels[row.stem]} — make ${row.track}'s MIDI From match`}
                  >
                    {CHANNEL_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        ch {c}
                      </option>
                    ))}
                  </select>
                  <button
                    className="border border-edge text-inkMuted hover:text-ink rounded px-2 py-0.5 text-2xs font-mono disabled:opacity-30"
                    onClick={() => testStem(row.stem)}
                    disabled={!midiOutputId}
                    title={`Send a test note on channel ${channels[row.stem]} — you should hear ${row.track}`}
                  >
                    Test
                  </button>
                </div>
              ))}
            </div>
            <button className="text-2xs font-mono text-inkMuted hover:text-ink mb-4" onClick={resetChannels}>
              Reset channels to defaults
            </button>

            <div className="border-t border-edge pt-3 text-xs text-inkMuted space-y-1.5">
              <p>
                <span className="text-ink">Play</span> streams each stem on its channel through the selected port.{" "}
                <span className="text-ink">Test</span> fires one note so you can confirm a track hears it first.
              </p>
              <p>
                In Live, point each template track's <span className="text-ink">MIDI From</span> at this port, filtered
                to its channel. <span className="text-ink font-mono">chord</span> can listen to all channels.
              </p>
            </div>
          </>
        )}

        <button
          className="mt-4 w-full border border-edge text-inkMuted hover:text-ink rounded px-3 py-1.5 text-xs"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}
