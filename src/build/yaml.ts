// YAML parsing with source positions, so schema errors can point at file:line:col.
import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Document } from "yaml";
import type { z } from "zod";
import type { Diagnostic } from "../model/compiled.ts";

export interface YamlSource {
  file: string;
  doc: Document;
  lines: LineCounter;
  /** Added to reported lines, for YAML embedded in a larger file (frontmatter). */
  lineOffset: number;
}

export function parseYaml(file: string, text: string, lineOffset = 0): { src: YamlSource; value: unknown; diagnostics: Diagnostic[] } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false });
  const src = { file, doc, lines, lineOffset };
  const diagnostics: Diagnostic[] = doc.errors.map((e) => ({
    severity: "error",
    file,
    line: (e.linePos?.[0].line ?? 1) + lineOffset,
    col: e.linePos?.[0].col,
    message: `YAML: ${e.message.split("\n")[0]}`,
  }));
  return { src, value: diagnostics.length ? undefined : doc.toJS(), diagnostics };
}

/** Position of the deepest existing node along `path`; map entries point at their key. */
export function locate(src: YamlSource, path: readonly PropertyKey[]): { line: number; col: number } {
  let node: unknown = src.doc.contents;
  let offset = (node as { range?: number[] } | null)?.range?.[0] ?? 0;
  for (const seg of path) {
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(seg));
      if (!pair) break;
      offset = (pair.key as { range?: number[] }).range?.[0] ?? offset;
      node = pair.value;
    } else if (isSeq(node)) {
      const item = node.items[Number(seg)] as { range?: number[] } | undefined;
      if (!item) break;
      offset = item.range?.[0] ?? offset;
      node = item;
    } else break;
  }
  const { line, col } = src.lines.linePos(offset);
  return { line: line + src.lineOffset, col };
}

export function at(src: YamlSource, path: readonly PropertyKey[], message: string, severity: Diagnostic["severity"] = "error"): Diagnostic {
  return { severity, file: src.file, ...locate(src, path), message };
}

/** Path to point at and message for a zod issue (unknown keys point at the key itself). */
export function describeIssue(issue: z.core.$ZodIssue): { path: PropertyKey[]; message: string } {
  const path = [...issue.path];
  let message = issue.message;
  if (issue.code === "unrecognized_keys") {
    path.push(issue.keys[0]!);
    message = `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
  } else if (issue.code === "invalid_type" && message.endsWith("received undefined")) message = "required";
  const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return { path, message: `${where}${message}` };
}

export function zodDiagnostics(src: YamlSource, error: z.ZodError, prefix: readonly PropertyKey[] = []): Diagnostic[] {
  return error.issues.map((issue) => {
    const { path, message } = describeIssue(issue);
    return at(src, [...prefix, ...path], message);
  });
}
