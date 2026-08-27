import type { BlueprintSection } from "../../types/blueprint";
import { DEFAULT_BASS_PROFILE } from "@drum/library";

const OCTAVES = [3, 4] as const;
const MOTIONS = [
  { id: "root", label: "Root" },
  { id: "root_fifth", label: "Root+5th" },
  { id: "walking", label: "Walking" },
] as const;
const RHYTHMS = [
  { id: "locked", label: "Per chord" },
  { id: "half", label: "Half" },
  { id: "eighth", label: "8ths" },
] as const;

interface BassSettingsProps {
  section: BlueprintSection;
  onChange: (updater: (section: BlueprintSection) => BlueprintSection) => void;
}

/** The generated bass voice for a section — register, motion, rhythm and
 *  velocity. Writes the per-section `bassProfile` consumed by the app's
 *  `.mid`/live-out export AND Send to Ableton (both call `@drum/library`'s
 *  `planSectionBass`), so the two always agree. */
export default function BassSettings({ section, onChange }: BassSettingsProps) {
  const profile = section.bassProfile ?? {};
  const patch = (p: Partial<NonNullable<BlueprintSection["bassProfile"]>>) =>
    onChange((s) => ({ ...s, bassProfile: { ...profile, ...p } }));

  const octave = profile.octave ?? DEFAULT_BASS_PROFILE.octave;
  const motion = profile.motion ?? DEFAULT_BASS_PROFILE.motion;
  const rhythm = profile.rhythm ?? DEFAULT_BASS_PROFILE.rhythm;
  const velocity = profile.velocity ?? DEFAULT_BASS_PROFILE.velocity;

  const chip = (active: boolean) =>
    `font-mono text-2xs rounded px-2 py-1 border ${
      active ? "border-inkMuted text-ink" : "border-edge text-inkMuted hover:text-ink"
    }`;

  return (
    <div className="p-2.5">
      <span
        className="font-mono text-3xs uppercase tracking-wider text-inkMuted block mb-1"
        title="The generated bass voice for this section — the Bass track in MIDI export, Send to Ableton, and real-time MIDI out. One sustained root per chord by default."
      >
        Bass
      </span>

      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted" title="Register as a MIDI octave — 3 is the standard bass octave (C2), 4 an octave up.">
          Register
        </span>
        <div className="flex gap-1">
          {OCTAVES.map((o) => (
            <button key={o} className={chip(octave === o)} onClick={() => patch({ octave: o })}>
              C{o}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted" title="How the bass moves: Root = the chord root; Root+5th alternates root and fifth; Walking walks up into each new chord, ending on a leading tone.">
          Motion
        </span>
        <div className="flex gap-1">
          {MOTIONS.map((m) => (
            <button key={m.id} className={chip(motion === m.id)} onClick={() => patch({ motion: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted" title="Subdivision of each chord's span: Per chord = one sustained note; Half = two; 8ths = four.">
          Rhythm
        </span>
        <div className="flex gap-1">
          {RHYTHMS.map((r) => (
            <button key={r.id} className={chip(rhythm === r.id)} onClick={() => patch({ rhythm: r.id })}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs uppercase tracking-wider text-inkMuted">Velocity</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={127}
            value={velocity}
            className="w-24 accent-inkMuted"
            title="Bass note velocity"
            onChange={(e) => patch({ velocity: Number(e.target.value) })}
          />
          <span className="font-mono text-2xs tabular-nums text-ink w-7 text-right">{velocity}</span>
        </div>
      </div>
    </div>
  );
}
