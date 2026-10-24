// Parses a LaTeX macros file into KaTeX's `macros` option. Supports \newcommand, \renewcommand,
// \providecommand (with optional [n] argument count) and \DeclareMathOperator(*).

export interface MacroParse {
  macros: Record<string, string>;
  errors: { line: number; message: string }[];
}

export function parseMacros(tex: string): MacroParse {
  const macros: Record<string, string> = {};
  const errors: MacroParse["errors"] = [];
  const src = tex.replace(/(^|[^\\])%.*$/gm, "$1"); // strip comments, keep \%
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator)(\*?)/g;

  for (let m; (m = re.exec(src)); ) {
    let i = m.index + m[0].length;
    const skipWs = () => {
      while (/\s/.test(src[i] ?? "")) i++;
    };
    const group = (): string | undefined => {
      skipWs();
      if (src[i] !== "{") return undefined;
      let depth = 0;
      const start = i;
      for (; i < src.length; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) return src.slice(start + 1, i++);
      }
      return undefined;
    };

    skipWs();
    let name: string | undefined;
    if (src[i] === "{") name = group()?.trim();
    else {
      name = src.slice(i).match(/^\\[A-Za-z]+/)?.[0];
      i += name?.length ?? 0;
    }
    if (!name || !/^\\[A-Za-z]+$/.test(name)) {
      errors.push({ line: lineOf(m.index), message: `\\${m[1]}: expected a command name like \\foo` });
      continue;
    }

    if (m[1] === "DeclareMathOperator") {
      const body = group();
      if (body === undefined) errors.push({ line: lineOf(m.index), message: `\\DeclareMathOperator${name}: missing body` });
      else macros[name] = m[2] ? `\\operatorname*{${body}}` : `\\operatorname{${body}}`;
      continue;
    }

    skipWs();
    if (src[i] === "[") i = src.indexOf("]", i) + 1; // argument count: KaTeX infers it from #n
    skipWs();
    if (src[i] === "[") {
      errors.push({ line: lineOf(m.index), message: `${name}: optional arguments with defaults are not supported` });
      continue;
    }
    const body = group();
    if (body === undefined) errors.push({ line: lineOf(m.index), message: `${name}: missing body` });
    else if (m[1] !== "providecommand" || !(name in macros)) macros[name] = body;
  }
  return { macros, errors };
}
