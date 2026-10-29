import { LIVE_TEMPLATE_TRACK_NAMES } from "../../lib/liveTemplate";

/** The channel → template-track mapping the Live preset streams on.
 *  Channel number = template track number for the first four tracks.
 *  Only relevant to the Live target — every other DAW just takes "channel
 *  N" on a track you make yourself. */
const CHANNEL_MAP = [
  { channel: 1, stem: "Drums", track: LIVE_TEMPLATE_TRACK_NAMES[0] },
  { channel: 2, stem: "Bass", track: LIVE_TEMPLATE_TRACK_NAMES[1] },
  { channel: 3, stem: "Chords", track: LIVE_TEMPLATE_TRACK_NAMES[2] },
  { channel: 4, stem: "Color", track: LIVE_TEMPLATE_TRACK_NAMES[3] },
];

/** One-time Live-side setup guide for hearing TrackDraft's MIDI out on the
 *  template set — a small modal explaining the virtual port pick and the
 *  per-track "MIDI From" repoint. Purely informational: the picker in
 *  StudioView is the actual control; this just tells you how to wire the
 *  other side of it. Live-only by design: it describes one specific .als,
 *  not a generic DAW setup (see MidiSetupPanel's copy for that). */
export default function MidiTemplateGuide({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[26rem] max-w-full rounded border border-edge bg-panel p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">MIDI Out → Live template (Live target)</h3>
          <button className="text-inkMuted hover:text-ink leading-none text-sm" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        <ol className="list-decimal pl-4 space-y-1.5 text-xs text-inkMuted">
          <li>
            Make sure a virtual MIDI port exists — macOS: <span className="text-ink">Audio MIDI Setup → IAC Driver</span>{" "}
            (Live's "IAC Driver (Bus 1)" usually appears in the MIDI Out picker already).
          </li>
          <li>
            In Live, use the template set — its tracks are{" "}
            <span className="text-ink font-mono">{LIVE_TEMPLATE_TRACK_NAMES.slice(0, 4).join(" · ")}</span>.
          </li>
          <li>Pick that port in the MIDI Out dropdown, then point each template track's "MIDI From" at it, filtered to its own channel:</li>
        </ol>

        <table className="w-full mt-2 text-xs">
          <thead>
            <tr className="text-3xs uppercase tracking-wider text-inkMuted">
              <th className="text-left font-normal py-1">Channel</th>
              <th className="text-left font-normal">Stem</th>
              <th className="text-left font-normal">Template track</th>
            </tr>
          </thead>
          <tbody>
            {CHANNEL_MAP.map((m) => (
              <tr key={m.channel} className="border-t border-edge">
                <td className="py-1 font-mono">ch. {m.channel}</td>
                <td>{m.stem}</td>
                <td className="font-mono text-accent">{m.track}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-xs text-inkMuted mt-3">
          <span className="text-ink font-mono">chord</span> already listens to all channels, so it needs no change; the
          other three need that one-time "MIDI From" repoint, filtered to their own channel.
        </p>

        <button
          className="mt-3 w-full border border-edge text-inkMuted hover:text-ink rounded px-3 py-1.5 text-xs"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
