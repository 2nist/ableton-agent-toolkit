import { useMemo } from "react";
import { useSongStore } from "../../store/songStore";
import { useLyricsSelectionStore } from "../../store/lyricsSelectionStore";
import { useLyricsSparkStore } from "../../store/lyricsSparkStore";
import { briefInputFromSection } from "../../lib/lyrics/briefInput";
import { buildBrief, type BriefInput, type BriefPrompt } from "../../lib/lyrics/lyricBrief";
import { composeSpark } from "../../lib/lyrics/spark";
import {
  analyzeLine, normalizeWord, rhymeScheme, schemeString, stressMark, type LineAnalysis,
} from "../../lib/lyrics/phonetics";
import {
  groupStartsFromOutline, prosodyIssues, syllableSlots, type MeterInfo, type ProsodyReport,
} from "../../lib/lyrics/melodyPhrases";
import type { BlueprintSection } from "../../types/blueprint";
import { usePronouncer } from "./usePronouncer";

/**
 * The prompt-kind → label map. Deliberately covers the CURRENT union — the
 * old `constraint` kind is gone (those generic writing rules live in Spark's
 * Rule now), and `energy` is new. Typing it as a full Record over the union
 * means a future kind can't ship without a label (TS2739).
 */
const LABELS: Record<BriefPrompt["kind"], string> = {
  job: "Job", structure: "Structure", cadence: "Cadence", feel: "Feel",
  density: "Density", energy: "Energy", melody: "Melody", rhyme: "Rhyme",
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** One labeled Spark line. */
function SparkField({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10px] text-inkMuted uppercase tracking-wide">{label}</p>
      <p className="text-xs leading-4">{text}</p>
    </div>
  );
}

/** One lyric line: text (unknown words dotted), stress marks, rhyme letter,
 *  and — when paired with a melody phrase — a prosody note. */
function LineRow({ line, analysis, schemeLetter, report }: {
  line: string;
  analysis: LineAnalysis;
  schemeLetter: string;
  report: ProsodyReport | null;
}) {
  const unknown = new Set(analysis.unknown);
  const notes: string[] = [];
  if (report) {
    if (report.countDelta > 0) notes.push(`${plural(report.countDelta, "syllable")} over the melody's notes`);
    if (report.countDelta < 0) notes.push(`${plural(-report.countDelta, "note")} left to melisma`);
    if (report.issues.length > 0) {
      notes.push(`${plural(report.issues.length, "stress mismatch")}`);
    }
  }
  const detail = report?.issues
    .map((issue) => `note ${issue.slot + 1}: ${issue.kind.replace(/-/g, " ")}`)
    .join(" · ");

  return (
    <li className="text-[11px] leading-4">
      <div className="flex gap-2 items-baseline">
        <span className="flex-1 min-w-0 truncate" title={line}>
          {line.split(/(\s+)/).map((token, j) => {
            const word = normalizeWord(token);
            return word && unknown.has(word) ? (
              <span
                key={j}
                className="underline decoration-dotted underline-offset-2"
                title="No pronunciation yet — the stress shown here is a guess"
              >
                {token}
              </span>
            ) : (
              <span key={j}>{token}</span>
            );
          })}
        </span>
        <span className="font-mono text-inkMuted shrink-0" title="x = unstressed · / = stressed">
          {stressMark(analysis.stress)}
        </span>
        <span className="font-mono text-accent w-3 shrink-0 text-right" title="Rhyme letter (? = end word unknown)">
          {schemeLetter}
        </span>
      </div>
      {notes.length > 0 && (
        <p className="text-[10px] text-inkMuted" title={detail}>
          ⚑ {notes.join(" · ")}
        </p>
      )}
    </li>
  );
}

/**
 * The Lyrics tab's brief panel: `buildBrief`'s deterministic prompts plus a
 * `composeSpark` nudge and a pronunciation-backed line scan.
 *
 * Everything here is derived LIVE from the selected `BlueprintSection` (how
 * TrackDraft instantiates sections — a template's slots are gone once a map is
 * applied), so the brief follows the section's real chords, meter, melody and
 * produced velocity. Reroll/roll/subjectRoll are the persisted integers from
 * `lyricsSparkStore`; the engines stay pure and deterministic.
 */
export default function LyricsBriefPanel() {
  const currentSong = useSongStore((s) => s.currentSong());
  const selectedSectionId = useLyricsSelectionStore((s) => s.selectedSectionId);
  const bumpBriefReroll = useLyricsSparkStore((s) => s.bumpBriefReroll);
  const bumpSparkRoll = useLyricsSparkStore((s) => s.bumpSparkRoll);
  const bumpSubjectRoll = useLyricsSparkStore((s) => s.bumpSubjectRoll);
  const setSparkLevel = useLyricsSparkStore((s) => s.setSparkLevel);

  const song = currentSong;
  const activeSection: BlueprintSection | null =
    song?.sections.find((s) => s.id === selectedSectionId) ?? song?.sections[0] ?? null;

  // Which section precedes this one in the song — feeds prevEnergy/priorScheme.
  const previous = useMemo(() => {
    if (!song || !activeSection) return null;
    const index = song.sections.findIndex((s) => s.id === activeSection.id);
    return index > 0 ? song.sections[index - 1] : null;
  }, [song, activeSection]);

  const sectionId = activeSection?.id ?? "";
  const songId = song?.id ?? "";
  // Persisted roll counters (integers — the engines derive everything else).
  const reroll = useLyricsSparkStore((s) => s.briefRerollBySection[sectionId] ?? 0);
  const sparkRoll = useLyricsSparkStore((s) => s.sparkRollBySection[sectionId] ?? 0);
  const subjectRoll = useLyricsSparkStore((s) => s.subjectRollBySong[songId] ?? 0);
  const level = useLyricsSparkStore((s) => s.sparkLevelBySection[sectionId] ?? "section");

  // Prime the shared pronunciation cache with every word the panel will scan
  // (this section's lines and the previous section's, for the prior scheme).
  const words = useMemo(
    () => `${activeSection?.lyrics ?? ""}\n${previous?.lyrics ?? ""}`.split(/\s+/).filter(Boolean),
    [activeSection?.lyrics, previous?.lyrics],
  );
  const { pronouncer, pending } = usePronouncer(words);

  if (!song || !activeSection) return null;

  const input: BriefInput = briefInputFromSection(activeSection, { previous, pronouncer, reroll });
  const brief = buildBrief(input);
  const spark = composeSpark({
    songId: song.id,
    sectionId: activeSection.id,
    role: activeSection.role,
    roll: sparkRoll,
    subjectRoll,
    // The song's own subject, when its notes already state one — used instead
    // of a random subject so the roll doesn't fight what's written.
    existingSubject: song.notes?.lyricalContent,
    level,
  });

  // Line scan: stress skeleton, rhyme letters, and which words had to be guessed.
  const lines = (activeSection.lyrics ?? "").split(/\r?\n/);
  const entries = rhymeScheme(lines, pronouncer);
  const analyses = lines.map((line) => (line.trim() ? analyzeLine(line, pronouncer) : null));
  const unknownWords = Array.from(
    new Set(analyses.flatMap((a) => a?.unknown ?? [])),
  );
  const sung = sungLines(lines);
  const schemeText = sung.length >= 2 ? schemeString(entries) : "";

  // Prosody pairing: phrase i ↔ sung line i, only when the counts match (a
  // partial pairing would blame the wrong line for a mismatch).
  const phrases = input.phrases ?? [];
  const paired = phrases.length > 0 && phrases.length === sung.length;
  const meter: MeterInfo = {
    beatsPerBar: input.beatsPerBar,
    groupStarts: activeSection.drumMeterOutline
      ? groupStartsFromOutline(activeSection.drumMeterOutline.cells, activeSection.drumMeterOutline.cellBeats)
      : undefined,
  };

  let sungIndex = -1;
  return (
    <div className="space-y-3">
      <div className="border border-edge rounded bg-panel p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-inkMuted uppercase tracking-wide">Lyric brief</p>
          <button
            className="text-xs border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt"
            onClick={() => bumpBriefReroll(activeSection.id)}
            title="Different phrasing of the same advice — the same section and reroll always show the same picks"
          >
            ↻ Reroll
          </button>
        </div>
        <ul className="space-y-1.5">
          {brief.prompts.map((prompt, i) => (
            <li key={`${prompt.kind}-${i}`} className="flex gap-2">
              <span className="text-[9px] uppercase tracking-wide text-inkMuted w-14 shrink-0 pt-0.5">
                {LABELS[prompt.kind]}
              </span>
              <span className="text-xs leading-4">{prompt.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border border-edge rounded bg-panel p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-inkMuted uppercase tracking-wide">Spark</p>
          <button
            className="text-xs border border-edge rounded px-2 py-0.5 text-inkMuted hover:text-ink hover:bg-panelAlt"
            onClick={() => bumpSparkRoll(activeSection.id)}
            title="New rule, point of view and challenge for this section"
          >
            ↻ Roll
          </button>
        </div>
        <div>
          <p className="text-[10px] text-inkMuted uppercase tracking-wide">
            Subject{spark.subject.own ? " · yours" : ""}
          </p>
          <p className="text-xs leading-4">{spark.subject.text}</p>
          {!spark.subject.own && (
            <button
              className="text-[10px] text-inkMuted underline hover:text-ink"
              onClick={() => bumpSubjectRoll(song.id)}
              title="The subject is song-level and sticky — shuffling here changes it for every section"
            >
              shuffle subject
            </button>
          )}
        </div>
        {spark.perspective && <SparkField label="Point of view" text={spark.perspective} />}
        <SparkField label="Rule" text={spark.rule} />
        <SparkField label="Challenge" text={spark.challenge} />
        <div className="flex gap-1 pt-0.5">
          {(["section", "song"] as const).map((option) => (
            <button
              key={option}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                level === option ? "border-accent text-accent" : "border-edge text-inkMuted hover:text-ink"
              }`}
              onClick={() => setSparkLevel(activeSection.id, option)}
              title={
                option === "song"
                  ? "Allow rules and challenges that need the whole lyric, not just this section"
                  : "Only prompts that fit this one section"
              }
            >
              {option === "section" ? "This section" : "Whole song"}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-edge rounded bg-panel p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-inkMuted uppercase tracking-wide">Line check</p>
          {schemeText && <span className="font-mono text-[10px] text-inkMuted" title="Rhyme scheme">{schemeText}</span>}
        </div>
        {sung.length === 0 ? (
          <p className="text-xs text-inkMuted">
            Write lyrics above and each line is scanned here: stress (x /), rhyme letters, and any word the
            dictionary doesn't know yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {lines.map((line, i) => {
              if (!line.trim()) return <li key={i} className="h-1.5" aria-hidden />;
              sungIndex += 1;
              const phrase = paired ? phrases[sungIndex] : null;
              return (
                <LineRow
                  key={i}
                  line={line}
                  analysis={analyses[i]!}
                  schemeLetter={entries[i].letter}
                  report={phrase ? prosodyIssues(analyses[i]!.stress, syllableSlots(phrase, meter)) : null}
                />
              );
            })}
          </ul>
        )}
        {pending && <p className="text-[10px] text-inkMuted">Looking up pronunciations…</p>}
        {unknownWords.length > 0 && (
          <p className="text-[10px] text-inkMuted">
            Guessed (not in the dictionary): <span className="text-ink">{unknownWords.join(", ")}</span> — dotted
            above; their stress is a guess.
          </p>
        )}
      </div>
    </div>
  );
}

/** Non-blank lines, in order — the lines a stress/rhyme scan can use. */
function sungLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.trim() !== "");
}
