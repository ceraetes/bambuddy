import type { ReactNode } from 'react';
import { fuzzyMatchIndices } from './fuzzyMatch';

/** Render `text` with fuzzy-matched characters (per token) wrapped in <strong>. */
export function highlightFuzzyMatch(text: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const matched = new Set<number>();
  for (const token of tokens) {
    const indices = fuzzyMatchIndices(text, token);
    if (!indices) return text;
    for (const i of indices) matched.add(i);
  }
  const sorted = [...matched].sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  let start = 0;
  for (const idx of sorted) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(<strong key={idx}>{text[idx]}</strong>);
    start = idx + 1;
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/** Render `text` with every case-insensitive occurrence of `query` wrapped in <strong>. */
export function highlightMatch(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const q = query.trim();
  const lower = text.toLowerCase();
  const qLower = q.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let idx = lower.indexOf(qLower, start);
  while (idx !== -1) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(<strong key={idx}>{text.slice(idx, idx + q.length)}</strong>);
    start = idx + q.length;
    idx = lower.indexOf(qLower, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
