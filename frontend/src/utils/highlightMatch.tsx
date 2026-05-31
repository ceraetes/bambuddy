import type { ReactNode } from 'react';

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
