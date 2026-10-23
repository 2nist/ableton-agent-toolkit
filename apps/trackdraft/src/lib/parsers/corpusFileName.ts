/**
 * Corpus file names carry the metadata the files themselves do not.
 *
 * CoCoPops names every file `<Artist>_<TitleInCamelCase>_<Year>.mid` —
 * `ABBA_DancingQueen_1976.mid`. Deriving the title by replacing underscores
 * with spaces gave "ABBA DancingQueen 1976", which is not a song title by any
 * measure: the lyrics matcher cannot find it, the library cannot sort it, and
 * the song reads as if it were called that. Splitting the name properly costs
 * one function and makes 371 files searchable.
 *
 * Deliberately conservative: this only fires when the last part is a four-digit
 * year and there are at least three parts, so an ordinary `My Song.mid` is
 * left alone.
 */

export interface CorpusFileName {
  artist: string;
  title: string;
  year?: number;
}

/** `DancingQueen` → `Dancing Queen`; leaves already-spaced text alone. */
function splitCamelCase(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a corpus file stem, or `null` when it does not look like one. */
export function parseCorpusFileName(stem: string): CorpusFileName | null {
  const parts = stem.split("_").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const last = parts[parts.length - 1];
  if (!/^(19|20)\d{2}$/.test(last)) return null;

  const artist = splitCamelCase(parts[0]);
  const titleWords = parts.slice(1, -1).map(splitCamelCase);
  const title = titleWords.join(" ").trim();
  if (!artist || !title) return null;

  return { artist, title, year: Number(last) };
}

/** A performer credit as it appears after a dash: two or three capitalised
 *  words, no digits. */
const CREDIT_SHAPE = /^[A-Z][\w.'\u2019]*(?:\s+[A-Z][\w.'\u2019]*){1,2}$/;

/** `EchidnasArf(OfYou)` → `Echidnas Arf (Of You)`, `cheap-thrills` →
 *  `Cheap Thrills`, `Little house I used to live in` left alone. */
export function prettifyStem(stem: string): string {
  let out = stem.trim();
  const separated = /[-_]/.test(out) && !/\s/.test(out);
  if (separated) {
    out = out.replace(/[-_]+/g, " ").replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
  } else {
    out = splitCamelCase(out);
  }
  return out
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Names that are not the CoCoPops `<Artist>_<Title>_<Year>` shape but still
 * carry metadata:
 *
 *   `Montana - Frank Zappa`      → title + credited artist
 *   `EchidnasArf(OfYou)`         → title only, camel case split
 *   `cheap-thrills`              → title only, kebab case title-cased
 *
 * The artist credit is only taken when the tail is *name-shaped*, so a title
 * that merely contains a dash (`Any Way the Wind Blows - Part 2`) keeps its
 * whole self.
 */
export function parseChartFileName(stem: string): { title: string; artist?: string } | null {
  const trimmed = stem.trim();
  if (!trimmed) return null;

  const credited = trimmed.match(/^(.*\S)\s+-\s+([^-]+)$/);
  if (credited) {
    const [, head, tail] = credited;
    if (CREDIT_SHAPE.test(tail.trim()) && !/\d/.test(tail)) {
      return { title: prettifyStem(head), artist: tail.trim() };
    }
  }
  return { title: prettifyStem(trimmed) };
}
