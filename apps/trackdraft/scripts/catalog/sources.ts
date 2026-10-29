/**
 * Which corpus each catalogue song came from, and what may legally be done
 * with it.
 *
 * This is the single place the licence policy lives. The pipeline is allowed
 * to *build* everything; only the packaging step consults `redistributable`.
 * Keeping the two apart matters: research corpora are legitimate inputs to a
 * local library and illegitimate contents of a shipped installer, and the only
 * way to hold that line is to name it once and check it mechanically.
 *
 * Song provenance in the JSON files is NOT sufficient for this: every file in
 * `scripts/output/catalog` records `provenance.source = "catalog-lookup"`
 * regardless of which corpus produced it. Identity therefore comes from the id
 * prefix the ingest mints (and, failing that, the directory it was found in).
 */

export type LicenceClass =
  /** Third-party copyrighted work: chords/lyrics are derivative, no licence to redistribute. */
  | "copyrighted"
  /** Research corpus with academic-use terms; redistribution is not granted. */
  | "research-only"
  /** Written by the user (or otherwise cleared for this app). */
  | "cleared"
  /** No classification on record — must be treated as unusable for shipping. */
  | "unknown";

export interface CorpusSource {
  /** Stable key written into the manifest. */
  key: string;
  /** Prefix of the song ids this ingest mints, e.g. `beatles-`. */
  idPrefix: string;
  /** Human label for reports. */
  label: string;
  licence: LicenceClass;
  /** One line suitable for a third-party notice. */
  licenceNote: string;
  /** May this material ship inside an app binary/installer? */
  redistributable: boolean;
  /** Environment variable pointing at the corpus (for "how to rebuild"). */
  rootEnv: string;
  /** The script that produces songs of this source. */
  ingestScript: string;
  /** Output directory name used when the source cannot be inferred from the id. */
  dirName: string;
}

export const CORPUS_SOURCES: readonly CorpusSource[] = [
  {
    key: "beatles",
    idPrefix: "beatles-",
    label: "The Beatles (chord charts + lyrics)",
    licence: "copyrighted",
    licenceNote:
      "Chord charts transcribed from a third-party analysis; lyrics from LRCLIB. Both are derivative of copyrighted works — no redistribution granted.",
    redistributable: false,
    rootEnv: "BEATLES_CHORDS_DIR",
    ingestScript: "scripts/ingest-beatles-catalog.ts",
    dirName: "catalog",
  },
  {
    key: "mcgill",
    idPrefix: "mcgill-",
    label: "McGill Billboard / SALAMI corpus",
    licence: "research-only",
    licenceNote:
      "Academic research corpus (chord annotations + SALAMI structural labels). Research use only; redistribution is not granted by the corpus.",
    redistributable: false,
    rootEnv: "MCGILL_ROOT",
    ingestScript: "scripts/ingest-mcgill-catalog.ts",
    dirName: "mcgill-catalog",
  },
  {
    key: "rock",
    idPrefix: "rock-",
    label: "Rock Corpus (TDC)",
    licence: "research-only",
    licenceNote:
      "Academic research corpus of rock harmony. Research use only; redistribution is not granted by the corpus.",
    redistributable: false,
    rootEnv: "ROCK_CORPUS_ROOT",
    ingestScript: "scripts/ingest-rock-corpus-catalog.ts",
    dirName: "rock-catalog",
  },
  {
    key: "lalo-chezia",
    idPrefix: "lalo-chezia-",
    label: "Lalo Chezia source material",
    licence: "copyrighted",
    licenceNote:
      "Third-party artist's own source documents. Ingested for study; no redistribution granted.",
    redistributable: false,
    rootEnv: "LALO_CHEZIA_ROOT",
    ingestScript: "scripts/ingest-lalo-chezia.ts",
    dirName: "catalog",
  },
  {
    key: "local",
    idPrefix: "local-",
    label: "Locally authored / cleared",
    licence: "cleared",
    licenceNote: "Authored by the user, or cleared for redistribution by the user.",
    redistributable: true,
    rootEnv: "(none — authored in-app or imported)",
    ingestScript: "(none)",
    dirName: "local-catalog",
  },
];

/** Used when a song's origin cannot be established — never ship it. */
export const UNKNOWN_SOURCE: CorpusSource = {
  key: "unknown",
  idPrefix: "",
  label: "Unclassified",
  licence: "unknown",
  licenceNote: "Origin not recorded. Treat as unusable for redistribution until identified.",
  redistributable: false,
  rootEnv: "(unknown)",
  ingestScript: "(unknown)",
  dirName: "",
};

/**
 * Which corpus a song belongs to.
 *
 * Id prefix first (it survives being copied between directories), then the
 * directory it was found in, then unknown. `unknown` is deliberately not
 * shippable — a puzzle solved by guessing is not a licence.
 */
export function sourceForSong(songId: string | null | undefined, dirName?: string | null): CorpusSource {
  const id = (songId ?? "").toLowerCase();
  if (id) {
    const byPrefix = CORPUS_SOURCES.filter((source) => source.idPrefix && id.startsWith(source.idPrefix));
    if (byPrefix.length > 0) {
      // Longest prefix wins, so a future `rock-corpus-` beats `rock-`.
      return byPrefix.reduce((best, current) =>
        current.idPrefix.length > best.idPrefix.length ? current : best,
      );
    }
  }
  // Directory fallback applies to RESTRICTED sources only. Guessing provenance
  // may make a song less shippable, never more: a file dropped into
  // `local-catalog/` must not inherit shipping rights from the folder it
  // happens to sit in. Cleared status requires the `local-` id prefix or an
  // explicit entry in starter-allowlist.json.
  const dir = (dirName ?? "").toLowerCase();
  if (dir) {
    const byDir = CORPUS_SOURCES.find(
      (source) => source.dirName === dir && source.redistributable === false,
    );
    if (byDir) return byDir;
  }
  return UNKNOWN_SOURCE;
}

/** Look a source up by its manifest key. */
export function sourceByKey(key: string | null | undefined): CorpusSource {
  const match = CORPUS_SOURCES.find((source) => source.key === key);
  return match ?? UNKNOWN_SOURCE;
}

/** True only when the source is positively cleared for shipping. */
export function isRedistributable(source: CorpusSource): boolean {
  return source.redistributable === true && source.licence === "cleared";
}

/** Sources whose material must not be included in a distributed build. */
export function restrictedSources(): CorpusSource[] {
  return CORPUS_SOURCES.filter((source) => !source.redistributable);
}
