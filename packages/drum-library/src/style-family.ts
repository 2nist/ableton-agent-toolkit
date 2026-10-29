/**
 * Map a song's self-description onto an E-GMD style family.
 *
 * The corpus is labelled by style — `funk/groove1`, `rock`, `latin` — and the
 * baked presets now carry that label per variant. This is the bridge between
 * the free text a blueprint has (`genre`, `concept`, `notes.instrumentation`)
 * and those 17 families.
 *
 * Why it matters: the pattern vocabulary is feel-only (`standard`, `driving`,
 * `intense`…). Without this, a funk song and a rock song with the same energy
 * draw the same variants and differ only by seed. With it, `standard` still
 * means "a standard groove" but the *performances* inside it are drawn from
 * the right tradition.
 *
 * Deliberately a plain keyword table: genre strings are free text, so the
 * honest failure mode is "no family" (fall back to the whole pool) rather
 * than a confident wrong guess. Order matters — the first match wins, and
 * more specific families are listed before the broad ones they'd collide
 * with ("pop rock" reads as rock, "folk rock" as rock, not pop or country).
 */
export type EStyleFamily =
  | "punk"
  | "afrocuban"
  | "neworleans"
  | "gospel"
  | "reggae"
  | "hiphop"
  | "dance"
  | "funk"
  | "soul"
  | "jazz"
  | "latin"
  | "country"
  | "blues"
  | "afrobeat"
  | "middleeastern"
  | "rock"
  | "pop";

const TABLE: Array<[EStyleFamily, RegExp]> = [
  ["punk", /\b(punk|hardcore|emo|screamo|post-?punk)\b/i],
  ["afrocuban", /\b(afro-?cuban|son\s+cubano|mambo|rumba|guaguanc[oó]|timba|bolero)\b/i],
  ["neworleans", /\b(new\s+orleans|second\s+line|zydeco|brass\s+band)\b/i],
  ["gospel", /\b(gospel|spiritual|hymn|worship)\b/i],
  ["reggae", /\b(reggae|ska|dub|dancehall|rocksteady)\b/i],
  ["hiphop", /\b(hip[\s-]?hop|rap|boom\s?bap|trap|drill|808)\b/i],
  ["dance", /\b(dance|edm|house|techno|trance|electro|big\s+beat)\b/i],
  ["funk", /\b(funk|funky|james\s+brown|p-?funk)\b/i],
  ["soul", /\b(soul|motown|r&b|rnb|neo[\s-]?soul|stax)\b/i],
  ["jazz", /\b(jazz|bebop|bop|fusion|swing|big\s+band|ragtime)\b/i],
  ["latin", /\b(latin|salsa|samba|bossa|tango|cumbia|m[úu]sica\s+brasileira|brazil)\b/i],
  ["country", /\b(country|bluegrass|americana|honky[\s-]?tonk|western\s+swing)\b/i],
  ["blues", /\b(blues|shuffle|boogie|delta)\b/i],
  ["afrobeat", /\b(afrobeat|afro-?pop|highlife|juju)\b/i],
  ["middleeastern", /\b(middle\s+eastern|arabic|maqam|turkish|persian|klezmer)\b/i],
  ["rock", /\b(rock|grunge|metal|shoegaze|indie|garage|surf|grrl|psychedelic|post-?rock)\b/i],
  ["pop", /\b(pop|top\s?40|boy\s?band|girl\s?group|synth[\s-]?pop|britpop)\b/i],
];

export interface StyleSignals {
  genre?: string;
  concept?: string;
  title?: string;
  instrumentation?: string[];
}

/**
 * The style family for a song, or `undefined` when nothing matches.
 *
 * `genre` is tried first and alone: it's the field that actually claims a
 * style. Only when it yields nothing do the free-text fields get a look,
 * because "rock" in an instrumentation list ("rock organ") says less about
 * the groove than the genre does.
 */
export function styleFamilyFor(song: StyleSignals | null | undefined): EStyleFamily | undefined {
  if (!song) return undefined;
  const genre = song.genre?.trim();
  if (genre) {
    const hit = match(genre);
    if (hit) return hit;
  }
  const loose = [song.concept, song.title, song.instrumentation?.join(" ")]
    .filter(Boolean)
    .join(" ");
  return loose ? match(loose) : undefined;
}

function match(text: string): EStyleFamily | undefined {
  for (const [family, pattern] of TABLE) {
    if (pattern.test(text)) return family;
  }
  return undefined;
}

/**
 * Which corpus families are musically interchangeable with each other.
 *
 * Restricting selection to the song's exact family is too literal: a rock
 * song and a blues shuffle share a backbeat, a Latin tune and a jazz tune
 * share a ride pattern, and the bake only holds a handful of takes per
 * family. Selecting within a *neighbourhood* keeps the performance in the
 * right tradition while leaving enough variants that a 300-section catalogue
 * doesn't loop six grooves.
 *
 * The song's own family is always first — it is a preference order, not a
 * set membership test.
 */
const NEIGHBOURS: Record<EStyleFamily, EStyleFamily[]> = {
  rock: ["rock", "pop", "punk", "blues"],
  pop: ["pop", "rock", "soul", "funk"],
  punk: ["punk", "rock", "pop"],
  blues: ["blues", "rock", "country", "jazz"],
  funk: ["funk", "soul", "hiphop", "afrobeat"],
  soul: ["soul", "funk", "gospel", "hiphop"],
  hiphop: ["hiphop", "funk", "dance", "soul"],
  dance: ["dance", "hiphop", "pop"],
  gospel: ["gospel", "soul", "country"],
  country: ["country", "blues", "gospel"],
  jazz: ["jazz", "latin", "afrocuban", "neworleans", "blues"],
  latin: ["latin", "afrocuban", "jazz"],
  afrocuban: ["afrocuban", "latin", "jazz"],
  neworleans: ["neworleans", "funk", "jazz", "afrocuban"],
  afrobeat: ["afrobeat", "funk", "latin"],
  middleeastern: ["middleeastern", "latin", "jazz"],
  reggae: ["reggae", "afrobeat", "funk"],
};

/** The song's family first, then the neighbours it can substitute for. */
export function styleAffinity(style: string | undefined): string[] {
  if (!style) return [];
  const family = style as EStyleFamily;
  return NEIGHBOURS[family] ?? [style];
}
