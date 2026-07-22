import { useState } from "react";
import {
  DRUM_VOICES,
  clearVariantOverride,
  getDefaultVariantIndex,
  getDrumVolume,
  getGroupVariants,
  getVariantOverride,
  previewDrumVoice,
  setDrumVolume,
  setVariantOverride,
} from "../../lib/playback/drumPreview";

interface VoiceRowProps {
  label: string;
  group: string;
  midi: number;
}

/** One voice: a test button (plays whatever's currently resolved — the
 *  saved override if one exists, otherwise the middle-of-range default)
 *  plus a stepper to browse every real variant and immediately hear each
 *  one. Moving the stepper both previews *and* saves that variant as the
 *  new default via `setVariantOverride` — "browse until it sounds right"
 *  is the whole interaction, no separate confirm step. This exists
 *  because the middle-of-range heuristic default isn't always right: the
 *  TR-808's `snare/sd2525` (dead center) turned out to be a silent/bad
 *  file despite resolving correctly through every layer of alias lookup —
 *  the only way that was actually caught was by listening to it, which is
 *  exactly what this stepper is for. */
function VoiceRow({ label, group, midi }: VoiceRowProps) {
  const [variants, setVariants] = useState<string[] | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const hasOverride = getVariantOverride(group) !== undefined;

  async function ensureVariants(): Promise<string[]> {
    if (variants) return variants;
    const loaded = await getGroupVariants(group);
    setVariants(loaded);
    const current = getDefaultVariantIndex(group, loaded.length);
    setIndex(current);
    return loaded;
  }

  function playAndSave(list: string[], i: number) {
    setIndex(i);
    setVariantOverride(group, i);
    setPlaying(true);
    previewDrumVoice(group, 100, i).finally(() => setPlaying(false));
  }

  async function handleTest() {
    setPlaying(true);
    await previewDrumVoice(group);
    setPlaying(false);
  }

  async function handleStep(delta: number) {
    const list = await ensureVariants();
    if (list.length <= 1) return;
    const base = index ?? Math.floor(list.length / 2);
    const next = Math.max(0, Math.min(list.length - 1, base + delta));
    playAndSave(list, next);
  }

  async function handleReset() {
    clearVariantOverride(group);
    const list = await ensureVariants();
    setIndex(Math.floor(list.length / 2));
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        className={`font-mono text-3xs px-2 py-1 rounded border min-w-[76px] ${
          playing
            ? "border-accent text-accent bg-accent/10"
            : hasOverride
              ? "border-inkMuted/60 text-ink"
              : "border-edge text-inkMuted hover:text-ink hover:border-inkMuted"
        }`}
        onClick={handleTest}
        title={`MIDI ${midi} → "${group}"${hasOverride ? " (custom variant saved)" : ""}`}
      >
        {label}
      </button>
      <button
        className="font-mono text-3xs text-inkMuted hover:text-ink px-1 disabled:opacity-30"
        onClick={() => void handleStep(-1)}
        disabled={variants !== null && variants.length <= 1}
        title="Previous variant — previews and saves it as the new default"
      >
        ◂
      </button>
      <span className="font-mono text-3xs text-inkMuted/70 tabular-nums min-w-[3ch] text-center">
        {variants && index !== null ? `${index + 1}/${variants.length}` : "…"}
      </span>
      <button
        className="font-mono text-3xs text-inkMuted hover:text-ink px-1 disabled:opacity-30"
        onClick={() => void handleStep(1)}
        disabled={variants !== null && variants.length <= 1}
        title="Next variant — previews and saves it as the new default"
      >
        ▸
      </button>
      {hasOverride && (
        <button
          className="font-mono text-3xs text-inkMuted/60 hover:text-ink px-1"
          onClick={() => void handleReset()}
          title="Reset to the default (middle-of-range) variant"
        >
          ↺
        </button>
      )}
    </div>
  );
}

/** Global (not per-section) drum playback controls — volume, and a way to
 *  audition each individual drum voice on its own, so the GM pitch → TR-808
 *  sample-group mapping (`GM_TO_GROUP` in drumPreview.ts) can actually be
 *  heard and verified rather than just trusted. Lives above the section
 *  list since it's song-wide, the same relationship the chord
 *  `InstrumentPanel` has to the Harmony dock. */
export default function DrumKitPanel() {
  const [volume, setVolume] = useState(getDrumVolume());

  function handleVolumeChange(value: number) {
    setVolume(value);
    setDrumVolume(value);
  }

  return (
    <div className="border border-edge rounded bg-panel p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-3xs uppercase tracking-wider text-inkMuted">Drum Kit</span>
        <span className="font-mono text-3xs text-inkMuted/60">TR-808</span>
      </div>

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
      </div>

      <div>
        <span
          className="font-mono text-3xs text-inkMuted block mb-1"
          title="Click a voice to hear it. Use ◂ ▸ to browse every real variant and save whichever one actually sounds right — the middle-of-range default isn't always a good sample."
        >
          Test voices (◂ ▸ browses variants, saves your pick)
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {DRUM_VOICES.map((voice) => (
            <VoiceRow key={voice.group} label={voice.label} group={voice.group} midi={voice.midi} />
          ))}
        </div>
      </div>
    </div>
  );
}
