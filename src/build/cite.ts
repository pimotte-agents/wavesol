// Citations: the talk's BibTeX file through citation-js, in author–year style (APA). Slides cite with
// [@key], [@key, p. 3] or [@a; @b]; a `references` node lists every work cited in the talk.
import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";

export interface CiteItem {
  id: string;
  /** e.g. "3" with label "page" for "p. 3" */
  locator?: string;
  label?: string;
  /** free text after the citation, for locators we don't recognise */
  suffix?: string;
}

const LABELS: Record<string, string> = {
  "p.": "page",
  "pp.": "page",
  "page": "page",
  "pages": "page",
  "chap.": "chapter",
  "ch.": "chapter",
  "chapter": "chapter",
  "sec.": "section",
  "section": "section",
  "§": "section",
  "fig.": "figure",
  "eq.": "equation",
  "vol.": "volume",
};

/** Parses the inside of a [@…] group: "@a, p. 3; @b". Undefined if it is not a citation. */
export function parseCitation(text: string): CiteItem[] | undefined {
  const parts = text.split(";").map((p) => p.trim());
  const items: CiteItem[] = [];
  for (const part of parts) {
    const m = /^@([\w:.\-/]*\w)(?:\s*,\s*(.+))?$/.exec(part);
    if (!m) return undefined;
    const item: CiteItem = { id: m[1]! };
    const loc = m[2]?.trim();
    if (loc) {
      const l = /^(\S+)\s+(.+)$/.exec(loc);
      const label = l && LABELS[l[1]!.toLowerCase()];
      if (label) Object.assign(item, { label, locator: l[2]! });
      else if (/^[\d–-]+$/.test(loc)) Object.assign(item, { label: "page", locator: loc });
      else item.suffix = `, ${loc}`;
    }
    items.push(item);
  }
  return items.length ? items : undefined;
}

/** Common TeX in BibTeX fields that citation-js leaves as is, e.g. {\TeX}. */
function untex(s: string): string {
  return s
    .replace(/\\(La)?TeX(\{\})?/g, (_m, la: string | undefined) => (la ? "LaTeX" : "TeX"))
    .replace(/\\&/g, "&")
    .replace(/[{}]/g, "");
}

export interface Bibliography {
  /** Formats a citation, or names the keys the bibliography doesn't have. */
  cite(items: CiteItem[]): { text: string; title: string } | { error: string };
  /** Keys cited so far, in order of first citation. */
  cited(): string[];
  /** Announces keys cited somewhere in the talk, so citations get the same a/b suffixes as the references. */
  expect(keys: string[]): void;
  /** The bibliography of the given keys, as HTML. */
  references(keys: string[]): string;
}

export function loadBibliography(bibtex: string): Bibliography | { error: string } {
  let all: Cite;
  try {
    all = new Cite(bibtex);
  } catch (e) {
    return { error: `could not read the bibliography: ${e instanceof Error ? e.message : String(e)}` };
  }
  for (const entry of all.data as { title?: string }[]) if (entry.title) entry.title = untex(entry.title);
  const ids = new Set((all.data as { id: string }[]).map((d) => d.id));
  const cited: string[] = [];
  const expected = new Set<string>();
  return {
    cite(items) {
      const missing = items.filter((i) => !ids.has(i.id)).map((i) => i.id);
      if (missing.length) return { error: `unknown citation key${missing.length > 1 ? "s" : ""} ${missing.map((k) => `"${k}"`).join(", ")}` };
      for (const i of items) if (!cited.includes(i.id)) cited.push(i.id);
      // citation-js's typings miss `template` and want its own label union; LABELS only holds CSL labels
      // the talk's other citations as context: two works by the same author and year become 2026a / 2026b
      const others = [...new Set([...expected, ...cited])].filter((k) => !items.some((i) => i.id === k));
      const text = all.format("citation", { template: "apa", format: "text", entry: items, citationsPre: others } as never) as string;
      const title = all.format("bibliography", { template: "apa", format: "text", entry: items.map((i) => i.id) }) as string;
      return { text, title: title.trim() };
    },
    cited: () => [...cited],
    expect(keys) {
      for (const k of keys) if (ids.has(k)) expected.add(k);
    },
    references(keys) {
      if (!keys.length) return "";
      return (all.format("bibliography", { template: "apa", format: "html", entry: keys }) as string).trim();
    },
  };
}
