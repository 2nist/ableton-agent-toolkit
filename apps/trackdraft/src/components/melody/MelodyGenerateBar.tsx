import { useSongStore } from "../../store/songStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { updateSection } from "../../lib/sections";
import { resolveStyleProfile } from "../../lib/style/bend";
import { askConfirm } from "../../lib/confirm";
import {
  canAutoFill,
  generateSectionMelody,
  melodyParamsDiffer,
  melodyParamsFromProfile,
  melodySeedFor,
} from "../../lib/melody/autoFill";
import type { BlueprintSection, BlueprintSong, MelodyTrack } from "../../types/blueprint";

/**
 * Auto-fill / reroll controls for a section's melody, driven by the Mix/Bend
 * melody axes. Generation is deterministic per seed + bend; the stored
 * `params` let the bar show "bend changed — rebuild" instead of silently
 * overwriting a line the user already accepted.
 */
export default function MelodyGenerateBar({
  song,
  section,
  sectionId,
  compact = false,
}: {
  song: BlueprintSong;
  section: BlueprintSection;
  sectionId: string;
  compact?: boolean;
}) {
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const profile = resolveStyleProfile(section, song);
  const currentParams = melodyParamsFromProfile(profile);
  const melody = section.melody;
  const generated = melody?.source === "generated";
  const edited = melody?.source === "edited";
  const stale = generated && melodyParamsDiffer(melody?.params, currentParams);
  const ready = canAutoFill(section);
  const seed = melody?.seed ?? melodySeedFor(section.id);

  function writeTrack(track: MelodyTrack) {
    updateCurrentSong((s) =>
      updateSection(s, sectionId, (sec) => ({ ...sec, melody: track })),
    );
  }

  function fill(nextSeed: number) {
    const track = generateSectionMelody({
      section,
      song,
      seed: nextSeed,
      sectionKey: section.key ?? song.key,
      sectionScale: section.scale ?? song.scale,
    });
    if (track) writeTrack(track);
  }

  async function autoFill() {
    if (melody?.notes.length) {
      const ok = await askConfirm({
        title: "Replace melody",
        message: generated
          ? "Rebuild this generated line from the current Bend?"
          : "This section has a recorded melody. Replace it with an auto-filled line? The take can be re-recorded.",
        confirmLabel: "Replace",
        danger: true,
      });
      if (!ok) return;
    }
    fill(seed);
  }

  function reroll() {
    const next = (Math.floor(Math.random() * 2_147_483_000) + 1) % 2_147_483_647;
    fill(next || 1);
  }

  async function clear() {
    const ok = await askConfirm({
      title: "Clear melody",
      message: `Remove the melody from "${section.name}"?`,
      confirmLabel: "Clear",
      danger: true,
    });
    if (!ok) return;
    updateCurrentSong((s) =>
      updateSection(s, sectionId, (sec) => {
        const { melody: _drop, ...rest } = sec;
        return rest as BlueprintSection;
      }),
    );
  }

  const btn =
    "rounded border px-2 py-0.5 text-[10px] font-mono whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed";
  const primary = `${btn} border-accent bg-accent text-black font-medium hover:bg-accent/90`;
  const secondary = `${btn} border-edge text-inkMuted hover:text-ink hover:bg-panelAlt`;
  const ghost = `${btn} border-transparent text-inkMuted/70 hover:text-ink`;

  return (
    <div
      className={`flex items-center gap-1.5 flex-wrap rounded border border-edge/60 bg-panelAlt/30 px-2 py-1.5 ${
        compact ? "text-[10px]" : "text-xs"
      }`}
    >
      <span className="font-mono text-[9px] uppercase tracking-wider text-accent/80">Melody</span>

      {!ready ? (
        <span className="font-mono text-[9px] text-inkMuted/60">
          add chords first — the line rides the progression
        </span>
      ) : generated ? (
        <>
          <span
            className="font-mono text-[9px] text-accent/80"
            title="Generated from the MIDI-corpus melody model; deterministic per seed + Bend"
          >
            ✨ generated · seed {seed}
          </span>
          {stale && (
            <button
              type="button"
              className={primary}
              onClick={() => void autoFill()}
              title="The Mix/Bend melody axes changed since this line was generated — rebuild it from the new shape"
            >
              ◆ Rebuild from Bend
            </button>
          )}
          <button type="button" className={secondary} onClick={reroll} title="Same Bend, a different seed">
            Reroll
          </button>
          <button type="button" className={ghost} onClick={() => void clear()} title="Remove this melody">
            Clear
          </button>
        </>
      ) : melody?.notes.length ? (
        <>
          <span
            className="font-mono text-[9px] text-inkMuted/60"
            title={
              edited
                ? "Hand-edited — exports exactly as drawn (no Bend contour re-shaping, no rebuild nudge)"
                : "Captured from the mic — the Bend contour still shapes it at render time"
            }
          >
            {edited ? "✎ edited" : "recorded"}
          </span>
          <button
            type="button"
            className={primary}
            onClick={() => void autoFill()}
            title="Replace this line with a corpus auto-fill shaped by the Mix/Bend"
          >
            ✨ Auto-fill
          </button>
        </>
      ) : (
        <button
          type="button"
          className={primary}
          onClick={() => void autoFill()}
          title="Generate a line from the MIDI-corpus melody model, shaped by the Mix/Bend axes"
        >
          ✨ Auto-fill
        </button>
      )}

      <span className="flex-1" />
      <button
        type="button"
        className={ghost}
        onClick={() => useInspectorStore.getState().engage("mix")}
        title="Open Mix / Bend — melody density, register, contour, rhythm, motif and space"
      >
        Bend ◉
      </button>
    </div>
  );
}
