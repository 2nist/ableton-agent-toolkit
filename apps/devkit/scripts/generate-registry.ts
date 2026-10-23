#!/usr/bin/env tsx
/**
 * Auto-generates:
 *   1. `src/lib/componentRegistry.generated.ts` — component dependency graph
 *   2. `src/puck.generated.tsx` — Puck visual-editor config for all components
 *
 * For each .tsx file it extracts:
 *  - The default-export name (component name)
 *  - Category (derived from parent directory)
 *  - Dependencies (local ./ or ../ imports for sibling components)
 *  - Props interface name + member types (for Puck field auto-detection)
 *
 * Usage:
 *   npx tsx scripts/generate-registry.ts
 *   (wired into `npm run dev` and `npm run build` as a pre-step)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPONENTS_DIR = path.resolve(__dirname, "../../trackdraft/src/components");
const REGISTRY_OUTPUT = path.resolve(__dirname, "../src/lib/componentRegistry.generated.ts");
const PUCK_OUTPUT = path.resolve(__dirname, "../src/puck.generated.tsx");

// ── Category mapping ─────────────────────────────────────────────────────
const CATEGORY_DIRS = new Set([
  "harmony", "structure", "lyrics", "layout", "dashboard", "details",
]);

// ── Known component names (populated as we scan) ─────────────────────────
const discoveredNames = new Set<string>();

// ── TypeScript type → Puck field type mapping ─────────────────────────────
const PUCK_FIELD_MAP: Record<string, string> = {
  string: "text",
  number: "number",
  boolean: "radio",
  array: "array",
};

// ── Heuristic: types that should be skipped (not Puck-editale fields) ────
const SKIP_PROP_NAMES = new Set([
  "children", "key", "ref", "className", "style",
]);

// ── Props type member info ───────────────────────────────────────────────
interface PropMember {
  name: string;
  tsType: string; // simplified: "string", "number", "boolean", "array", "callback", "other"
  optional: boolean;
  /** When tsType === "array" and the element type is an object literal or
   *  known interface, these are the sub-properties of each array item. */
  subMembers: PropMember[] | null;
}

interface ComponentInfo {
  name: string;
  relativePath: string;
  category: string;
  deps: string[];
  propsTypeName: string | null;
  propsMembers: PropMember[];
}

// ── AST walkers ──────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      results.push(...walkDir(full));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      results.push(full);
    }
  }
  return results;
}

function deriveCategory(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  if (parts.length > 0 && CATEGORY_DIRS.has(parts[0])) {
    return parts[0];
  }
  return "details";
}

function simplifyType(typeNode: ts.TypeNode): string {
  const kind = typeNode.kind;
  // Array types: `string[]` or `Array<string>`
  if (kind === ts.SyntaxKind.ArrayType) return "array";
  if (kind === ts.SyntaxKind.StringKeyword || ts.isTemplateLiteralTypeNode(typeNode)) return "string";
  if (kind === ts.SyntaxKind.NumberKeyword) return "number";
  if (kind === ts.SyntaxKind.BooleanKeyword) return "boolean";
  if (ts.isFunctionTypeNode(typeNode)) return "callback";
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if (name === "number" || name === "Number") return "number";
    if (name === "string" || name === "String") return "string";
    if (name === "boolean" || name === "Boolean") return "boolean";
    // Generic Array<T> or T[]
    if (name === "Array" || name.endsWith("[]")) return "array";
    return "other";
  }
  if (ts.isUnionTypeNode(typeNode)) {
    // "string" | null → string, number | undefined → number
    const types = typeNode.types.map((t) => simplifyType(t)).filter((t) => t !== "undefined" && t !== "null");
    if (types.length === 1) return types[0];
    return "other";
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    // "foo" as const or a literal string → still a string field in Puck
    return "string";
  }
  return "other";
}

/** Extract sub-members from an array's element type, if it is an object literal. */
function extractArrayElementMembers(typeNode: ts.TypeNode): PropMember[] | null {
  // Unwrap: ArrayType → element type; TypeReference<Array<T>> → typeArguments[0]
  let elementType: ts.TypeNode | undefined;
  if (ts.isArrayTypeNode(typeNode)) {
    elementType = typeNode.elementType;
  } else if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if ((name === "Array" || name.endsWith("[]")) && typeNode.typeArguments && typeNode.typeArguments.length > 0) {
      elementType = typeNode.typeArguments[0];
    }
  }
  if (!elementType) return null;

  // If it's a TypeLiteral like { id: string; name: string }, extract members
  if (ts.isTypeLiteralNode(elementType)) {
    const subMembers: PropMember[] = [];
    for (const member of elementType.members) {
      if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
        const name = member.name.text;
        if (SKIP_PROP_NAMES.has(name)) continue;
        const optional = !!member.questionToken;
        const tsType = member.type ? simplifyType(member.type) : "other";
        subMembers.push({ name, tsType, optional, subMembers: null });
      }
    }
    return subMembers.length > 0 ? subMembers : null;
  }

  return null;
}

function extractPropsMembers(sourceFile: ts.SourceFile, propsTypeName: string): PropMember[] {
  const members: PropMember[] = [];
  function visit(node: ts.Node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === propsTypeName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
          const name = member.name.text;
          if (SKIP_PROP_NAMES.has(name)) continue;
          const optional = !!member.questionToken;
          const tsType = member.type ? simplifyType(member.type) : "other";
          const subMembers =
            tsType === "array" && member.type
              ? extractArrayElementMembers(member.type)
              : null;
          members.push({ name, tsType, optional, subMembers });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return members;
}

function extractInfo(filePath: string): ComponentInfo | null {
  const sourceText = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

  let defaultExportName: string | null = null;
  let propsTypeName: string | null = null;
  const localImports: string[] = [];

  function visit(node: ts.Node) {
    // Default export
    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      if (ts.isIdentifier(node.expression)) {
        defaultExportName = node.expression.text;
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name && isDefaultExport(node)) {
      defaultExportName = node.name.text;
    }

    // Props interface
    if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith("Props")) {
      propsTypeName = node.name.text;
    }

    // Local imports
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith(".")) {
        const clause = node.importClause;
        if (clause) {
          if (clause.name) localImports.push(clause.name.text);
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) {
              localImports.push(el.name.text);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (!defaultExportName) return null;

  const relative = path.relative(COMPONENTS_DIR, filePath).replace(/\\/g, "/");
  const category = deriveCategory(relative);
  discoveredNames.add(defaultExportName);

  const propsMembers = propsTypeName ? extractPropsMembers(sourceFile, propsTypeName) : [];
  const deps = localImports.filter((name) => /^[A-Z]/.test(name));

  return {
    name: defaultExportName,
    relativePath: relative.replace(/\.tsx$/, ""),
    category,
    deps,
    propsTypeName,
    propsMembers,
  };
}

/** True only for `export default function Name()`. A plain `export function`
 *  is a *named* export: the registry emits a lazy `import()` typed as
 *  `{ default: unknown }`, which such a module can't satisfy — accepting
 *  `ExportKeyword` here registered named-export functions as components and
 *  broke `tsc` in every consumer of the generated registry. */
function isDefaultExport(node: ts.FunctionDeclaration): boolean {
  if (!node.modifiers) return false;
  return node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function resolveDeps(infos: ComponentInfo[]): ComponentInfo[] {
  const allNames = new Set(infos.map((c) => c.name));
  return infos.map((info) => ({
    ...info,
    deps: info.deps.filter((d) => allNames.has(d)),
  }));
}

// ── Puck config generation (delegated to shared @devkit/puck-engine) ─────
import { compilePuckConfig, scanComponentTree } from "@devkit/puck-engine";

// ── Existing registry generation ─────────────────────────────────────────

// ── Smart default props for preview rendering ────────────────────────────
const DEFAULT_PROPS: Record<string, string> = {
  // harmony
  KeySelector: `
  defaultProps: {
    activeKey: "C",
    activeScale: "major" as const,
    onChangeKey: () => {},
    onChangeScale: () => {},
  }`,
  HexWheel: `
  defaultProps: {
    keyName: "C" as const,
    scale: "major" as const,
    usedDegrees: new Set(["I", "IV", "V"]),
    onSelectDegree: () => {},
  }`,
  ChordCard: `
  defaultProps: {
    chord: {
      id: "preview-chord",
      root: "C" as const,
      quality: "" as const,
      beats: 4,
      bassNote: undefined,
      romanNumeral: "I",
      isSubstitution: false,
    } as any,
    keyName: "C" as const,
    scale: "major" as const,
    isSounding: false,
    isSelected: false,
    onSelect: () => {},
    onChange: () => {},
    onRemove: () => {},
  }`,
  ProgressionBuilder: `
  defaultProps: {
    section: {
      id: "preview-section",
      name: "Preview Verse",
      chords: [],
      beatsPerChord: 4,
    } as any,
    keyName: "C" as const,
    scale: "major" as const,
    bpm: 120,
    selectedChordId: null,
    onSelectChord: () => {},
    onChangeChords: () => {},
  }`,
  PresetPicker: `
  defaultProps: {
    onLoadPreset: () => {},
  }`,
  ChordInspector: `
  defaultProps: {
    chord: {
      id: "preview-chord",
      root: "C" as const,
      quality: "" as const,
      beats: 4,
      romanNumeral: "I",
      isSubstitution: false,
    } as any,
    keyName: "C" as const,
    scale: "major" as const,
    onSelectSubstitution: () => {},
    onClose: () => {},
  }`,
  // structure
  SectionCard: `
  defaultProps: {
    section: {
      id: "preview-section",
      name: "Verse",
      role: "verse" as const,
      bars: 8,
      velocity: "mf" as const,
      timeSignatureNumerator: 4,
      timeSignatureDenPower: 2,
      beatsPerChord: 4,
      chords: [],
    } as any,
    onChange: () => {},
    onDelete: () => {},
  }`,
  MapPicker: `
  defaultProps: {
    hasSections: false,
    onApply: () => {},
  }`,
  // lyrics
  LyricsEditor: `
  defaultProps: {
    sectionId: "preview-section",
  }`,
  MetricalTable: `
  defaultProps: {
    sectionId: "preview-section",
  }`,
  RhymeSuggestions: `
  defaultProps: {
    sectionId: "preview-section",
  }`,
  WritingContext: `
  defaultProps: {
    sectionId: "preview-section",
  }`,
};

function getDefaultPropsSnippet(name: string): string {
  return DEFAULT_PROPS[name] ?? "";
}

function generateRegistry(infos: ComponentInfo[]) {
  const lines: string[] = [
    "// Auto-generated by scripts/generate-registry.ts — do not edit by hand.",
    "// Regenerate with: npx tsx scripts/generate-registry.ts",
    "",
    "export interface ComponentEntry {",
    '  name: string;',
    '  path: string;',
    '  category: "harmony" | "structure" | "lyrics" | "layout" | "dashboard" | "details";',
    '  description: string;',
    '  deps: string[];',
    '  defaultProps?: Record<string, unknown>;',
    "}",
    "",
    "export const CATEGORY_COLORS: Record<ComponentEntry[\"category\"], string> = {",
    '  harmony: "#6366f1",',
    '  structure: "#10b981",',
    '  lyrics: "#f59e0b",',
    '  layout: "#ec4899",',
    '  dashboard: "#06b6d4",',
    '  details: "#8b5cf6",',
    "};",
    "",
    "const registry: ComponentEntry[] = [",
  ];

  for (const info of infos) {
    const description = `${info.name} component (auto-detected in ${info.category}/).`;
    const extra = getDefaultPropsSnippet(info.name);
    lines.push("  {");
    lines.push(`    name: ${JSON.stringify(info.name)},`);
    lines.push(`    path: ${JSON.stringify(`components/${info.relativePath}`)},`);
    lines.push(`    category: ${JSON.stringify(info.category)},`);
    lines.push(`    description: ${JSON.stringify(description)},`);
    lines.push(`    deps: ${JSON.stringify(info.deps)},`);
    if (extra) {
      lines.push(extra + ",");
    }
    lines.push("  },");
  }

  lines.push("];");
  lines.push("");
  lines.push("export default registry;");
  lines.push("");
  lines.push("/** Lookup a component entry by name */");
  lines.push("export function getByName(name: string): ComponentEntry | undefined {");
  lines.push("  return registry.find((c) => c.name === name);");
  lines.push("}");
  lines.push("");
  lines.push("/** Group components by category */");
  lines.push("export function groupByCategory(): Record<ComponentEntry[\"category\"], ComponentEntry[]> {");
  lines.push("  const groups = {} as Record<ComponentEntry[\"category\"], ComponentEntry[]>;");
  lines.push("  for (const c of registry) {");
  lines.push("    (groups[c.category] ??= []).push(c);");
  lines.push("  }");
  lines.push("  return groups;");
  lines.push("}");
  lines.push("");

  lines.push("// Lazy-loaders for each component. Uses @trackdraft alias so Vite resolves");
  lines.push("// them correctly (unlike import.meta.glob which can't cross project roots).");
  lines.push("/** Map of component name → lazy import function */");
  lines.push("export const componentLookup: Record<string, () => Promise<{ default: unknown }>> = {");
  for (const info of infos) {
    const importPath = `@trackdraft/components/${info.relativePath}`;
    lines.push(`  ${JSON.stringify(info.name)}: () => import(${JSON.stringify(importPath)}),`);
  }
  lines.push("};");
  lines.push("");

  fs.mkdirSync(path.dirname(REGISTRY_OUTPUT), { recursive: true });
  fs.writeFileSync(REGISTRY_OUTPUT, lines.join("\n"), "utf-8");
}

// ── Main ─────────────────────────────────────────────────────────────────
function main() {
  console.log("Scanning components in", COMPONENTS_DIR);
  const files = walkDir(COMPONENTS_DIR);
  console.log(`Found ${files.length} .tsx files`);

  const infos: ComponentInfo[] = [];
  for (const f of files) {
    const info = extractInfo(f);
    if (info) {
      infos.push(info);
    } else {
      console.warn(`  ⚠ No default export in ${path.relative(COMPONENTS_DIR, f)}`);
    }
  }

  const resolved = resolveDeps(infos);
  console.log(`Extracted ${resolved.length} components`);

  // Print summary
  for (const info of resolved) {
    const depStr = info.deps.length > 0 ? ` → depends on ${info.deps.join(", ")}` : "";
    const propStr = info.propsMembers.length > 0
      ? ` [props: ${info.propsMembers.map((m) => `${m.name}:${m.tsType}`).join(", ")}]`
      : "";
    console.log(`  ${info.category}/${info.name}${depStr}${propStr}`);
  }

  generateRegistry(resolved);
  console.log(`Wrote ${REGISTRY_OUTPUT}`);

  const puckComponents = scanComponentTree({
    componentsDir: COMPONENTS_DIR,
    outputPath: PUCK_OUTPUT,
  });
  compilePuckConfig({
    components: puckComponents,
    outputPath: PUCK_OUTPUT,
    importPrefix: "@trackdraft/components/",
  });
  console.log(`Wrote ${PUCK_OUTPUT} (${puckComponents.length} Puck components)`);
}

main();