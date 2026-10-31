import { isUnknownArtist } from "./lrclibMatch";

/**
 * What the lyrics search will actually ask for.
 *
 * This lived inline in the panel and got it wrong in the one way that
 * matters: the "no artist" warning was derived from the SONG's artist, so it
 * kept saying "the search has to guess" while the user had already typed an
 * artist by hand. The warning is about the terms, so the terms are resolved
 * here — and `null` means "follow the song" while `""` means "deliberately
 * empty", which is the difference between a prefilled field and one the user
 * cleared.
 */
export interface LookupSong {
  title: string;
  artist?: string;
}

export interface LookupDraft {
  /** null/undefined = untouched (use the song's); "" = cleared on purpose. */
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  /** A remembered lyric line — filters the returned records, never sent. */
  line?: string | null;
}

export interface LookupTerms {
  title: string;
  /** Absent when the search has no usable artist. */
  artist?: string;
  album?: string;
  line?: string;
  /** True when the search has no artist — so it must guess between covers. */
  needsArtist: boolean;
  /** True when the SONG has no usable artist (worth saving one onto it). */
  songNeedsArtist: boolean;
  /** True when the terms have an artist worth writing back to the song. */
  canSaveArtist: boolean;
}

function pick(draftValue: string | null | undefined, songValue: string | undefined): string {
  const raw = draftValue === null || draftValue === undefined ? (songValue ?? "") : draftValue;
  return raw.trim();
}

export function resolveLookupTerms(song: LookupSong, draft: LookupDraft = {}): LookupTerms {
  const title = pick(draft.title, song.title);
  const artistValue = pick(draft.artist, song.artist);
  const album = pick(draft.album, undefined);
  const line = pick(draft.line, undefined);
  const artist = isUnknownArtist(artistValue) ? undefined : artistValue;
  const songNeedsArtist = isUnknownArtist(song.artist);

  return {
    title,
    artist,
    album: album || undefined,
    line: line || undefined,
    needsArtist: artist === undefined,
    songNeedsArtist,
    canSaveArtist: artist !== undefined && songNeedsArtist,
  };
}
