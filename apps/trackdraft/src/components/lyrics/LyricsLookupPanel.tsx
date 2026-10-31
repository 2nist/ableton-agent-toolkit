import { useMemo, useState } from "react";
import { useSongStore } from "../../store/songStore";
import { useFocusedSectionStore } from "../../store/focusedSectionStore";
import { attachLyrics } from "../../lib/lyrics/attachLyrics";
import { resolveLookupTerms } from "../../lib/lyrics/lookupTerms";
import {
  filterByLyricLine,
  formatDuration,
  searchLrclibRecords,
  type LrclibRecord,
  type LrclibSearchOutcome,
} from "../../lib/lyrics/lrclibClient";
import MicroLabel from "../common/MicroLabel";
import TapeLabel from "../common/TapeLabel";

/**
 * Find the words by hand.
 *
 * The importer's automatic lookup fires once, silently, and either picks a
 * record or picks nothing — which is the wrong shape for the two cases that
 * actually happen: it picked a *cover* (wrong song), or it picked nothing for
 * a song that is plainly on LRCLIB (titles differ by a suffix, artist filed
 * differently, arrangement shorter than the record).
 *
 * So: the search terms are yours to edit, every record comes back, and the
 * ones the matcher refused are shown *with the reason it refused them* —
 * "different artist (Eric Clapton)", "duration is 76s off" — so the answer to
 * "why not this one?" is on screen instead of in the library's head. Refused
 * records can still be used: that is the point of a hand search.
 */
export default function LyricsLookupPanel() {
  const song = useSongStore((s) => s.currentSong());
  const updateCurrentSong = useSongStore((s) => s.updateCurrentSong);
  const setSelectedSectionId = useFocusedSectionStore((s) => s.setSelectedSectionId);

  const [title, setTitle] = useState<string | null>(null);
  const [artist, setArtist] = useState<string | null>(null);
  const [album, setAlbum] = useState<string | null>(null);
  /** A line you remember. LRCLIB has no lyric search (its index covers
   *  track/artist/album), so this filters the records the search returned —
   *  it's how you tell the studio take from the live one. */
  const [line, setLine] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<LrclibSearchOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRefused, setShowRefused] = useState(false);

  // What the search will actually ask for. The "no artist" warning used to
  // follow the SONG's artist, so it kept nagging while the user had already
  // typed one — the terms decide, not the song.
  const terms = resolveLookupTerms(song ?? { title: "" }, { title, artist, album, line });

  const lineApplies = (terms.line ?? "").length > 1;
  const usable = useMemo(() => {
    const accepted = (outcome?.accepted ?? []).map(({ candidate }) => candidate as LrclibRecord);
    return lineApplies ? filterByLyricLine(accepted, terms.line ?? "").map((candidate) => ({ candidate })) : (outcome?.accepted ?? []);
  }, [outcome, terms.line, lineApplies]);
  const refused = useMemo(() => {
    const refusedPool = outcome?.rejected ?? [];
    if (!lineApplies) return refusedPool;
    const kept = new Set(
      filterByLyricLine(
        refusedPool.map(({ scored }) => scored.candidate as LrclibRecord),
        terms.line ?? "",
      ).map((record) => record.id),
    );
    return refusedPool.filter(({ scored }) => scored.candidate.id != null && kept.has(scored.candidate.id));
  }, [outcome, terms.line, lineApplies]);
  const usedId = song?.lyricsSource?.id ?? null;
  const nothingFound = outcome != null && !outcome.error && usable.length + refused.length === 0;

  /** When the song has no duration of its own, every record passes the
   *  duration gate — so a 2:52 radio edit sits beside the 7:05 album take and
   *  both call themselves usable. Saying the lengths disagree is the honest
   *  version of a verdict the matcher can't give. */
  const lengthSpread = useMemo(() => {
    const durations = usable
      .map(({ candidate }) => candidate.duration)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (durations.length < 2) return null;
    return Math.round(Math.max(...durations) - Math.min(...durations));
  }, [usable]);

  const summary = useMemo(() => {
    if (!outcome) return null;
    // Their overload, not a bad search: say which, or the user edits the
    // title a third time for nothing.
    if (outcome.busy) return "LRCLIB is busy right now — try again in a moment";
    if (outcome.error) return `LRCLIB didn't answer — ${outcome.error}`;
    if (nothingFound) return "No records at all — check the spelling, or search by title only.";
    return `${usable.length} usable · ${refused.length} refused · ${outcome.sent} ${
      outcome.sent === 1 ? "query" : "queries"
    } sent`;
  }, [outcome, nothingFound, usable.length, refused.length]);

  async function runSearch() {
    if (!terms.title || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await searchLrclibRecords(
        { title: terms.title, artist: terms.artist },
        typeof fetch === "function" ? fetch : undefined,
        terms.album,
      );
      setOutcome(result);
      setShowRefused(result.accepted.length === 0 && result.rejected.length > 0);
    } finally {
      setBusy(false);
    }
  }

  function use(record: LrclibRecord) {
    if (!song) return;
    const result = attachLyrics(
      song,
      {
        syncedLyrics: record.syncedLyrics ?? undefined,
        plainLyrics: record.plainLyrics ?? undefined,
      },
      {
        provider: "lrclib",
        id: record.id,
        trackName: record.trackName,
        artistName: record.artistName,
        albumName: record.albumName,
        duration: record.duration,
        chosenByUser: true,
      },
    );
    if (!result.attached) {
      setNotice("That record had no words to attach.");
      return;
    }
    updateCurrentSong(() => result.song);
    // Land on a section that actually got words, so the editor shows them.
    const filled = result.song.sections.find((section) => section.lyrics?.trim());
    if (filled) setSelectedSectionId(filled.id);
    const bits = [`${result.lines} ${result.lines === 1 ? "line" : "lines"} across ${result.sections} sections`];
    if (result.plainOnly) bits.push("plain text — no line timing in that record");
    if (result.unplaced > 0) bits.push(`${result.unplaced} had no singable section`);
    setNotice(`Attached ${bits.join(" · ")}`);
  }

  function Row({ record, reason }: { record: LrclibRecord; reason?: string }) {
    const synced = Boolean(record.syncedLyrics);
    return (
      <li className="flex items-start gap-1.5 border-t border-edge/60 py-1 first:border-t-0">
        <div className="min-w-0 flex-1">
          <p className="truncate text-2xs text-ink" title={record.trackName}>
            {record.trackName}
          </p>
          <p className="truncate font-mono text-3xs text-inkMuted/80" title={record.albumName}>
            {record.artistName || "unknown artist"} · {formatDuration(record.duration)}
            {record.albumName ? ` · ${record.albumName}` : ""}
          </p>
          <p className="flex flex-wrap items-center gap-1 pt-0.5">
            <span
              className={`rounded border px-1 font-mono text-3xs ${
                synced ? "border-accent/50 text-accent" : "border-edge text-inkMuted/70"
              }`}
              title={synced ? "line timing — places words on the arrangement" : "plain text only"}
            >
              {synced ? "synced" : "plain"}
            </span>
            {record.instrumental && (
              <span className="rounded border border-edge px-1 font-mono text-3xs text-inkMuted/70">
                instrumental
              </span>
            )}
            {record.id === usedId && (
              <span className="rounded border border-accent bg-accent/15 px-1 font-mono text-3xs text-accent">
                in use
              </span>
            )}
            {reason && (
              <span className="font-mono text-3xs text-warn/80" title="Why the matcher would not pick this">
                {reason}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={record.id === usedId}
          className="shrink-0 rounded border border-edge px-1.5 py-0.5 text-2xs text-inkMuted hover:bg-panelAlt hover:text-ink disabled:opacity-40"
          title={
            record.id === usedId
              ? "This is the record the song's words came from"
              : reason
                ? "Use this record anyway"
                : "Attach this record's words"
          }
          onClick={() => use(record)}
        >
          {record.id === usedId ? "In use" : "Use"}
        </button>
      </li>
    );
  }

  return (
    <div className="space-y-2 rounded border border-edge bg-panel p-2">
      <div className="flex items-baseline gap-1.5">
        <TapeLabel as="p" size="md" className="text-xs uppercase tracking-wide text-inkMuted">
          Find lyrics
        </TapeLabel>
        <span className="ml-auto font-mono text-3xs text-inkMuted/50">LRCLIB</span>
      </div>

      <label className="block space-y-0.5">
        <MicroLabel>Title</MicroLabel>
        <input
          className="w-full min-w-0 rounded border border-edge bg-panelAlt px-1.5 py-0.5 text-2xs"
          value={title ?? song?.title ?? ""}
          placeholder="Song title"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block space-y-0.5">
        <MicroLabel>Artist</MicroLabel>
        <input
          className="w-full min-w-0 rounded border border-edge bg-panelAlt px-1.5 py-0.5 text-2xs"
          value={artist ?? song?.artist ?? ""}
          placeholder="unknown"
          onChange={(event) => setArtist(event.target.value)}
        />
      </label>
      <label className="block space-y-0.5">
        <MicroLabel>Album</MicroLabel>
        <input
          className="w-full min-w-0 rounded border border-edge bg-panelAlt px-1.5 py-0.5 text-2xs"
          value={album ?? ""}
          placeholder="optional — narrows the search"
          onChange={(event) => setAlbum(event.target.value)}
        />
      </label>
      <label className="block space-y-0.5">
        <MicroLabel>A line you remember</MicroLabel>
        <input
          className="w-full min-w-0 rounded border border-edge bg-panelAlt px-1.5 py-0.5 text-2xs"
          value={line ?? ""}
          placeholder="filters the records by their words"
          onChange={(event) => setLine(event.target.value)}
        />
        {lineApplies && (
          <span className="block font-mono text-3xs text-inkMuted/60">
            LRCLIB can&apos;t search lyrics — this keeps the records that contain it
          </span>
        )}
      </label>

      {song?.lyricsSource && (
        <p className="truncate font-mono text-3xs text-inkMuted/70" title={song.lyricsSource.trackName}>
          in use: {song.lyricsSource.trackName} · {song.lyricsSource.artistName || "unknown"}
          {song.lyricsSource.chosenByUser ? " · picked by you" : " · from the import"}
        </p>
      )}

      {/* About the SEARCH, not the song: if you typed an artist, there is
          nothing to warn about — that mismatch is what made this nag while
          "aretha franklin" sat in the field. */}
      {terms.needsArtist && (
        <p className="text-3xs text-warn/80">
          No artist on this search — it has to guess between covers. Type one above
          {terms.songNeedsArtist ? ", or add it on the Song info panel so the next import finds it." : "."}
        </p>
      )}
      {terms.canSaveArtist && (
        <button
          type="button"
          className="w-full rounded border border-edge px-1.5 py-0.5 text-left font-mono text-3xs text-inkMuted hover:bg-panelAlt hover:text-ink"
          title="Save this artist onto the song, so imports and searches stop guessing"
          onClick={() =>
            updateCurrentSong((s) => (s ? { ...s, artist: terms.artist } : s))
          }
        >
          + save “{terms.artist}” as this song's artist
        </button>
      )}

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded border border-edge px-2 py-0.5 text-2xs text-ink hover:bg-panelAlt disabled:opacity-40"
          disabled={busy || !terms.title}
          onClick={() => void runSearch()}
          title="Search LRCLIB for this title and artist"
        >
          {busy ? "Searching…" : "Search"}
        </button>
        {(title !== null || artist !== null || album !== null || line !== null) && (
          <button
            type="button"
            className="rounded px-1 text-2xs text-inkMuted hover:text-ink"
            onClick={() => {
              setTitle(null);
              setArtist(null);
              setAlbum(null);
              setLine(null);
              setOutcome(null);
              setNotice(null);
            }}
            title="Back to the song's own title and artist"
          >
            reset
          </button>
        )}
        {outcome && (
          <span className="ml-auto min-w-0 truncate font-mono text-3xs text-inkMuted/60" title={summary ?? ""}>
            {summary}
          </span>
        )}
      </div>

      {notice && <p className="text-2xs text-accent">{notice}</p>}

      {lengthSpread != null && lengthSpread > 12 && (
        <p className="text-3xs text-warn/80">
          These versions differ by {Math.round(lengthSpread / 60)} min — check the time before you pick, a radio edit is
          not the record.
        </p>
      )}

      {usable.length > 0 && (
        <ul className="space-y-0">
          {usable.slice(0, 8).map(({ candidate }) => (
            <Row key={candidate.id ?? `accepted-${candidate.trackName}`} record={candidate as LrclibRecord} />
          ))}
        </ul>
      )}

      {refused.length > 0 && (
        <div>
          <button
            type="button"
            className="w-full rounded border border-edge/70 px-1.5 py-0.5 text-left font-mono text-3xs text-inkMuted hover:bg-panelAlt hover:text-ink"
            onClick={() => setShowRefused((open) => !open)}
          >
            {showRefused ? "▾" : "▸"} {refused.length} refused — see why
          </button>
          {showRefused && (
            <ul className="mt-1 space-y-0">
              {refused.slice(0, 12).map(({ scored, reason }) => (
                <Row
                  key={scored.candidate.id ?? `refused-${scored.candidate.trackName}`}
                  record={scored.candidate as LrclibRecord}
                  reason={reason}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
