// Which tokens of one goal view correspond to which of the next, for goals that move between steps:
// a longest common subsequence of the token texts (best effort, no markers needed).

/** Pairs [i, j] of equal tokens, in order, as many as possible. */
export function matchTokens(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // len[i * (m + 1) + j]: the longest common subsequence of a[i..] and b[j..]
  const len = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * (m + 1) + j] = a[i] === b[j] ? len[(i + 1) * (m + 1) + j + 1]! + 1 : Math.max(len[(i + 1) * (m + 1) + j]!, len[i * (m + 1) + j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (len[(i + 1) * (m + 1) + j]! >= len[i * (m + 1) + j + 1]!) i++;
    else j++;
  }
  return pairs;
}
