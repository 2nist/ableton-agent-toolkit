/**
 * Draft-extraction script for lalo-chezia's source material.
 *
 * Pulls what it can confidently extract from each song's docx/xlsx files
 * into a draft BlueprintSong JSON, written to scripts/output/. This is
 * NOT a silent one-shot importer -- the app's Details/Structure/Lyrics
 * tabs are the review/completion interface. Confidence varies by field:
 *
 *   HIGH   -- concept, tempo/key/time-signature, the lyrics metrical
 *             table (all lifted from clearly-labeled text or a
 *             structured spreadsheet)
 *   MEDIUM -- section names/bars/chord progressions/transition notes
 *             (regex-parsed from free-form arrangement prose -- the
 *             format is consistent across the songs checked, but not
 *             guaranteed for all 14)
 *
 * Run: npx tsx scripts/ingest-lalo-chezia.ts [songId...]
 * (omit songId args to process all songs)
 */
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import mammoth from "mammoth";
import XLSX from "xlsx";
import type {
  BlueprintSong,
  BlueprintSection,
  LyricMetricalRow,
  SectionRole,
} from "../src/types/blueprint";

const SOURCE_ROOT = "/Users/Matthew/lalo-chezia/lalo-chezia/docs/source_material/songs";
const OUTPUT_DIR = join(import.meta.dirname, "output");

const ROLE_MAP: Record<string, SectionRole> = {
  intro: "intro",
  verse: "verse",
  "pre-chorus": "pre_chorus",
  prechorus: "pre_chorus",
  chorus: "chorus",
  bridge: "bridge",
  solo: "solo",
  breakdown: "breakdown",
  outro: "outro",
};

function inferRole(sectionName: string): SectionRole {
  const key = sectionName.toLowerCase().replace(/\s*\d+$/, "").trim();
  return ROLE_MAP[key] ?? "custom";
}

async function docxText(path: string): Promise<string> {
  const result = await mammoth.extractRawText({ path });
  return result.value;
}

interface ParsedArrangement {
  bpm?: number;
  key?: string;
  mode?: "major" | "minor";
  timeSigNumerator?: number;
  timeSigDenominator?: number;
  sections: BlueprintSection[];
  title?: string;
}

/** Parses the arrangement docx's prose. Confirmed against Twin Fish's
 *  actual extracted text: mammoth collapses this document's bullet-list
 *  paragraphs into one run-on block (no reliable newlines), so this
 *  works on `*`-delimited bullet segments and labeled fields instead of
 *  line splitting. */
function parseArrangement(text: string): ParsedArrangement {
  const result: ParsedArrangement = { sections: [] };

  const titleMatch = text.match(/Arrangement:\s*"([^"]+)"/);
  if (titleMatch) result.title = titleMatch[1];

  const bpmMatch = text.match(/Tempo:\s*(\d+)\s*BPM/i);
  if (bpmMatch) result.bpm = Number(bpmMatch[1]);

  // Captures the note and mode as SEPARATE groups -- "Key: E major" must
  // become key="E", mode="major", not key="E major" (a bug caught live:
  // pitchClass() only accepts bare note names and throws on anything
  // else, which crashed HexWheel/ProgressionBuilder for any imported
  // song whose key had a mode word still attached).
  const keyMatch = text.match(/Key:\s*([A-G][#b]?)\s*(major|minor)?/i);
  if (keyMatch) {
    result.key = keyMatch[1].trim();
    result.mode = keyMatch[2]?.toLowerCase() as "major" | "minor" | undefined;
  }

  const tsMatch = text.match(/Time Signature:\s*(\d+)\s*\/\s*(\d+)/i);
  if (tsMatch) {
    result.timeSigNumerator = Number(tsMatch[1]);
    result.timeSigDenominator = Number(tsMatch[2]);
  }

  // Structure section: bullets shaped like "Intro (8 bars) ... Chord
  // Progression: Em (i) - D (VII) - ...  (4 beats per chord)" up to the
  // next section header or "Transitions and Dynamics:". The leading `*`
  // is optional -- confirmed present in Twin Fish's arrangement docx but
  // absent in Skywritting's (section headers there are bare lines, only
  // their sub-bullets are `*`-prefixed), so this needs to tolerate both.
  const structureBlock = text.split(/Transitions and Dynamics:/i)[0];
  const bulletRe = /\*?\s*([A-Za-z][A-Za-z0-9 ]*?)\s*\((\d+)\s*bars?\)([\s\S]*?)(?=\*?\s*[A-Za-z][A-Za-z0-9 ]*?\s*\(\d+\s*bars?\)|$)/g;

  let match: RegExpExecArray | null;
  while ((match = bulletRe.exec(structureBlock)) !== null) {
    const [, name, barsStr, body] = match;
    const bars = Number(barsStr);

    const chordMatch = body.match(
      /Chord Progression:\s*([^()]+(?:\([^()]+\)[^()]*)*?)\s*\((\d+)\s*beats? per chord\)/i,
    );
    const chords: BlueprintSection["chords"] = [];
    let beatsPerChord = 4;
    if (chordMatch) {
      beatsPerChord = Number(chordMatch[2]);
      const chordTokens = chordMatch[1].split("-").map((t) => t.trim()).filter(Boolean);
      for (const token of chordTokens) {
        const tokenMatch = token.match(/^([A-G][#b]?m?\d*)\s*\(([^)]+)\)$/);
        if (tokenMatch) {
          chords.push({
            id: crypto.randomUUID(),
            romanNumeral: tokenMatch[2].trim(),
            root: tokenMatch[1].replace(/m$/, ""),
            quality: /m$/.test(tokenMatch[1]) ? "min" : "maj",
            beats: beatsPerChord,
          });
        }
      }
    }

    result.sections.push({
      id: crypto.randomUUID(),
      name: name.trim(),
      role: inferRole(name),
      bars,
      chords,
      beatsPerChord,
      drumPattern: "standard",
      velocity: "mf",
      timeSignatureNumerator: result.timeSigNumerator ?? 4,
      timeSignatureDenPower: 2,
    });
  }

  // Transitions: "* Intro to Verse 1: Smooth transition..." -- attach
  // each transition's prose to the section it leads INTO.
  const transitionsBlock = text.split(/Transitions and Dynamics:/i)[1] ?? "";
  const transitionRe = /\*\s*[A-Za-z0-9 ]+?\s+to\s+([A-Za-z0-9 ]+?):\s*([^*]+)/g;
  while ((match = transitionRe.exec(transitionsBlock)) !== null) {
    const [, targetName, note] = match;
    const target = result.sections.find(
      (s) => s.name.toLowerCase() === targetName.trim().toLowerCase(),
    );
    if (target) target.transitionNote = note.trim();
  }

  return result;
}

interface ParsedConcept {
  concept?: string;
  notes: NonNullable<BlueprintSong["notes"]>;
  additionalIdeas: string[];
}

/** The concept docx preserves real paragraph breaks (unlike the
 *  arrangement docx), so this works line-by-line. Confirmed against
 *  Twin Fish's actual extracted text. */
function parseConcept(text: string): ParsedConcept {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result: ParsedConcept = { notes: {}, additionalIdeas: [] };

  let section: "notes" | "ideas" | null = null;

  for (const line of lines) {
    const conceptMatch = line.match(/^Concept:\s*(.+)/i);
    if (conceptMatch) {
      result.concept = conceptMatch[1];
      continue;
    }
    if (/^Notes:?$/i.test(line)) { section = "notes"; continue; }
    if (/^Additional Ideas:?$/i.test(line)) { section = "ideas"; continue; }
    if (/^Remember:?$/i.test(line)) { section = null; continue; }

    const labeled = line.match(/^([A-Za-z ]+):\s*(.+)/);
    if (section === "notes" && labeled) {
      const [, label, value] = labeled;
      const key = label.trim().toLowerCase();
      if (key === "vocal delivery") result.notes.vocalDelivery = value;
      else if (key === "dynamics") result.notes.dynamics = value;
      else if (key === "lyrical content") result.notes.lyricalContent = value;
      else if (key === "instrumentation") {
        result.notes.instrumentation = value.split(/,\s*/).map((v) => v.trim());
      }
    } else if (section === "ideas" && labeled) {
      result.additionalIdeas.push(line);
    }
  }

  return result;
}

/** Splits a full-lyrics document (e.g. Twin Fish's untitled_document.docx)
 *  into per-section text, using its own "(Section Label)" markers --
 *  confirmed present in the one song that has this file. Matches each
 *  arrangement section to a lyric block first by exact name (handles
 *  "Verse 1"/"Verse 2" being separately labeled), falling back to the
 *  base name with trailing number stripped (handles "Chorus 2" pulling
 *  from repeated "(Chorus)" blocks, since a repeated chorus's lyrics are
 *  usually identical anyway, so which specific occurrence it draws from
 *  doesn't change the result). Sections with no matching block (e.g.
 *  Intro, which this document doesn't label) are left blank rather than
 *  guessed. */
function splitLyricsBySection(fullText: string, sectionNames: string[]): Map<string, string> {
  const blockRe = /\(([^)]+)\)\s*([\s\S]*?)(?=\(|$)/g;
  const blocksByLabel = new Map<string, string[]>();
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(fullText)) !== null) {
    const label = match[1].trim().toLowerCase();
    const blockText = match[2].trim();
    if (!blockText) continue;
    if (!blocksByLabel.has(label)) blocksByLabel.set(label, []);
    blocksByLabel.get(label)!.push(blockText);
  }

  const result = new Map<string, string>();
  for (const name of sectionNames) {
    const exactKey = name.toLowerCase();
    const baseKey = exactKey.replace(/\s*\d+$/, "").trim();
    const queue = blocksByLabel.get(exactKey)?.length ? blocksByLabel.get(exactKey) : blocksByLabel.get(baseKey);
    if (queue && queue.length > 0) result.set(name, queue.shift()!);
  }
  return result;
}

function parseLyricsXlsx(path: string): { rows: LyricMetricalRow[]; bySection: Map<string, LyricMetricalRow> } {
  const wb = XLSX.readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  const headerIdx = rows.findIndex((r) => String(r[0]).trim().toLowerCase() === "section");
  if (headerIdx === -1) return { rows: [], bySection: new Map() };

  const bySection = new Map<string, LyricMetricalRow>();
  const parsed: LyricMetricalRow[] = [];

  for (const row of rows.slice(headerIdx + 1)) {
    if (!row[0]) continue;
    const entry: LyricMetricalRow = {
      chordProgression: String(row[1] ?? ""),
      metricalFeet: String(row[2] ?? ""),
      syllableCount: String(row[3] ?? ""),
      rhymeScheme: String(row[4] ?? ""),
      notes: String(row[5] ?? ""),
    };
    parsed.push(entry);
    bySection.set(String(row[0]).trim().toLowerCase(), entry);
  }

  return { rows: parsed, bySection };
}

async function ingestSong(songDir: string, songId: string): Promise<{ song: BlueprintSong; warnings: string[] }> {
  const warnings: string[] = [];
  const files = await readdir(songDir);

  const arrangementFile = files.find((f) => f.startsWith("arrangement_") && f.endsWith(".docx"));
  const lyricsXlsxFile = files.find((f) => f.endsWith("_lyrics.xlsx"));
  const otherDocx = files.filter((f) => f.endsWith(".docx") && f !== arrangementFile);

  let arrangement: ParsedArrangement = { sections: [] };
  if (arrangementFile) {
    arrangement = parseArrangement(await docxText(join(songDir, arrangementFile)));
  } else {
    warnings.push("No arrangement_*.docx found.");
  }

  let concept: ParsedConcept = { notes: {}, additionalIdeas: [] };
  let fullLyricsText: string | undefined;
  for (const file of otherDocx) {
    const text = await docxText(join(songDir, file));
    if (/Concept:/i.test(text)) {
      concept = parseConcept(text);
    } else if (/verse|chorus|bridge/i.test(text) && !/Tempo:/i.test(text)) {
      // Heuristic: no Concept:/Tempo: markers but has section-like words
      // -- likely a full-lyrics document (matches Twin Fish's
      // untitled_document.docx).
      fullLyricsText = text.trim();
    }
  }
  if (!concept.concept) warnings.push("No concept docx recognized (no 'Concept:' line found).");

  let lyricsBySection = new Map<string, LyricMetricalRow>();
  if (lyricsXlsxFile) {
    const parsed = parseLyricsXlsx(join(songDir, lyricsXlsxFile));
    lyricsBySection = parsed.bySection;
  } else {
    warnings.push("No *_lyrics.xlsx found -- 5 of 14 songs don't have one, this may be expected.");
  }

  for (const section of arrangement.sections) {
    const row = lyricsBySection.get(section.name.toLowerCase());
    if (row) section.lyricsMetrical = [row];
  }
  if (arrangement.sections.length === 0) {
    warnings.push("No sections parsed from arrangement docx -- needs manual entry in the Structure tab.");
  }
  if (fullLyricsText && arrangement.sections.length > 0) {
    const bySection = splitLyricsBySection(
      fullLyricsText,
      arrangement.sections.map((s) => s.name),
    );
    let matched = 0;
    for (const section of arrangement.sections) {
      const text = bySection.get(section.name);
      if (text) {
        section.lyrics = text;
        matched++;
      }
    }
    if (matched < arrangement.sections.length) {
      warnings.push(
        `Full lyric text found and split by its own (Section) markers -- matched ${matched}/${arrangement.sections.length} sections; the rest (e.g. Intro, if unlabeled in the source) need manual entry.`,
      );
    }
  }

  const now = new Date().toISOString();
  const song: BlueprintSong = {
    id: crypto.randomUUID(),
    title: arrangement.title ?? songId.replace(/^\d+_/, "").replace(/_/g, " "),
    key: arrangement.key ?? "C",
    scale: arrangement.mode === "minor" ? "aeolian" : "ionian",
    bpm: arrangement.bpm ?? 120,
    timeSignatureNumerator: arrangement.timeSigNumerator ?? 4,
    timeSignatureDenominator: arrangement.timeSigDenominator ?? 4,
    sections: arrangement.sections,
    arrangement: arrangement.sections.map((s) => ({ sectionName: s.name, repeats: 1 })),
    concept: concept.concept,
    notes: Object.keys(concept.notes).length > 0 ? concept.notes : undefined,
    additionalIdeas: concept.additionalIdeas.length > 0 ? concept.additionalIdeas : undefined,
    createdAt: now,
    updatedAt: now,
  };

  return { song, warnings };
}

async function main() {
  const args = process.argv.slice(2);
  const allDirs = (await readdir(SOURCE_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const targets = args.length > 0 ? allDirs.filter((d) => args.includes(d)) : allDirs;

  await mkdir(OUTPUT_DIR, { recursive: true });

  const summary: { songId: string; title: string; sections: number; warnings: string[] }[] = [];

  for (const songId of targets) {
    const songDir = join(SOURCE_ROOT, songId);
    try {
      const { song, warnings } = await ingestSong(songDir, songId);
      const outPath = join(OUTPUT_DIR, `${songId}.trackdraft.json`);
      await writeFile(outPath, JSON.stringify(song, null, 2));
      summary.push({ songId, title: song.title, sections: song.sections.length, warnings });
    } catch (err) {
      summary.push({
        songId,
        title: "(failed)",
        sections: 0,
        warnings: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  console.log(`\nWrote ${summary.length} draft song(s) to ${OUTPUT_DIR}\n`);
  for (const s of summary) {
    console.log(`${s.songId} -- "${s.title}" -- ${s.sections} section(s)`);
    for (const w of s.warnings) console.log(`  ! ${w}`);
  }
}

main();
