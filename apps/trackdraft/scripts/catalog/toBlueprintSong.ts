import { pitchClass } from "@music-theory/core";
import type { NoteName, ChordQuality, ScaleType } from "@music-theory/core";
import type { BlueprintSection, BlueprintSong, Chord, LyricsTimelineEntry, SectionRole } from "@music-theory/song-blueprint";
import { normalizeRole } from "@music-theory/song-taxonomy";
import type { RawCatalogSong } from "./types.js";
import type { LrcLine } from "./lrc.js";
import { cleanDisplayTitle } from "./normalizeTitle.js";

/**
 * Maps @music-theory/song-taxonomy's CanonicalRole (the shared vocabulary
 * used for narrative-form mining) onto song-structure's SectionRole. The
 * two aren't identical: taxonomy collapses transitional material into
 * "link" and anything unrecognized into "other", where SectionRole has a
 * dedicated "breakdown" and a "custom" catch-all — so "link" maps to
 * "breakdown" (the closest existing concept) and "other" maps to "custom"
 * (there's no better fit).
 */
const CANONICAL_TO_SECTION_ROLE: Record<string, SectionRole> = {
  verse: "verse",
  chorus: "chorus",
  pre_chorus: "pre_chorus",
  bridge: "bridge",
  solo: "solo",
  intro: "intro",
  outro: "outro",
  link: "breakdown",
  other: "custom",
};

/**
 * Guess a real SectionRole from the catalog's raw section name, instead of
 * stamping every section "custom" — the bug that made narrative-form
 * mining and the drum engine's role signal both dead for all 179 catalog
 * files (every section came in as "custom"). Names normalizeRole drops
 * entirely (e.g. "silence" — not a real section) keep "custom" rather
 * than a guess, since there's nothing to guess from.
 */
function guessSectionRole(rawName: string): SectionRole {
  const canonical = normalizeRole(rawName);
  if (!canonical) return "custom";
  return CANONICAL_TO_SECTION_ROLE[canonical];
}

/** Sections whose canonical role is nothing and whose name contains
 *  "silence" — JCRD's leading/trailing timing artifacts.  Filtered so
 *  the first real section can capture orphaned lyrics/chords. */
function isStructuralJunk(rawName: string): boolean {
  return normalizeRole(rawName) === null && rawName.toLowerCase().includes("silence");
}

const DEFAULT_BPM = 120;
const DEFAULT_TIME_SIG_NUMERATOR = 4;

// Standard chromatic Roman-numeral degree names, independent of any
// particular mode — used because real songs (especially Beatles-scale
// harmonic range) routinely borrow/modulate outside their annotated
// mode's 7 diatonic degrees. Lowercase = minor-ish quality, matching
// standard notation convention.
const CHROMATIC_DEGREES = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
const MINOR_ISH: ReadonlySet<ChordQuality> = new Set(["min", "min7", "dim", "m7b5"]);

function romanNumeralFor(root: NoteName, keyPc: number, quality: ChordQuality): string {
  const interval = (((pitchClass(root) - keyPc) % 12) + 12) % 12;
  const base = CHROMATIC_DEGREES[interval];
  return MINOR_ISH.has(quality) ? base.toLowerCase() : base;
}

function roundToQuarterBeat(beats: number): number {
  return Math.round(beats * 4) / 4;
}

/**
 * Conservative whole-beat rounding for chord durations. Every chord is
 * rounded to the nearest whole beat (minimum 1 beat). Bars are computed
 * from the rounded total: `Math.ceil(total / beatsPerBar)`.
 *
 * The section may end with a small gap (0-3 beats) between the last chord
 * and the bar boundary — this is a natural rest/hold, not a timing error.
 *
 * Max change per chord: ±0.5 beats. We resolve fractions, we do not
 * rewrite the song — no chord grows by more than 1 beat, no bar count
 * changes by more than the chords genuinely require.
 *
 * Example ("Come Together" verse 1, 4/4, 46 raw beats):
 *   Raw       [15.75, 16.25, 8, 6] = 46
 *   Rounded   [16, 16, 8, 6]       = 46
 *   Bars      ceil(46/4) = 12      → 48 beats, 2-beat gap (rest)
 *   Changes:  ch1 +0.25, ch2 -0.25
 *
 * Example ("Eleanor Rigby" intro, 4/4, 24 raw beats):
 *   Raw       [8, 8, 8] = 24
 *   Rounded   [8, 8, 8] = 24  (already whole)
 *   Bars      ceil(24/4) = 6       → 24 beats, no gap
 *   (The source annotation had 8 bars; the chords actually fill 6.)
 *
 * KNOWN FOLLOW-UP (queued 2026-09-20, the "chord track" pass): a catalog
 * scan found 821 of 1459 chord-bearing sections end >3 beats short of
 * their bars (the built catalog keeps each annotation's bar count while
 * this function rounds chord material conservatively), none tile exactly,
 * and 63 sections carry no chords. 44 % of the gaps are whole-bar
 * multiples (likely unannotated final repeats — repeating the last chord
 * would tile those); the rest are beat-level remainders needing a per-case
 * policy. Details: ~/trackdraft-import-cache/exchange/importer-runner-reply.md.
 *
 * UPDATE 2026-09-20: the tiling is now part of this ingest pipeline — the
 * section builder below holds the last chord through tail gaps >3 beats
 * (bar-aligned, same formula as `repair-chord-tracks.ts`), so a
 * regenerated catalog comes out tiled. The repair script remains for
 * legacy catalogs (already applied catalog-wide — 821 sections, 1459/1459
 * within policy; idempotent since). `audit-catalog.ts` flags regressions.
 */
export function snapProgressionToGrid(
  chords: Chord[],
  _totalBeats: number,
  beatsPerBar: number,
): { chords: Chord[]; bars: number } {
  if (chords.length === 0) return { chords, bars: 0 };

  // Round every chord to nearest whole beat (minimum 1).
  const rounded = chords.map((c) => ({
    ...c,
    beats: Math.max(1, Math.round(c.beats)),
  }));

  const total = rounded.reduce((s, c) => s + c.beats, 0);
  const bars = Math.max(1, Math.ceil(total / beatsPerBar));

  return { chords: rounded, bars };
}

export interface ToBlueprintSongOptions {
  id: string;
  raw: RawCatalogSong;
  lyricLines?: LrcLine[];
  hasSyncedLyrics: boolean;
}

export function catalogSongToBlueprintSong({ id, raw, lyricLines, hasSyncedLyrics }: ToBlueprintSongOptions): BlueprintSong {
  const warnings = [...raw.warnings];
  const now = new Date().toISOString();

  const bpm = raw.bpm ?? DEFAULT_BPM;
  if (!raw.bpm) warnings.push(`No tempo in source data — defaulted to ${DEFAULT_BPM} BPM`);
  const beatsPerSec = bpm / 60;

  const key = raw.key ?? "C";
  if (!raw.key) warnings.push("No key in source data — defaulted to C");
  const scale: ScaleType = raw.mode ?? "ionian";
  const keyPc = pitchClass(key);

  if (lyricLines && !hasSyncedLyrics) {
    warnings.push("LRCLIB had plain lyrics only (no line-level timestamps) — lyricsTimeline not populated");
  } else if (!lyricLines) {
    warnings.push("No LRCLIB match found — lyrics not populated");
  }

  // ——— pre‑process ———————————————————————————————————————————————

  const meaningfulRawSections = raw.sections.filter((rs) => !isStructuralJunk(rs.name ?? ""));

  // Single sorted timeline used for both chord & lyric binning.
  // Chord midpoint is the tie‑breaker when boundaries are fuzzy
  // (the last chord of a section often stretches into the next).
  const allRawChords = raw.sections
    .filter((rs) => !isStructuralJunk(rs.name ?? ""))
    .flatMap((rs) => rs.chords)
    .sort((a, b) => a.startSec - b.startSec);

  // Deferred‑from‑previous‑section accumulators — mutable through
  // the `.map()` closure below (Zustand‑style intentional mutation).
  let deferredFromPrev: LrcLine[] = [];
  let deferredChordsFromPrev: typeof allRawChords = [];

  // ——— per‑section processing ——————————————————————————————————————

  const sections: BlueprintSection[] = meaningfulRawSections.map((rawSection, sectionIndex) => {
    const durationBeats = (rawSection.endSec - rawSection.startSec) * beatsPerSec;
    const bars = Math.max(1, Math.round(durationBeats / DEFAULT_TIME_SIG_NUMERATOR));

    // ---- timing & tail zone ----------------------------------------

    // Raw start/end in beats.  The first section extends to 0 to
    // capture chords/lyrics that fell inside filtered leading silence.
    const rawStartBeat = sectionIndex === 0 ? 0 : rawSection.startSec * beatsPerSec;
    const rawEndBeat = rawSection.endSec * beatsPerSec;
    const TAIL_ZONE_BEATS = (2 * bpm) / 60; // 2 seconds in beats

    // Any event (chord‑midpoint or lyric timestamp) on or after
    // `cutoverBeat` routes to the *next* section instead.
    const cutoverBeat = Math.min(rawEndBeat - TAIL_ZONE_BEATS, rawEndBeat);

    const sectionStartBeat = rawStartBeat;
    const sectionEndBeat = rawEndBeat;

    // ---- chords (flat‑timeline tail‑zone binning) --------------------

    // Unlike lyrics, a chord belongs to the section where it *starts*,
    // not where its midpoint falls.  Vocals enter late (0.5-1.5 s before
    // the chord change), so lyric lines need the tail‑zone deferral;
    // chords are the anchor points the tail zone is defined against, so
    // using midpoint here would push boundary‑spanning chords into the
    // wrong section, making every verse appear one chord short.
    const claimedChords: typeof allRawChords = [];
    const deferredChords: typeof allRawChords = [];
    for (const c of allRawChords) {
      const startBeat = c.startSec * beatsPerSec;
      if (startBeat < sectionStartBeat || startBeat >= sectionEndBeat) continue;
      if (startBeat >= cutoverBeat && sectionIndex + 1 < meaningfulRawSections.length) {
        deferredChords.push(c);
        continue;
      }
      claimedChords.push(c);
    }

    const binnedChords = [...deferredChordsFromPrev, ...claimedChords];
    deferredChordsFromPrev = deferredChords.length ? deferredChords : [];

    const rawChords: Chord[] = binnedChords.map((c, chordIndex) => {
      const chordBeats = roundToQuarterBeat((c.endSec - c.startSec) * beatsPerSec);
      const quality = c.quality as ChordQuality;
      return {
        id: `${id}-s${sectionIndex}-c${chordIndex}`,
        root: c.root as NoteName,
        quality,
        romanNumeral: romanNumeralFor(c.root as NoteName, keyPc, quality),
        beats: Math.max(0.25, chordBeats),
      };
    });

    // Snap chord durations to whole-beat values and recompute bars so
    // they follow the progression, not the other way around.
    // Raw section timing (from audio onset detection) is coarse — bars
    // derived from chords are more musically reliable.
    const rawTotalBeats = rawChords.reduce((s, c) => s + c.beats, 0);
    const snapped = snapProgressionToGrid(rawChords, rawTotalBeats, DEFAULT_TIME_SIG_NUMERATOR);
    const chords: Chord[] = snapped.chords;
    const snappedBars = snapped.bars;

    const mostCommonBeats = chords.length
      ? [...chords]
          .sort(
            (a, b) =>
              chords.filter((c) => c.beats === b.beats).length - chords.filter((c) => c.beats === a.beats).length,
          )[0].beats
      : DEFAULT_TIME_SIG_NUMERATOR;

    // ---- lyrics (tail‑zone deferral, same cutoverBeat) ---------------

    const claimedLines: LrcLine[] = [];
    const deferredLines: LrcLine[] = [];
    for (const line of (lyricLines ?? [])) {
      const lineBeat = line.startSec * beatsPerSec;
      if (lineBeat < sectionStartBeat || lineBeat >= sectionEndBeat) continue;
      if (lineBeat >= cutoverBeat && sectionIndex + 1 < meaningfulRawSections.length) {
        deferredLines.push(line);
        continue;
      }
      claimedLines.push(line);
    }

    const linesInSection = [...deferredFromPrev, ...claimedLines];
    deferredFromPrev = deferredLines.length ? deferredLines : [];

    const lyricsTimeline: LyricsTimelineEntry[] | undefined = linesInSection.length
      ? linesInSection.map((line) => ({ text: line.text, startBeat: line.startSec * beatsPerSec }))
      : undefined;

    // Bars follow the RAW section timing — the audio onset detection is the
    // ground truth for how long a section actually lasts — and the chord-
    // snapped count only acts as a floor. Chord annotations routinely leave
    // a gap/rest at the tail (the last chord's onset is early, the section
    // runs on), so snapping bars to the chord total UNDERCOUNTS sections and
    // makes the song run ~10-20% ahead of the audio (e.g. Drive My Car's
    // verses are 8 bars in the recording but only 7 from chord durations).
    // Taking the max keeps the longer count when chords genuinely outlast
    // the raw span, so nothing gets cut off either way. The tail gap is
    // then closed below by HOLDING the last chord (bar-aligned) so the
    // track tiles the section — chord playback loops the progression, and
    // without the hold the cycle restarts under the section-end fills.
    const finalBars = Math.max(rawChords.length > 0 ? snappedBars : 0, bars);

    if (chords.length > 0) {
      const gap = finalBars * DEFAULT_TIME_SIG_NUMERATOR - chords.reduce((s, c) => s + c.beats, 0);
      if (gap > 3) {
        const pad = gap - (gap % DEFAULT_TIME_SIG_NUMERATOR);
        const last = chords[chords.length - 1];
        chords[chords.length - 1] = { ...last, beats: last.beats + pad };
      }
    }

    // ---- return section object ---------------------------------------

    return {
      id: `${id}-section-${sectionIndex}`,
      name: rawSection.name ?? `Section ${sectionIndex + 1}`,
      role: guessSectionRole(rawSection.name ?? ""),
      bars: finalBars,
      chords,
      beatsPerChord: mostCommonBeats,
      drumPattern: "standard",
      velocity: "mf",
      timeSignatureNumerator: DEFAULT_TIME_SIG_NUMERATOR,
      timeSignatureDenPower: 2,
      lyrics: linesInSection.length ? linesInSection.map((l) => l.text).join("\n") : undefined,
      lyricsTimeline,
    };
  });

  if (sections.some((s) => s.chords.length === 0)) {
    warnings.push("Some sections have no recognized chords (silence, or all chord text was unrecognized)");
  }
  warnings.push("Section timing quantized to whole bars at 4/4 — some drift from source timestamps is expected");

  return {
    id,
    title: cleanDisplayTitle(raw.title),
    artist: raw.artist,
    key,
    scale,
    bpm,
    timeSignatureNumerator: DEFAULT_TIME_SIG_NUMERATOR,
    timeSignatureDenominator: 4,
    sections,
    arrangement: sections.map((s) => ({ sectionId: s.id, repeats: 1 })),
    provenance: { source: "catalog-lookup", extractedAt: now, warnings },
    createdAt: now,
    updatedAt: now,
  };
}