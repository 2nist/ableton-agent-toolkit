import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { GENRE_CATALOG } from "../data/genre-catalog/index";
import { buildGenreMapPrompt, validateSongMapShape, genreMapFilename } from "../data/genre-prompt";
import type { SongMap } from "../data/songMaps";

/** The 119-genre master list, inlined here so the page doesn't need to
 *  fetch from the trackdraft-bridge extension at runtime. */
const ALL_GENRES: string[] = [
  "Abstract Hip Hop", "Art Pop", "Ballad", "Black Metal", "Blues",
  "Country Blues", "Delta Blues", "Modern Blues", "Breakbeat", "Dubstep",
  "Jungle", "Bubblegum Pop", "Cinematic", "Classic Rock", "Classical",
  "Orchestral Hybrid", "Solo Instrumental", "String Ensemble", "Vaudeville",
  "Country", "Americana", "Bluegrass", "Contemporary Country", "Traditional Country",
  "Western", "Country Folk", "Dark Electro", "Disco", "Boogie", "Nu Disco",
  "Dixieland", "Downtempo", "Chillwave", "Trip Hop", "Easy Listening",
  "Lounge", "Electro-Funk", "Synthwave", "Trance", "Trap EDM", "Vaporwave",
  "Electronica", "Euro House", "Experimental", "Experimental Electronic",
  "Experimental Hip Hop", "Alternative Folk", "Indie Folk", "Irish Folk",
  "Folktronica", "Funk", "Afro-Funk", "Funk Rock", "Hardcore Hip Hop",
  "Hardcore Punk", "Hip Hop", "Alternative Hip Hop", "Boom Bap", "Grime",
  "Lo-Fi Hip Hop", "Old School Hip Hop", "Trap", "House", "Indie Surf",
  "Industrial Metal", "Instrumental Rock", "Jazz", "Bebop", "Bossa Nova",
  "Calypso", "Flamenco", "Reggaeton", "Salsa", "Samba", "Lo-Fi",
  "Heavy Metal", "Metalcore", "Neo-Psychedelia", "Opera", "Pop", "Europop",
  "Indie Pop", "K-pop", "Pop Rock", "Synth Pop", "Post-Punk Revival",
  "Psychedelic", "Punk Rock", "R&B", "Motown", "Reggae", "Dancehall",
  "Dub", "Ska", "Alternative Rock", "Arena Rock", "Electronic Rock",
  "Folk Rock", "Garage Rock", "Grunge", "Hard Rock", "Indie Rock",
  "Post Rock", "Psychedelic Rock", "Rock and roll", "Rockabilly",
  "Roots Rock", "Soft Rock", "Surf Rock", "Shoegaze", "Smooth Soul",
  "Neo Soul", "Soul Blues", "Space Age Pop", "Stoner Rock", "Sunshine Pop",
  "Trap Metal",
];

type GenerationStatus = "idle" | "generating" | "success" | "error";

/** Slugify a genre name for loose matching — lowercase, parentheses
 *  dropped, all punctuation/whitespace removed. */
function genreSlug(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "");
}

/** Every slug a catalog map's name covers — the full name plus each
 *  segment of a compound name ("Grunge / Alternative Rock" covers both
 *  "Grunge" and "Alternative Rock"). The Workbench checks membership
 *  here instead of exact name equality, so a genre already researched
 *  under a longer catalog name (e.g. "Neo Soul" ⊂ "Neo-Soul / Jazz
 *  Fusion") stops being offered as unresearched. */
const RESEARCHED_SLUGS: Set<string> = new Set(
  GENRE_CATALOG.flatMap((m) => [
    genreSlug(m.name),
    ...m.name.split(/[/&]/).map((part) => genreSlug(part)),
  ]),
);

export default function GenreWorkbench() {
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [generatedJson, setGeneratedJson] = useState<string>("");
  const [generatedMap, setGeneratedMap] = useState<SongMap | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [error, setError] = useState<string>("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const researchedSlugs = RESEARCHED_SLUGS;

  const sortedGenres = useMemo(() => {
    return [...ALL_GENRES].sort((a, b) => {
      const aDone = researchedSlugs.has(genreSlug(a));
      const bDone = researchedSlugs.has(genreSlug(b));
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.localeCompare(b);
    });
  }, [researchedSlugs]);

  const catalogEntry = useMemo(() => {
    if (!selectedGenre) return null;
    // Same slug matching the ✓-list uses, so compound catalog names
    // ("Neo-Soul / Jazz Fusion", "Grunge / Alternative Rock") resolve to
    // their master-list entry instead of silently showing no card.
    const slug = genreSlug(selectedGenre);
    return (
      GENRE_CATALOG.find((m) => {
        if (genreSlug(m.name) === slug) return true;
        return m.name.split(/[/&]/).some((part) => genreSlug(part) === slug);
      }) ?? null
    );
  }, [selectedGenre]);

  function handleGenerate() {
    if (!selectedGenre) return;
    setStatus("generating");
    setError("");
    setValidationErrors([]);
    setGeneratedMap(null);
    setGeneratedJson("");

    // Show the prompt that an AI agent would receive.
    // In production, this would call an AI API endpoint.
    // Here we render the prompt for the user to inspect or copy for manual agent use.
    const prompt = buildGenreMapPrompt(selectedGenre);
    setGeneratedJson(prompt);
    setStatus("idle");
  }

  function handleValidateJson() {
    setValidationErrors([]);
    setGeneratedMap(null);
    try {
      const parsed = JSON.parse(generatedJson);
      const errors = validateSongMapShape(parsed);
      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }
      setGeneratedMap(parsed as SongMap);
    } catch (e) {
      setValidationErrors([`Invalid JSON: ${(e as Error).message}`]);
    }
  }

  async function handleCopyToCatalog() {
    if (!generatedMap) return;
    const json = JSON.stringify(generatedMap, null, 2);
    const filename = genreMapFilename(generatedMap);
    try {
      await navigator.clipboard.writeText(
        `// Save as: apps/trackdraft/src/data/genre-catalog/${filename}\n${json}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard write failed — copy manually from the text area.");
    }
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <Link to="/" className="text-inkMuted text-sm hover:text-ink">
          ← Back to Dashboard
        </Link>
        <h1 className="text-lg font-semibold mb-1 mt-2">Genre Map Workbench</h1>
        <p className="text-sm text-inkMuted">
          Research and generate SongMap templates for unresearched genres.
          {GENRE_CATALOG.length} of {ALL_GENRES.length} genres cataloged.
        </p>
      </div>

      <div className="flex gap-4">
        {/* Genre list */}
        <div className="w-64 flex-shrink-0 border border-edge rounded bg-panel overflow-y-auto max-h-[70vh]">
          <div className="p-2 text-xs text-inkMuted border-b border-edge">
            {ALL_GENRES.length} genres
          </div>
          {sortedGenres.map((genre) => {
            const isResearched = researchedSlugs.has(genreSlug(genre));
            return (
              <button
                key={genre}
                className={`w-full text-left px-3 py-1.5 text-sm border-b border-edge/50 transition-colors ${
                  selectedGenre?.toLowerCase() === genre.toLowerCase()
                    ? "bg-accent/20 text-ink"
                    : isResearched
                      ? "text-inkMuted line-through decoration-inkMuted/40"
                      : "text-ink hover:bg-panelAlt"
                }`}
                onClick={() => {
                  setSelectedGenre(genre);
                  setGeneratedJson("");
                  setGeneratedMap(null);
                  setStatus("idle");
                  setError("");
                  setValidationErrors([]);
                }}
              >
                {isResearched && "✓ "}
                {genre}
              </button>
            );
          })}
        </div>

        {/* Work area */}
        <div className="flex-1 space-y-4">
          {!selectedGenre ? (
            <p className="text-inkMuted text-sm">
              Select a genre from the list to begin.
            </p>
          ) : (
            <>
              {/* Existing catalog entry */}
              {catalogEntry && (
                <div className="border border-accent/30 rounded bg-accent/5 p-3">
                  <p className="text-sm font-medium text-accent mb-1">
                    ✓ Already cataloged
                  </p>
                  <p className="text-xs text-inkMuted">{catalogEntry.description}</p>
                  {catalogEntry.defaults?.genre && (
                    <p className="text-xs text-accent/80 mt-1">
                      Engine family: {catalogEntry.defaults.genre} — Groove DNA drives the drums on apply
                    </p>
                  )}
                  <p className="text-xs text-inkMuted mt-1">
                    {catalogEntry.slots.length} sections —{" "}
                    {catalogEntry.slots.map((s) => s.role).join(" → ")}
                  </p>
                </div>
              )}

              {/* Generation controls */}
              <div className="flex items-center gap-2">
                <button
                  className="bg-accent text-accentInk text-sm font-medium px-4 py-1.5 rounded disabled:opacity-50"
                  onClick={handleGenerate}
                  disabled={status === "generating"}
                >
                  {status === "generating" ? "Generating..." : "Generate prompt"}
                </button>
                <span className="text-xs text-inkMuted">
                  {selectedGenre}
                  {catalogEntry ? " (recatalog: will overwrite existing)" : ""}
                </span>
              </div>

              {error && (
                <div className="border border-danger/30 rounded bg-danger/10 p-3">
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}

              {/* JSON input / prompt display */}
              {generatedJson && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-inkMuted">
                      {generatedMap
                        ? "Validated SongMap — copy to catalog file below"
                        : "AI prompt generated — give this to an AI agent, then paste the resulting JSON back here"}
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="text-xs border border-edge rounded px-2 py-0.5 hover:bg-panelAlt disabled:opacity-50"
                        onClick={handleValidateJson}
                      >
                        Validate JSON
                      </button>
                      {generatedMap && (
                        <button
                          className="text-xs bg-accent text-accentInk rounded px-2 py-0.5 disabled:opacity-50"
                          onClick={handleCopyToCatalog}
                        >
                          {copied ? "Copied!" : "Copy to catalog"}
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    className="w-full h-64 bg-panelAlt border border-edge rounded p-3 text-xs font-mono text-ink resize-y"
                    value={generatedJson}
                    onChange={(e) => {
                      setGeneratedJson(e.target.value);
                      setGeneratedMap(null);
                      setValidationErrors([]);
                    }}
                    spellCheck={false}
                  />
                </div>
              )}

              {/* Validation errors */}
              {validationErrors.length > 0 && (
                <div className="border border-danger/30 rounded bg-danger/10 p-3">
                  <p className="text-sm font-medium text-danger mb-1">
                    Validation errors:
                  </p>
                  <ul className="list-disc list-inside text-xs text-danger/80 space-y-0.5">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Section preview */}
              {generatedMap && (
                <div className="border border-edge rounded bg-panel p-3">
                  <p className="text-xs font-medium text-inkMuted mb-2">
                    Section Preview
                  </p>
                  <div className="space-y-1">
                    {generatedMap.slots.map((slot, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="text-inkMuted w-12 flex-shrink-0">
                          {slot.role}
                        </span>
                        <span className="text-ink font-medium flex-shrink-0">
                          {slot.label}
                        </span>
                        <span className="text-inkMuted/60 flex-shrink-0">
                          {slot.bars ?? "?"}b · {slot.velocity ?? "?"} ·{" "}
                          {slot.timeSignatureNumerator ?? 4}/
                          {2 ** (slot.timeSignatureDenPower ?? 2)} · &frac14;=
                          {slot.beatsPerChord ?? "?"}
                        </span>
                        <span className="text-inkMuted/40 truncate">
                          {slot.purpose.slice(0, 60)}…
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}