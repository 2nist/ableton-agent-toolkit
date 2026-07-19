# @music-theory/song-blueprint

The canonical song-blueprint schema (`BlueprintSong`/`BlueprintSection`/`Chord`) — moved verbatim out of `apps/trackdraft/src/types/blueprint.ts`, which now just re-exports from here so its many existing call sites didn't need touching.

## Single source of truth, not a fork

Before this package existed, `extensions/trackdraft-bridge` maintained its own independent, leaner subset of this same schema (no `lyricsMetrical`, optional `chords`, missing `beatsPerChord`/`drumPattern`/`velocity`) purely because it couldn't import from the web app directly. That was real, live drift risk — the extension now imports from here instead.

## `provenance` and `lyricsTimeline`

Two fields that didn't exist in the original TrackDraft schema, added when this package was carved out:

- `BlueprintSong.provenance?: { source, extractedAt, warnings? }` — every non-manual adapter (docx ingestion, audio extraction, future MIDI import) produces a *draft* for review, not a silent import. `warnings` is where "couldn't confidently extract X" surfaces in TrackDraft's UI (`DetailsView.tsx`'s provenance banner) instead of only a terminal a user may never see again.
- `BlueprintSection.lyricsTimeline?: { text, startBeat, endBeat? }[]` — timestamped lyric fragments, in beats. Nothing stored timing data before adapters existed to produce it (`lyrics` was always a plain string). Line-level (e.g. from LRCLIB) or word-level (e.g. from Whisper) both fit this same shape.

## Depends on `@music-theory/core` and `@music-theory/song-structure`

Unlike `song-structure` (deliberately zero-dependency), this package imports `NoteName`/`ScaleType`/`ChordQuality` from core and `SectionRole`/`DrumPattern`/`VelocityPreset`/`SectionChord`/`ArrangementEntry` from song-structure, re-exporting the latter set directly. `BlueprintSection`/`BlueprintSong` are their own parallel structures, not extensions of `song-structure`'s `SongSection`/`Song` — see `toSectionChords()`'s doc comment for why (avoids two chord arrays silently drifting out of sync on the same section).
