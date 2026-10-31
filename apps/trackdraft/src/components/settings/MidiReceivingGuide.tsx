import { useState } from "react";
import { LIVE_TEMPLATE_TRACK_NAMES } from "../../lib/liveTemplate";
import { STEM_IDS, STEM_LABELS, type StemId } from "../../lib/stems";
import { useMidiSettingsStore } from "../../store/midiSettingsStore";
import { useDawTargetStore } from "../../store/dawTargetStore";

/** The DAWs with a written receiving guide. Anything else gets the generic
 *  steps, which are true of every DAW — this is the delivery ladder's rung 2
 *  for all of them. */
type GuideDaw = "live" | "reaper" | "logic" | "other";

const GUIDE_DAWS: { id: GuideDaw; label: string }[] = [
  { id: "live", label: "Ableton Live" },
  { id: "reaper", label: "REAPER" },
  { id: "logic", label: "Logic" },
  { id: "other", label: "Other DAW" },
];

/** Where each stem lands on the Live template — the only DAW whose tracks
 *  have names beyond "the one you made". */
const LIVE_TRACK: Record<StemId, string> = {
  drums: LIVE_TEMPLATE_TRACK_NAMES[0],
  bass: LIVE_TEMPLATE_TRACK_NAMES[1],
  chords: LIVE_TEMPLATE_TRACK_NAMES[2],
  color: LIVE_TEMPLATE_TRACK_NAMES[3],
  melody: LIVE_TEMPLATE_TRACK_NAMES[4],
};

/**
 * The receiving side of the MIDI-out setup: what to do in the DAW so the
 * stream lands on the right track. The output port, channels and test tones
 * are the MIDI panel's job — this only explains the other end.
 *
 * It is DAW-aware rather than Live-only because Live is an adapter, not the
 * app's identity: the same five stems stream to any DAW over the same port,
 * and a guide that pretends otherwise is the reason "DAW-agnostic" reads as
 * a claim rather than a fact. The channel column is read from the live
 * routing settings instead of a copy of the preset, so a user who re-maps a
 * channel doesn't get told the wrong one.
 */
export default function MidiReceivingGuide({ onClose }: { onClose: () => void }) {
  const target = useDawTargetStore((s) => s.target);
  const routing = useMidiSettingsStore((s) => s.routing);
  const [daw, setDaw] = useState<GuideDaw>(target === "live" ? "live" : "other");

  const channelRows = STEM_IDS.map((stem) => ({
    stem,
    label: STEM_LABELS[stem],
    channel: routing[stem].channel,
    track: daw === "live" ? LIVE_TRACK[stem] : null,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-[30rem] max-w-full rounded border border-edge bg-panel p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Receiving DAW setup guide"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium text-sm">MIDI Out → receiving DAW</h3>
          <button className="text-inkMuted hover:text-ink leading-none text-sm" onClick={onClose} title="Close">
            &times;
          </button>
        </div>

        <div className="flex gap-1 mb-3">
          {GUIDE_DAWS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`text-[10px] font-mono px-2 py-1 rounded border ${
                daw === option.id
                  ? "border-accent text-accent bg-accent/10"
                  : "border-edge/70 text-inkMuted hover:text-ink"
              }`}
              onClick={() => setDaw(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {daw === "live" && (
          <ol className="list-decimal pl-4 space-y-1.5 text-xs text-inkMuted">
            <li>
              Make sure a virtual MIDI port exists — macOS:{" "}
              <span className="text-ink">Audio MIDI Setup → IAC Driver</span> (Live's "IAC Driver (Bus 1)" usually
              appears in the MIDI Out picker already).
            </li>
            <li>
              In Live, use the template set — its tracks are{" "}
              <span className="text-ink font-mono">{LIVE_TEMPLATE_TRACK_NAMES.slice(0, 5).join(" · ")}</span>.
            </li>
            <li>
              Pick that port in the MIDI Out dropdown, then point each template track's "MIDI From" at it, filtered to
              its own channel:
            </li>
          </ol>
        )}

        {daw === "reaper" && (
          <ol className="list-decimal pl-4 space-y-1.5 text-xs text-inkMuted">
            <li>
              Create a virtual MIDI port — macOS: <span className="text-ink">Audio MIDI Setup → IAC Driver</span>;
              Windows: <span className="text-ink">loopMIDI</span>.
            </li>
            <li>
              In REAPER, enable it as an input:{" "}
              <span className="text-ink">Preferences → MIDI Devices → right-click the port → Enable input</span>.
            </li>
            <li>
              For each of the five tracks: insert an instrument ({" "}
              <span className="text-ink">Insert → Virtual instrument on new track</span>), then right-click its
              record-arm button →{" "}
              <span className="text-ink">
                Input: MIDI → <em>port</em> → channel N
              </span>
              , arm the track and enable input monitoring.
            </li>
            <li>
              Faster for a finished song:{" "}
              <span className="text-ink">Export → REAPER project (.rpp)</span> hands you those five tracks with the
              song already in them, tempo and regions included — no routing at all.
            </li>
          </ol>
        )}

        {daw === "logic" && (
          <ol className="list-decimal pl-4 space-y-1.5 text-xs text-inkMuted">
            <li>
              Fastest: <span className="text-ink">File → Import MIDI File</span> — the exported .mid brings five named
              tracks at the song's tempo and meter, with every section as a marker.
            </li>
            <li>
              To play live from TrackDraft instead, create a virtual port (macOS:{" "}
              <span className="text-ink">Audio MIDI Setup → IAC Driver</span>) and enable it in{" "}
              <span className="text-ink">Logic → Settings → MIDI → Inputs</span>.
            </li>
            <li>
              Per track: set the track's input to that port (its inspector's{" "}
              <span className="text-ink">MIDI Input</span>), pick the channel below, arm the track and load an
              instrument.
            </li>
            <li>
              To make Logic follow TrackDraft's clock:{" "}
              <span className="text-ink">Project Settings → Synchronization → Sync Mode</span>, then choose{" "}
              <span className="text-ink">Manual Sync (Tempo Interpreter)</span>, which follows incoming MIDI clock.
            </li>
            <li>
              Logic has no scripting or OSC interface, so there is no "send to Logic" button — the file import is the
              integration.
            </li>
          </ol>
        )}

        {daw === "other" && (
          <ol className="list-decimal pl-4 space-y-1.5 text-xs text-inkMuted">
            <li>
              Create a virtual MIDI port — macOS: <span className="text-ink">Audio MIDI Setup → IAC Driver</span>;
              Windows: <span className="text-ink">loopMIDI</span>; Linux: <span className="text-ink">snd-virmidi</span>.
            </li>
            <li>Make five tracks in your DAW and load an instrument on each.</li>
            <li>
              Set each track's MIDI input to that port and filter it to the channel in the table below — most DAWs let
              you pick "port → channel N" on the track's input.
            </li>
            <li>
              Test each stem from the MIDI panel before pressing Play; it plays a note on that port and channel, so a
              silent track means the routing, not the song.
            </li>
            <li>
              For a finished song, <span className="text-ink">Export → MIDI</span> is usually quicker: one track per
              stem, General MIDI channels and programs, so it opens sounding right.
            </li>
          </ol>
        )}

        <table className="w-full mt-2 text-xs">
          <thead>
            <tr className="text-3xs uppercase tracking-wider text-inkMuted">
              <th className="text-left font-normal py-1">Channel</th>
              <th className="text-left font-normal">Stem</th>
              <th className="text-left font-normal">{daw === "live" ? "Template track" : "Track to receive it"}</th>
            </tr>
          </thead>
          <tbody>
            {channelRows.map((row) => (
              <tr key={row.stem} className="border-t border-edge">
                <td className="py-1 font-mono">ch. {row.channel}</td>
                <td>{row.label}</td>
                <td className="font-mono text-accent">
                  {row.track ?? `${STEM_LABELS[row.stem]} track`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {daw === "live" && (
          <p className="text-xs text-inkMuted mt-3">
            <span className="text-ink font-mono">chord</span> already listens to all channels, so a preset left at the
            template's channels needs no change; any other channel needs that one-time "MIDI From" repoint.
          </p>
        )}

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
