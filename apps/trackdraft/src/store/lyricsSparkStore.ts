import { create } from "zustand";
import { readStorage, writeStorage } from "./storage";
import { STORAGE_KEYS } from "../lib/persistence/keys";

const STORAGE_KEY = STORAGE_KEYS.lyricsSpark.key;

/**
 * The lyrics engine is deterministic: the same section + the same integer
 * gives the same brief/spark forever, so the UI stores the integers — not the
 * generated text. These counters are what "reroll" actually changes, and they
 * persist (like every other store here) so reopening a section shows the same
 * prompts you were working from.
 *
 *  - `briefRerollBySection` — `buildBrief`'s `reroll` (melody peak pick,
 *    suggested rhyme scheme).
 *  - `sparkRollBySection` — `composeSpark`'s `roll` (rule / POV / challenge).
 *  - `subjectRollBySong` — `composeSpark`'s `subjectRoll`. Song-scoped on
 *    purpose: the subject is sticky across a song's sections, so rolling it in
 *    the verse must also move the chorus.
 *  - `sparkLevelBySection` — "section" (default) or "song": whether whole-song
 *    rules/challenges are eligible here.
 */
interface LyricsSparkPersisted {
  briefRerollBySection: Record<string, number>;
  sparkRollBySection: Record<string, number>;
  subjectRollBySong: Record<string, number>;
  sparkLevelBySection: Record<string, "section" | "song">;
}

interface LyricsSparkState extends LyricsSparkPersisted {
  bumpBriefReroll: (sectionId: string) => void;
  bumpSparkRoll: (sectionId: string) => void;
  bumpSubjectRoll: (songId: string) => void;
  setSparkLevel: (sectionId: string, level: "section" | "song") => void;
}

const EMPTY: LyricsSparkPersisted = {
  briefRerollBySection: {},
  sparkRollBySection: {},
  subjectRollBySong: {},
  sparkLevelBySection: {},
};

export const useLyricsSparkStore = create<LyricsSparkState>((set, get) => {
  /** Persist the current counters — called after every mutation. */
  const persist = (): void => {
    const { briefRerollBySection, sparkRollBySection, subjectRollBySong, sparkLevelBySection } = get();
    writeStorage(STORAGE_KEY, { briefRerollBySection, sparkRollBySection, subjectRollBySong, sparkLevelBySection });
  };

  /** Increment `map[id]`, returning the next value. */
  const bump = (map: Record<string, number>, id: string): Record<string, number> => ({
    ...map,
    [id]: (map[id] ?? 0) + 1,
  });

  return {
    ...EMPTY,
    ...readStorage<Partial<LyricsSparkPersisted>>(STORAGE_KEY, {}),

    bumpBriefReroll: (sectionId) => {
      set((s) => ({ briefRerollBySection: bump(s.briefRerollBySection, sectionId) }));
      persist();
    },
    bumpSparkRoll: (sectionId) => {
      set((s) => ({ sparkRollBySection: bump(s.sparkRollBySection, sectionId) }));
      persist();
    },
    bumpSubjectRoll: (songId) => {
      set((s) => ({ subjectRollBySong: bump(s.subjectRollBySong, songId) }));
      persist();
    },
    setSparkLevel: (sectionId, level) => {
      set((s) => ({ sparkLevelBySection: { ...s.sparkLevelBySection, [sectionId]: level } }));
      persist();
    },
  };
});
