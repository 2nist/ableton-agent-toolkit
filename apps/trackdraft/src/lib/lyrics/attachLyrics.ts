import {
  sectionDurationBeats,
  type BlueprintSong,
  type BlueprintSection,
  type LyricsSourceRef,
} from "../../types/blueprint";
import { parseSyncedLyrics } from "@music-theory/song-blueprint";

/**
 * Attaching a lyrics record to a song.
 *
 * Shared by the importer's automatic lookup and the user-initiated search in
 * the Lyrics dock, because they must produce the same result: a search you
 * triggered by hand should not lay the words out differently from the one the
 * importer would have done.
 *
 * Sections are walked in song order and a synced line lands on the section
 * whose span contains its beat. Spans come from `sectionDurationBeats`, which
 * reads the section's own meter — the previous implementation multiplied
 * `bars × numerator`, so every 7/8 or 6/8 section silently swallowed too many
 * beats and the words after it shifted earlier and earlier.
 */

/** Roles that never carry words: an instrumental solo has nothing to sing. */
export const INSTRUMENTAL_ROLES = new Set(["solo", "intro", "outro", "breakdown"]);

export interface LyricsSource {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export interface AttachLyricsResult {
  song: BlueprintSong;
  /** Lines placed on a section. */
  lines: number;
  /** Sections that received at least one line. */
  sections: number;
  /** Lines timed past the end of the last section — the record is longer than
   *  the arrangement, which is worth saying out loud instead of dropping them. */
  unplaced: number;
  /** True when the source actually carried words. */
  attached: boolean;
  /** True when the record had no line timing and the text went to one section. */
  plainOnly: boolean;
}

function sectionWithLyrics(
  section: BlueprintSection,
  lyrics: string | undefined,
  timeline: { text: string; startBeat: number }[] | undefined,
): BlueprintSection {
  return {
    ...section,
    lyrics,
    lyricsTimeline: timeline && timeline.length > 0 ? timeline : undefined,
  };
}

/**
 * Put `source`'s words on `song`. Pure: returns a new song, never mutates.
 *
 * - Synced record → lines are placed by beat across the arrangement.
 * - Plain record → the whole text goes on the first singable section, with no
 *   timeline (there is nothing to time it to, and inventing spacing would be
 *   a lie the editor then has to undo).
 * - No sections yet → one "Full Song" section is created to hold them.
 */
function attachWithoutSource(song: BlueprintSong, source: LyricsSource): AttachLyricsResult {
  const synced = (source.syncedLyrics ?? "").trim();
  const plain = (source.plainLyrics ?? "").trim();

  if (!synced && !plain) {
    return { song, lines: 0, sections: 0, unplaced: 0, attached: false, plainOnly: false };
  }

  const timeline = synced ? parseSyncedLyrics(synced, song.bpm || 120) : [];

  // No timing: one honest block of text, on the first section that can sing.
  if (timeline.length === 0) {
    const text = plain || synced;
    const target = song.sections.find((section) => !INSTRUMENTAL_ROLES.has(section.role));
    if (!target) {
      if (song.sections.length === 0) {
        const sectionId = crypto.randomUUID();
        const lines = text.split("\n").filter((line) => line.trim()).length;
        return {
          song: {
            ...song,
            sections: [
              {
                id: sectionId,
                name: "Full Song",
                role: "verse",
                bars: Math.max(16, Math.ceil(lines / 4)),
                chords: [],
                beatsPerChord: 4,
                velocity: "mf",
                timeSignatureNumerator: song.timeSignatureNumerator,
                timeSignatureDenPower: Math.log2(song.timeSignatureDenominator || 4),
                lyrics: text,
              },
            ],
            arrangement: [{ sectionId, repeats: 1 }],
          },
          lines,
          sections: 1,
          unplaced: 0,
          attached: true,
          plainOnly: true,
        };
      }
      return { song, lines: 0, sections: 0, unplaced: 0, attached: false, plainOnly: true };
    }
    const lines = text.split("\n").filter((line) => line.trim()).length;
    return {
      song: {
        ...song,
        sections: song.sections.map((section) =>
          section.id === target.id ? sectionWithLyrics(section, text, undefined) : section,
        ),
      },
      lines,
      sections: 1,
      unplaced: 0,
      attached: true,
      plainOnly: true,
    };
  }

  const entries = timeline.map((entry) => ({ text: entry.text, startBeat: entry.startBeat }));

  if (song.sections.length === 0) {
    const sectionId = crypto.randomUUID();
    const fullText = plain || entries.map((entry) => entry.text).join("\n");
    return {
      song: {
        ...song,
        sections: [
          {
            id: sectionId,
            name: "Full Song",
            role: "verse",
            bars: Math.max(16, Math.ceil(entries.length / 4)),
            chords: [],
            beatsPerChord: 4,
            velocity: "mf",
            timeSignatureNumerator: song.timeSignatureNumerator,
            timeSignatureDenPower: Math.log2(song.timeSignatureDenominator || 4),
            lyrics: fullText,
            lyricsTimeline: entries,
          },
        ],
        arrangement: [{ sectionId, repeats: 1 }],
      },
      lines: entries.length,
      sections: 1,
      unplaced: 0,
      attached: true,
      plainOnly: false,
    };
  }

  let cursor = 0;
  let placed = 0;
  let filled = 0;
  /** Lines that landed on an instrumental section, or past the last one —
   *  counted rather than quietly dropped, because "the record is longer than
   *  your arrangement" is something the person attaching it should hear. */
  let homeless = 0;
  const sections = song.sections.map((section) => {
    const span = sectionDurationBeats(section);
    const start = cursor;
    const end = cursor + span;
    cursor = end;

    const inside = entries.filter((entry) => entry.startBeat >= start && entry.startBeat < end);
    if (INSTRUMENTAL_ROLES.has(section.role)) {
      homeless += inside.length;
      return section;
    }
    if (inside.length === 0) return sectionWithLyrics(section, undefined, undefined);
    placed += inside.length;
    filled += 1;
    return sectionWithLyrics(
      section,
      inside.map((entry) => entry.text).join("\n"),
      inside.map((entry) => ({ text: entry.text, startBeat: Math.max(0, entry.startBeat - start) })),
    );
  });

  const unplaced = homeless + entries.filter((entry) => entry.startBeat >= cursor).length;
  // A record that stops before the last section is normal; one that runs past
  // the arrangement means the song is shorter than the recording.
  const attached = placed > 0 || unplaced > 0;

  return { song: { ...song, sections }, lines: placed, sections: filled, unplaced, attached, plainOnly: false };
}

/**
 * `attachLyrics`, plus the record it came from.
 *
 * The ref is optional because words can arrive without a record (a pasted
 * .lrc file, a MIDI import that carried lyrics). When there IS one, it is
 * stamped on the song: the lyrics search then knows which record is in use,
 * and a wrong pick can be replaced without guessing what the importer chose.
 */
export function attachLyrics(
  song: BlueprintSong,
  source: LyricsSource,
  ref?: LyricsSourceRef,
): AttachLyricsResult {
  const result = attachWithoutSource(song, source);
  if (!result.attached || !ref) return result;
  return {
    ...result,
    song: {
      ...result.song,
      lyricsSource: { ...ref, attachedAt: ref.attachedAt ?? new Date().toISOString() },
    },
  };
}
