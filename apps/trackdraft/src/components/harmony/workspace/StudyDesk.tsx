import { useEffect, useMemo, useState } from "react";
import { PRESET_PROGRESSIONS } from "@music-theory/core";
import { decodeProgression, type SongIndex } from "@platform/progression-engine";
import { baseNumeral, corpusMatches, loadCorpusIndex } from "../../../lib/study/corpus";
import type { NoteName } from "@music-theory/core";
import {
  analyzeSection,
  type HarmonyEvent,
} from "../../../lib/harmony/analysis";
import { meanBeatsPerBar, type BlueprintSong } from "../../../types/blueprint";
import { useSongStore } from "../../../store/songStore";
import TapeLabel from "../../common/TapeLabel";
import TensionCurve from "./TensionCurve";
import StudyBoard from "../../study/StudyBoard";
import HarmonyScene from "../HarmonyScene";
import type { HarmonyDeskProps } from "./types";

/** Ask the progression questions. Read-only: the table, the curve, the
 *  cadences and the corpus comparison are all projections of the same
 *  analysis the other desks use. */
export default function StudyDesk({
  song,
  section,
  keyName,
  scale,
  analysis,
  selectedChordId,
  onSelectChord,
  leading,
}: HarmonyDeskProps) {
  const beatsPerBar = Math.max(1, Math.round(meanBeatsPerBar(section)));
  const songs = useSongStore((s) => s.songs);
  const [view, setView] = useState<"table" | "scene">("table");

  const syncedChords = section.chords.map((chord, index) => ({
    ...chord,
    romanNumeral: analysis.events[index]?.roman ?? chord.romanNumeral,
  }));

  const presetMatches = useMemo(
    () => matchPresets(analysis.events),
    [analysis.events],
  );
  const libraryMatches = useMemo(
    () => matchLibrary(songs, song.id, analysis.events),
    [songs, song.id, analysis.events],
  );

  // The corpus index is ~400 KB and only the Study desk needs it, so it is
  // loaded on mount and kept for the session.
  const [corpus, setCorpus] = useState<SongIndex | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadCorpusIndex()
      .then((index) => {
        if (!cancelled) setCorpus(index);
      })
      .catch(() => {
        /* the card simply stays in its loading state */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const catalogueMatches = useMemo(
    () => (corpus ? corpusMatches(corpus, analysis.events.map((event) => event.roman)) : []),
    [corpus, analysis.events],
  );

  return (
    <div className="space-y-3">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "minmax(0, 1fr) 272px" }}
      >
      <div className="min-w-0 space-y-3">
        <div className="rounded border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
            {leading}
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Analysis
            </TapeLabel>
            <span className="font-mono text-[9px] text-inkMuted/70">
              {keyName} {scale} · {analysis.events.length} events
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              {(["table", "scene"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
                    view === mode
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-edge text-inkMuted hover:text-ink"
                  }`}
                >
                  {mode === "table" ? "Table" : "Orbit"}
                </button>
              ))}
            </div>
          </div>
          {view === "table" ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[10px]">
                <thead>
                  <tr className="text-[8px] uppercase tracking-[0.1em] text-inkMuted">
                    <th className="border-b border-edge px-2 py-1 text-left font-normal">
                      beat
                    </th>
                    <th className="border-b border-edge px-2 py-1 text-left font-normal">
                      degree
                    </th>
                    <th className="border-b border-edge px-2 py-1 text-left font-normal">
                      chord
                    </th>
                    <th className="border-b border-edge px-2 py-1 text-left font-normal">
                      function
                    </th>
                    <th className="border-b border-edge px-2 py-1 text-left font-normal">
                      reading
                    </th>
                    <th className="border-b border-edge px-2 py-1 text-right font-normal">
                      tension
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.events.map((event) => {
                    const selected = event.chordId === selectedChordId;
                    return (
                      <tr
                        key={event.chordId}
                        onClick={() => onSelectChord(event.chordId)}
                        className={`cursor-pointer ${selected ? "bg-accent/10" : "hover:bg-panelAlt"}`}
                      >
                        <td className="border-b border-edge/30 px-2 py-1 text-inkMuted">
                          {Math.floor(event.startBeat / beatsPerBar) + 1}.
                          {(event.startBeat % beatsPerBar) + 1}
                        </td>
                        <td className="border-b border-edge/30 px-2 py-1 font-semibold text-ink">
                          {event.roman}
                        </td>
                        <td className="border-b border-edge/30 px-2 py-1">
                          <span className="hand-value text-base leading-none text-accent">
                            {event.absoluteName}
                          </span>
                        </td>
                        <td className="border-b border-edge/30 px-2 py-1">
                          {event.function ? (
                            <span className="rounded border border-edge px-1 text-[9px]">
                              {event.function}
                            </span>
                          ) : (
                            <span className="text-inkMuted/50">—</span>
                          )}
                        </td>
                        <td className="border-b border-edge/30 px-2 py-1 text-inkMuted">
                          {event.borrowed
                            ? "borrowed"
                            : event.appliedTo
                              ? `applied · V of ${event.appliedTo}`
                              : "—"}
                        </td>
                        <td className="border-b border-edge/30 px-2 py-1 text-right tabular-nums">
                          {event.tension.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex justify-center p-1">
              <HarmonyScene
                chords={syncedChords}
                keyName={keyName}
                scale={scale}
                selectedChordId={selectedChordId}
                activeChordId={null}
                onSelectChord={(id) => onSelectChord(id)}
                regions={section.tonicRegions}
                height={460}
              />
            </div>
          )}
        </div>

        <div className="rounded border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Tension
            </TapeLabel>
            <span className="font-mono text-[9px] text-inkMuted/70">
              functional estimate · 0 resolved → 1 tense
            </span>
          </div>
          <div className="px-2 py-1">
            <TensionCurve
              values={analysis.curve}
              labels={analysis.events.map((event) => event.roman)}
              height={86}
            />
          </div>
        </div>

        <div className="rounded border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Cadences
            </TapeLabel>
            <span className="font-mono text-[9px] text-inkMuted/70">
              {analysis.cadences.length} found
            </span>
          </div>
          <div className="p-2">
            {analysis.cadences.length === 0 && (
              <p className="font-mono text-[10px] text-inkMuted/60">
                none in this cycle
              </p>
            )}
            {analysis.cadences.map((cadence) => (
              <div
                key={`${cadence.fromIndex}-${cadence.toIndex}`}
                className="flex items-baseline gap-2 border-b border-edge/30 py-0.5 font-mono text-[10px] last:border-b-0"
              >
                <b className="text-ink">
                  {cadence.from} → {cadence.to}
                </b>
                <span className="text-inkMuted">{cadence.kind}</span>
                <span className="ml-auto text-[9px] text-inkMuted/60">
                  bar {cadence.bar}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Shape
            </TapeLabel>
            <span className="ml-auto font-mono text-[9px] text-inkMuted/60">
              presets
            </span>
          </div>
          <div className="p-2">
            {presetMatches.length === 0 && (
              <p className="font-mono text-[10px] text-inkMuted/60">
                no preset shares this cycle — it is its own shape.
              </p>
            )}
            {presetMatches.map((match) => (
              <div
                key={match.key}
                className="flex items-baseline justify-between border-b border-edge/30 py-0.5 last:border-b-0"
              >
                <span className="hand-value text-base leading-none text-accent">
                  {match.name}
                </span>
                <span className="font-mono text-[9px] text-inkMuted">
                  {match.from === 0 && match.span === analysis.events.length
                    ? "whole cycle"
                    : `from beat ${match.from + 1}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Your library
            </TapeLabel>
            <span className="ml-auto font-mono text-[9px] text-inkMuted/60">
              {libraryMatches.length}
            </span>
          </div>
          <div className="p-2">
            {libraryMatches.length === 0 && (
              <p className="font-mono text-[10px] text-inkMuted/60">
                no other section plays this run of degrees yet.
              </p>
            )}
            {libraryMatches.map((match) => (
              <div
                key={match.key}
                className="border-b border-edge/30 py-1 last:border-b-0"
              >
                <div className="hand-value text-base leading-none text-accent">
                  {match.title}
                </div>
                <div className="font-mono text-[8.5px] text-inkMuted">
                  {match.section} · {match.degrees}
                </div>
              </div>
            ))}
            <p className="mt-1 font-mono text-[9px] text-inkMuted/60">
              key-invariant: degrees, not letters.
            </p>
          </div>
        </div>

        <div className="rounded border border-edge bg-panel">
          <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Catalogue
            </TapeLabel>
            <span className="ml-auto font-mono text-[9px] text-inkMuted/60">
              {corpus ? catalogueMatches.length : "…"}
            </span>
          </div>
          <div className="p-2">
            {!corpus ? (
              <p className="font-mono text-[10px] text-inkMuted/60">loading corpus…</p>
            ) : catalogueMatches.length === 0 ? (
              <p className="font-mono text-[10px] text-inkMuted/60">
                no lead-sheet section contains this run yet.
              </p>
            ) : (
              catalogueMatches.map((match) => (
                <div key={match.name} className="border-b border-edge/30 py-1 last:border-b-0">
                  <div className="hand-value text-base leading-none text-accent">{match.name}</div>
                  <div className="font-mono text-[8.5px] text-inkMuted">
                    {decodeProgression(match.code).join(" ")}
                    {match.partial ? " · passing-chord match" : ""}
                  </div>
                </div>
              ))
            )}
            <p className="mt-1 font-mono text-[9px] text-inkMuted/60">
              key-invariant degrees · lead-sheet corpus.
            </p>
          </div>
        </div>

        <div className="rounded border border-edge bg-panel">
          <div className="border-b border-edge px-2 py-1.5">
            <TapeLabel
              size="md"
              className="text-[10px] font-mono uppercase tracking-wider text-inkMuted"
            >
              Numbers
            </TapeLabel>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-2">
            <Stat
              label="borrowed"
              value={String(analysis.stats.borrowedCount)}
            />
            <Stat label="applied" value={String(analysis.stats.appliedCount)} />
            <Stat
              label="avg tension"
              value={analysis.stats.averageTension.toFixed(2)}
            />
            <Stat
              label="degrees used"
              value={`${analysis.stats.distinctDegrees}/7`}
            />
          </div>
          <div className="flex flex-wrap gap-1 px-2 pb-2">
            <button
              type="button"
              onClick={() =>
                exportAnalysis(
                  song,
                  section.name,
                  keyName,
                  scale,
                  analysis.events,
                )
              }
              className="rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] text-inkMuted hover:text-ink"
            >
              export JSON
            </button>
          </div>
        </div>

        <p className="font-mono text-[9px] leading-relaxed text-inkMuted/60">
          Catalogue matches come from the lead-sheet corpus (5,877 songs ·
          7,980 sections, degrees only). The discovery board below can study the
          same corpus as a scope.
        </p>
      </div>
      </div>

      <StudyBoard song={song} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-edge/60 bg-panelAlt px-1.5 py-1">
      <div className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-inkMuted/70">
        {label}
      </div>
      <div className="font-mono text-base leading-tight text-ink">{value}</div>
    </div>
  );
}

function matchPresets(events: HarmonyEvent[]) {
  const ours = events.map((event) => baseNumeral(event.roman));
  const matches: { key: string; name: string; from: number; span: number }[] =
    [];
  for (const [key, preset] of Object.entries(PRESET_PROGRESSIONS)) {
    const degrees = preset.degrees;
    if (degrees.length < 3) continue;
    const from = indexOfRun(ours, degrees);
    if (from >= 0)
      matches.push({ key, name: preset.name, from, span: degrees.length });
  }
  return matches;
}

function indexOfRun(haystack: string[], needle: string[]): number {
  if (needle.length > haystack.length) return -1;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

function matchLibrary(
  songs: BlueprintSong[],
  currentId: string,
  events: HarmonyEvent[],
) {
  const target = events.map((event) => `${event.degree}:${event.accidental}`);
  if (target.length < 3) return [];
  const matches: {
    key: string;
    title: string;
    section: string;
    degrees: string;
  }[] = [];

  for (const song of songs) {
    if (song.id === currentId) continue;
    for (const section of song.sections) {
      if (section.chords.length < 3) continue;
      const key = (section.key ?? song.key) as NoteName;
      const scale = section.scale ?? song.scale;
      const analysis = analyzeSection(section.chords, {
        key,
        scale,
        regions: section.tonicRegions,
      });
      const candidate = analysis.events.map(
        (event) => `${event.degree}:${event.accidental}`,
      );
      if (isSubsequence(target, candidate)) {
        matches.push({
          key: `${song.id}-${section.id}`,
          title: song.title,
          section: section.name,
          degrees: analysis.events.map((event) => event.roman).join(" "),
        });
      }
      if (matches.length >= 6) return matches;
    }
  }
  return matches;
}

function isSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0;
  for (const item of haystack) {
    if (item === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

function exportAnalysis(
  song: BlueprintSong,
  sectionName: string,
  keyName: NoteName,
  scale: string,
  events: HarmonyEvent[],
) {
  const payload = {
    song: song.title,
    section: sectionName,
    key: keyName,
    scale,
    events: events.map((event) => ({
      beat: event.startBeat,
      duration: event.durationBeats,
      roman: event.roman,
      chord: event.absoluteName,
      function: event.function,
      borrowed: event.borrowed,
      applied: event.appliedTo,
      tension: Number(event.tension.toFixed(3)),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${song.title}-${sectionName}-harmony.json`.replace(
    /[^\w.-]+/g,
    "-",
  );
  anchor.click();
  URL.revokeObjectURL(url);
}
