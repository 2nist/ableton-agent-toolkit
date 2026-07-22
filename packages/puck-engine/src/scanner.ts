import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

export interface PropEntry {
  name: string;
  tsType: string;
}

export interface ComponentPropMetadata {
  name: string;
  /** Relative import path from the output file's directory (e.g. "./components/harmony/ChordCard") */
  relativePath: string;
  props: PropEntry[];
}

export interface PuckEngineOptions {
  componentsDir: string;
  outputPath: string;
}

const PUCK_FIELD_MAP: Record<string, string> = {
  string: "text",
  number: "number",
  boolean: "radio",
  array: "array",
};

const SKIP_PROP_NAMES = new Set(["children", "key", "ref", "className", "style"]);

function simplifyType(typeNode: ts.TypeNode): string {
  const kind = typeNode.kind;
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
    if (name === "Array" || name.endsWith("[]")) return "array";
    return "other";
  }
  if (ts.isUnionTypeNode(typeNode)) {
    const types = typeNode.types
      .map((t) => simplifyType(t))
      .filter((t) => t !== "undefined" && t !== "null");
    if (types.length === 1) return types[0];
    return "other";
  }
  if (ts.isLiteralTypeNode(typeNode)) return "string";
  return "other";
}

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

export function pfType(tsType: string): string | null {
  return PUCK_FIELD_MAP[tsType] ?? null;
}

/**
 * Scans all .tsx files in the component directory, extracts default-export
 * component names and their Puck-editable scalar prop metadata, and returns
 * an array of ComponentPropMetadata objects.
 */
export function scanComponentTree(options: PuckEngineOptions): ComponentPropMetadata[] {
  const { componentsDir } = options;
  const files = walkDir(componentsDir);
  const results: ComponentPropMetadata[] = [];

  for (const filePath of files) {
    const sourceText = fs.readFileSync(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);

    let defaultExportName: string | null = null;
    let propsTypeName: string | null = null;
    const propEntries: PropEntry[] = [];

    function visit(node: ts.Node) {
      if (ts.isExportAssignment(node) && !node.isExportEquals) {
        if (ts.isIdentifier(node.expression)) defaultExportName = node.expression.text;
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        const hasDefault = node.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.DefaultKeyword || m.kind === ts.SyntaxKind.ExportKeyword,
        );
        if (hasDefault) defaultExportName = node.name.text;
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text.endsWith("Props")) {
        propsTypeName = node.name.text;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    if (!defaultExportName) continue;

    if (propsTypeName) {
      function extractProps(node: ts.Node) {
        if (ts.isInterfaceDeclaration(node) && node.name.text === propsTypeName) {
          for (const member of node.members) {
            if (ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)) {
              const name = member.name.text;
              if (SKIP_PROP_NAMES.has(name)) continue;
              const tsType = member.type ? simplifyType(member.type) : "other";
              if (pfType(tsType) !== null) {
                propEntries.push({ name, tsType });
              }
            }
          }
        }
        ts.forEachChild(node, extractProps);
      }
      extractProps(sourceFile);
    }

    if (propEntries.length > 0) {
      const relative = path.relative(componentsDir, filePath).replace(/\\/g, "/").replace(/\.tsx$/, "");
      results.push({ name: defaultExportName, relativePath: relative, props: propEntries });
    }
  }

  return results;
}