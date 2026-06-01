/**
 * Case-insensitive fuzzy match: every character of `pattern` appears in `text`
 * in order (subsequence), e.g. "bpb" matches "Bambu PLA Basic".
 */
export function fuzzySubsequence(text: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return true;
  const t = text.toLowerCase();
  const pl = p.toLowerCase();
  let ti = 0;
  for (let pi = 0; pi < pl.length; pi++) {
    const idx = t.indexOf(pl[pi], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

/** Indices in `text` of characters consumed by a fuzzy match of `pattern`, or null. */
export function fuzzyMatchIndices(text: string, pattern: string): number[] | null {
  const p = pattern.trim();
  if (!p) return null;
  const t = text.toLowerCase();
  const pl = p.toLowerCase();
  const indices: number[] = [];
  let ti = 0;
  for (let pi = 0; pi < pl.length; pi++) {
    const idx = t.indexOf(pl[pi], ti);
    if (idx === -1) return null;
    indices.push(idx);
    ti = idx + 1;
  }
  return indices;
}

/** Whitespace-separated tokens; each must fuzzy-match the haystack. */
export function fuzzyMatchesHaystack(haystack: string, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => fuzzySubsequence(haystack, token));
}
