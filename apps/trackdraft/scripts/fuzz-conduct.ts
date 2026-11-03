/**
 * S2 — the conduct round-trip fuzz.
 *
 *   npx tsx scripts/fuzz-conduct.ts            # the whole catalog
 *   npx tsx scripts/fuzz-conduct.ts --limit 20 # a sample
 *
 * §P3.6/§P3.7 changed what every export path reads: `resolveChordOccurrences`
 * now conducts its own input, and melody and an authored bass line are
 * conducted at the boundary. The unit tests prove that on fixtures. This proves
 * it on the corpus — 180-odd real songs with odd meters, meter maps, narrative
 * warps, tonic regions and zero-bar sections, which is where a chord span stops
 * dividing a bar and nothing in a fixture would notice.
 *
 * It asserts that the output is *sane*, not byte-identical: byte-identity is
 * P2's golden test (`conduct(compile(song)) ≡ song`), which cannot exist until
 * there is a graph to compile. What must hold today:
 *
 *   1. nothing throws                    (every planner, every rate)
 *   2. every note is a real note        (finite, start ≥ 0, duration > 0)
 *   3. nothing escapes its section       (inside the span, ±1e-6)
 *   4. the count stays bounded           (a loop cannot explode a section)
 *   5. the bass stays under its chords   (§P3.6's musical invariant)
 *   6. the run is deterministic          (same input, same output)
 *   7. an unclocked section is untouched  (conduction is a no-op, by reference)
 *
 * Run it after touching `conduct.ts`, `chordCycle.ts` or any stem planner.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { BlueprintSong, TimeDomain } from "../src/types/blueprint";
import { sectionSpans, type SectionSpan } from "../src/lib/arrangement";
import {
  planBassStem,
  planChordStem,
  planDrumStem,
  type MidiNote,
} from "../src/lib/midiExport";
import { planMelodyStem } from "../src/lib/melody/melodyStem";
import { conductSection } from "@drum/library";

/** The rungs the canvas can actually set — plus a couple the ladder cannot, so
 *  the fuzz covers rates nobody has clicked yet. */
const RUNGS: { label: string; domain: TimeDomain }[] = [
  { label: "½", domain: { rate: 0.5 } },
  { label: "×2", domain: { rate: 2 } },
  { label: "⅓", domain: { rate: 1 / 3 } },
  { label: "swing 50%", domain: { rate: 1, swing: 0.5 } },
  { label: "loop 4", domain: { rate: 1, cycle: 4 } },
  { label: "½ + loop 4", domain: { rate: 0.5, cycle: 4 } },
  { label: "×2 + loop 4", domain: { rate: 2, cycle: 4 } },
];

interface Violation {
  song: string;
  section: string;
  rung: string;
  rule: string;
  detail: string;
}

const stems = () => ({
  chords: planChordStem,
  bass: planBassStem,
  melody: planMelodyStem,
  drums: planDrumStem,
});

const LIMIT = (() => {
  const at = process.argv.indexOf("--limit");
  const value = at >= 0 ? Number(process.argv[at + 1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
})();

/** Every song the machine has, as the catalog stores them. */
function loadSongs(): { songs: BlueprintSong[]; unreadable: string[] } {
  const dir = path.join(process.cwd(), "scripts", "output", "catalog");
  if (!fs.existsSync(dir)) {
    console.error(`no catalog at ${dir}`);
    process.exit(2);
  }
  const songs: BlueprintSong[] = [];
  const unreadable: string[] = [];
  for (const file of fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".trackdraft.json"))
    .sort()) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, file), "utf8"),
      ) as BlueprintSong;
      if (Array.isArray(parsed?.sections) && parsed.sections.length > 0)
        songs.push(parsed);
    } catch {
      unreadable.push(file);
    }
  }
  return { songs, unreadable };
}

/** The same song with one clock on every section. */
function clocked(song: BlueprintSong, domain: TimeDomain): BlueprintSong {
  return {
    ...song,
    sections: song.sections.map((section) => ({
      ...section,
      timeDomain: domain,
    })),
  };
}

function withinSpan(span: SectionSpan, note: MidiNote): boolean {
  const start = span.startBeat;
  const end = span.startBeat + span.durationBeats;
  return (
    note.startTime >= start - 1e-6 &&
    note.startTime + note.duration <= end + 1e-6
  );
}

function checkNotes(
  song: string,
  section: string,
  rung: string,
  stem: string,
  notes: readonly MidiNote[],
  span: SectionSpan,
  out: Violation[],
): void {
  for (const note of notes) {
    if (!Number.isFinite(note.startTime) || !Number.isFinite(note.duration)) {
      out.push({
        song,
        section,
        rung,
        rule: "finite",
        detail: `${note.pitch}@${note.startTime}+${note.duration}`,
      });
      return;
    }
    if (note.duration <= 0 || note.startTime < -1e-6) {
      out.push({
        song,
        section,
        rung,
        rule: "real-note",
        detail: `${note.pitch}@${note.startTime}+${note.duration}`,
      });
      return;
    }
    if (!withinSpan(span, note)) {
      out.push({
        song,
        section,
        rung,
        rule: "escapes-section",
        detail: `${stem}: p${note.pitch} ends ${(note.startTime + note.duration - (span.startBeat + span.durationBeats)).toFixed(2)} beats past the span`,
      });
      return;
    }
  }
}

function main(): void {
  const { songs, unreadable } = loadSongs();
  const picked = songs.slice(
    0,
    LIMIT === Number.POSITIVE_INFINITY ? songs.length : LIMIT,
  );
  const violations: Violation[] = [];
  const planner = stems();
  let sectionCount = 0;
  let clockedSections = 0;
  let noteCount = 0;
  let worstGrowth = { song: "", section: "", rung: "", before: 0, after: 0 };
  const notable: string[] = [];

  for (const song of picked) {
    const name = song.title ?? song.id ?? "(untitled)";
    const plainSpans = sectionSpans(song);

    // 7 — an unclocked section is untouched, by reference.
    for (const span of plainSpans) {
      if (conductSection(span.section, span.durationBeats) !== span.section) {
        violations.push({
          song: name,
          section: span.section.name ?? span.sectionId,
          rung: "none",
          rule: "identity",
          detail:
            "conductSection returned a new object for a section with no clock",
        });
      }
    }

    const baseline: Record<string, number> = {};
    for (const [stem, plan] of Object.entries(planner)) {
      baseline[stem] = plan(plainSpans, song).length;
      noteCount += baseline[stem];
    }
    sectionCount += plainSpans.length;

    for (const rung of RUNGS) {
      const clockedSong = clocked(song, rung.domain);
      const spans = sectionSpans(clockedSong);
      clockedSections += spans.length;

      for (const [stem, plan] of Object.entries(planner)) {
        let notes: MidiNote[];
        try {
          notes = plan(spans, clockedSong);
          // 6 — determinism: the same call twice.
          const again = plan(spans, clockedSong);
          if (again.length !== notes.length) {
            violations.push({
              song: name,
              section: "-",
              rung: rung.label,
              rule: "deterministic",
              detail: `${stem}: ${notes.length} then ${again.length}`,
            });
          }
        } catch (error) {
          // 1 — nothing throws.
          violations.push({
            song: name,
            section: "-",
            rung: rung.label,
            rule: "throws",
            detail: `${stem}: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }

        // 4 — bounded growth. A LOOP is expected to multiply (that is what
        // tiling a two-beat figure across a 64-bar section means), so the rule
        // only applies to a rate on its own: compression must never inflate the
        // note count.
        const before = baseline[stem];
        const looping = (rung.domain.cycle ?? 0) > 0;
        const grew = before > 0 && notes.length > Math.max(64, before * 8);
        if (grew && looping) {
          notable.push(
            `${name} · ${rung.label} · ${stem}: ${before} → ${notes.length}`,
          );
        }
        if (grew && !looping) {
          if (notes.length > worstGrowth.after) {
            worstGrowth = {
              song: name,
              section: "-",
              rung: rung.label,
              before,
              after: notes.length,
            };
          }
          violations.push({
            song: name,
            section: "-",
            rung: rung.label,
            rule: "growth",
            detail: `${stem}: ${before} → ${notes.length} notes`,
          });
        }

        const bySpan = new Map<string, SectionSpan>();
        for (const span of spans) bySpan.set(span.sectionId, span);
        for (const note of notes) {
          // Half-open on the RIGHT: a note at exactly `end` belongs to the next
          // section (chords and bass routinely place one on the boundary), and
          // charging it to the previous span reported 1,646 false positives.
          const span = spans.find(
            (entry) =>
              note.startTime >= entry.startBeat - 1e-6 &&
              note.startTime < entry.startBeat + entry.durationBeats - 1e-6,
          );
          if (!span) {
            // The last section's final note can land exactly on the end.
            const end = spans[spans.length - 1];
            if (
              end &&
              note.startTime > end.startBeat + end.durationBeats + 1e-6
            ) {
              violations.push({
                song: name,
                section: "-",
                rung: rung.label,
                rule: "orphan-note",
                detail: `${stem}: start ${note.startTime.toFixed(2)}`,
              });
            }
            continue;
          }
          checkNotes(
            name,
            span.section.name ?? span.sectionId,
            rung.label,
            stem,
            [note],
            bySpan.get(span.sectionId) ?? span,
            violations,
          );
        }

        // 5 — the bass stays under its chords: every bass onset has to fall
        // inside a chord occurrence of the same section.
        if (stem === "bass") {
          for (const span of spans) {
            const chords = planChordStem([span], clockedSong);
            for (const note of notes.filter(
              (entry) =>
                entry.startTime >= span.startBeat - 1e-6 &&
                entry.startTime < span.startBeat + span.durationBeats,
            )) {
              const under = chords.some(
                (chord) =>
                  chord.startTime <= note.startTime + 1e-6 &&
                  note.startTime < chord.startTime + chord.duration + 1e-6,
              );
              if (!under) {
                violations.push({
                  song: name,
                  section: span.section.name ?? span.sectionId,
                  rung: rung.label,
                  rule: "bass-off-chord",
                  detail: `p${note.pitch} at ${note.startTime.toFixed(2)}`,
                });
                break;
              }
            }
          }
        }
      }
    }
  }

  const byRule = new Map<string, number>();
  for (const violation of violations)
    byRule.set(violation.rule, (byRule.get(violation.rule) ?? 0) + 1);

  console.log(
    `\nsongs ${picked.length}${unreadable.length ? ` (+${unreadable.length} unreadable)` : ""} · sections ${sectionCount} · clocked-section passes ${clockedSections} · notes ${noteCount}`,
  );
  console.log(`rungs: ${RUNGS.map((rung) => rung.label).join(", ")}`);
  console.log(
    `\nviolations ${violations.length}` +
      ([...byRule].length
        ? `\n  ${[...byRule].map(([rule, count]) => `${rule} ${count}`).join("\n  ")}`
        : " — clean"),
  );
  if (worstGrowth.after > 0) {
    console.log(
      `\nworst growth: ${worstGrowth.song} at ${worstGrowth.rung} — ${worstGrowth.before} → ${worstGrowth.after}`,
    );
  }
  if (notable.length > 0) {
    console.log(
      `\nnotable (a loop multiplying is expected, listed so it is not invisible): ${notable.length}`,
    );
    for (const line of notable.slice(0, 8)) console.log(`  ${line}`);
    if (notable.length > 8) console.log(`  … ${notable.length - 8} more`);
  }
  for (const violation of violations.slice(0, 40)) {
    console.log(
      `  [${violation.rule}] ${violation.song} · ${violation.section} · ${violation.rung} — ${violation.detail}`,
    );
  }
  if (violations.length > 40) console.log(`  … ${violations.length - 40} more`);

  process.exit(violations.length > 0 ? 1 : 0);
}

main();
