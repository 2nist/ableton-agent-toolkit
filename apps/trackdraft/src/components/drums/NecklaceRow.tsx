import { VOICE_COLOR, VOICE_LABEL } from "./voiceStyle";
import NecklaceGlyph from "./NecklaceGlyph";
import type { VoiceNecklace } from "../../lib/playback/drumPreview";

/** One necklace per voice present in an already-resolved groove — pure
 *  presentation, no opinion about where the necklaces came from. Used by
 *  `structure/DrumNecklacePreview.tsx` (a preset+variant) and the Drum
 *  Pattern tab (`DrumPatternTools.tsx` — either a preset+variant or a
 *  `drumMeterOutline` outline) so both authoring modes preview
 *  identically. `large` renders a bigger glyph for the primary per-voice
 *  editor, where the pattern is the main focus rather than a compact
 *  lane overview. */
export default function NecklaceRow({ necklaces, large }: { necklaces: VoiceNecklace[] | null; large?: boolean }) {
  if (!necklaces || necklaces.length === 0) {
    return <p className="text-3xs text-inkMuted/70 italic">No resolvable hits.</p>;
  }

  const R = large ? 28 : 20;
  const PAD = large ? 10 : 8;
  const SIZE = (R + PAD) * 2;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-end pt-1">
      {necklaces.map((n) => (
        <div key={n.voice} className="flex flex-col items-center gap-0.5" title={`${n.count} hit${n.count === 1 ? "" : "s"} per loop`}>
          <svg width={SIZE} height={SIZE} viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}>
            <NecklaceGlyph cx={0} cy={0} radius={R} hits={n.hits} steps={n.steps} color={VOICE_COLOR[n.voice] ?? "#8B94A1"} />
          </svg>
          <span className="font-mono text-3xs text-inkMuted uppercase tracking-wide">{VOICE_LABEL[n.voice]}</span>
        </div>
      ))}
    </div>
  );
}
