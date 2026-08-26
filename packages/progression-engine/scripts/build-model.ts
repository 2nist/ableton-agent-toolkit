import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildTransitionModel, tension } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, "../data");

const sequences: string[][] = JSON.parse(
  fs.readFileSync(path.join(DATA, "lead_sheet_degree_sequences.json"), "utf8"),
);

const model = buildTransitionModel(sequences);
const tensionTable = model.degrees.map((d) => tension(model, d));

fs.writeFileSync(
  path.join(DATA, "transition_model.json"),
  JSON.stringify(model, null, 1),
);
fs.writeFileSync(
  path.join(DATA, "tension.json"),
  JSON.stringify(tensionTable, null, 1),
);

console.log(
  `model: ${model.sequenceCount} sequences, ${model.chordCount} chords, ${model.degrees.length} degrees`,
);

console.log("\nTop transitions (from -> to : count):");
const rows = Object.entries(model.firstOrder)
  .flatMap(([from, tos]) =>
    Object.entries(tos).map(([to, count]) => [from, to, count] as const),
  )
  .sort((a, b) => b[2] - a[2])
  .slice(0, 20);
for (const [from, to, count] of rows) {
  console.log(`  ${from} -> ${to} : ${count}`);
}

console.log("\nTension table (functional + empirical hybrid):");
for (const t of tensionTable) {
  console.log(
    `  ${t.degree.padEnd(5)} tension=${t.tension.toFixed(3)} func=${t.functional.toFixed(2)} emp=${t.empirical.toFixed(2)} ent=${t.entropy.toFixed(2)} fin=${t.finality.toFixed(2)}`,
  );
}
