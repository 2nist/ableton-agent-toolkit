/**
 * Seed material for the Spark generator, split into the five dimensions of the
 * original prompt list (subject · perspective · rule · challenge, with the
 * musical anchor now coming from lyricBrief.ts's real harmony/melody data).
 *
 * Entries carry tags so random combinations can't contradict each other or
 * land in the wrong place:
 *   pronouns   which pronoun families a perspective speaks in
 *   forbids    which pronoun families a rule makes impossible
 *   roles      section roles a rule only makes sense for
 *   scope      "section" prompts fit one section; "song" prompts need the whole song
 *   fixesPov / overridesPerspective   the entry already chooses a point of view
 */
import type { SectionRole } from "./lyricBrief";

export type Pronoun = "I" | "you" | "third";

export interface SubjectEntry { text: string; fixesPov?: boolean }
export interface PerspectiveEntry { text: string; pronouns: Pronoun[] }
export interface RuleEntry {
  text: string;
  roles?: SectionRole[];
  scope: "section" | "song";
  forbids?: Pronoun[];
  overridesPerspective?: boolean;
}
export interface ChallengeEntry { text: string; scope: "section" | "song" }

export const SUBJECTS: readonly SubjectEntry[] = [
  { text: "breaking up suddenly after discovering a secret" },
  { text: "a complicated, non-traditional form of love" },
  { text: "the daily commute under an absolute dictatorship" },
  { text: "a carpenter living on an isolated 500-person island" },
  { text: "drinking alcohol at dawn and coffee at night" },
  { text: "a dog lost in a city trying to find its way home" },
  { text: "the last surviving human on Earth looking at extinct tech" },
  { text: "a sweet potato that bears an uncanny resemblance to a celebrity" },
  { text: "living with an AI or robot partner in the year 2050" },
  { text: "an astronaut adrift after snapping their tether" },
  { text: "forgiving a childhood bully years after the fact" },
  { text: "a society that traded money for direct barter" },
  { text: "running a 200-mile ultra-marathon to escape grief" },
  { text: "a young idealist entering high-stakes political corruption" },
  { text: "the feeling of living for 500 years while everyone else ages" },
  { text: "a psychedelic awakening during an ordinary household chore" },
  { text: "buying a one-way ticket to a country where you don't speak the language" },
  { text: "the tension between material wealth and a single irreplaceable memory" },
  { text: "an argument from the exact perspective of the person you fought with", fixesPov: true },
  { text: "the life and death of a medieval mystic" },
];

export const PERSPECTIVES: readonly PerspectiveEntry[] = [
  { text: "First-person ('I') with intense emotional vulnerability", pronouns: ["I"] },
  { text: "Second-person ('You') addressed directly to an enemy", pronouns: ["you"] },
  { text: "Second-person ('You') to an imaginary or future lover", pronouns: ["you"] },
  { text: "Third-person observer watching a stranger in a crowd", pronouns: ["third"] },
  { text: "An innocent non-human entity (without revealing its nature)", pronouns: [] },
  { text: "A parent addressing their child 20 years in the future", pronouns: ["I", "you"] },
  { text: "A citizen speaking under heavy surveillance", pronouns: [] },
  { text: "An exhausted artisan whose craft is their entire identity", pronouns: [] },
];

export const RULES: readonly RuleEntry[] = [
  // from the original list
  { text: "Never use the word 'love' or 'you'", scope: "section", forbids: ["you"] },
  { text: "Never use the letter 'm' anywhere in the lyrics", scope: "section" },
  { text: "Write using strictly single-syllable words", scope: "section" },
  { text: "Each line must start with consecutive letters of the alphabet (A-Z)", scope: "song" },
  { text: "Limit the entire vocabulary to only 12 unique words", scope: "section" },
  { text: "Construct the chorus hook as a single direct question", scope: "section", roles: ["chorus"] },
  { text: "Describe your favorite food or object without ever naming it", scope: "section" },
  { text: "Write without using any pronouns (no I, you, he, she, they)", scope: "section", forbids: ["I", "you", "third"] },
  { text: "Use the cut-up method: randomize words from a non-fiction book", scope: "section" },
  { text: "Frame every phrase as a Public Service Announcement", scope: "section" },
  // craft constraints
  { text: "Write it with no adjectives, then add back only the ones you miss.", scope: "section" },
  { text: "End every line on a one-syllable word.", scope: "section" },
  { text: "Name one physical object in the room where this happens.", scope: "section" },
  { text: "Write the line the narrator is afraid to say, then say it indirectly.", scope: "section" },
  { text: "Change the tense between the first line and the last.", scope: "section" },
  { text: "Give every line a noun you could photograph.", scope: "section", roles: ["verse", "pre_chorus"] },
  { text: "Let the second half of the section contradict the first.", scope: "section", roles: ["verse", "bridge"] },
  { text: "Say it in fewer words than the longest verse line.", scope: "section", roles: ["chorus"] },
  { text: "Put the title where the melody is longest.", scope: "section", roles: ["chorus"] },
  { text: "Write it from the other person's point of view.", scope: "section", roles: ["bridge"], overridesPerspective: true },
  { text: "Say the thing the chorus can't.", scope: "section", roles: ["bridge"] },
  { text: "Repeat the first line of the song with one word changed.", scope: "section", roles: ["outro"] },
];

export const CHALLENGES: readonly ChallengeEntry[] = [
  { text: "10-Minute Blitz: Write 2 verses and a chorus before the timer rings.", scope: "song" },
  { text: "Wake-Up Draft: Write this within 20 minutes of waking up.", scope: "section" },
  { text: "1-Hour Finish: Complete the full draft and record a vocal scratch within 60 minutes.", scope: "song" },
  { text: "Breath Ritual: Focus on 5-second breath cycles for 5 minutes before writing.", scope: "section" },
  { text: "The Performance Test: The prompt must make you laugh or cry out loud when performed.", scope: "section" },
];
