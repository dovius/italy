import type { TranscriptFragment, TranscriptRow } from '../../shared/types';

// Display groups are revisable caption blocks, not authoritative speech turns.
// Retain original fragments and timestamps so late/overlapping text isn't lost.
export function groupTranscripts(fragments: TranscriptFragment[]): TranscriptRow[] {
  const unique = [...new Map(fragments.map((fragment) => [fragment.id, fragment])).values()];
  const sessions = [...new Set(unique.map((fragment) => fragment.session))];
  const rows: TranscriptRow[] = [];
  for (const session of sessions) {
    for (const role of ['user', 'assistant'] as const) {
      const ordered = unique.filter((f) => f.session === session && f.role === role).sort((a, b) => a.start - b.start || a.end - b.end);
      let row: TranscriptRow | undefined;
      for (const fragment of ordered) {
        const gap = row ? fragment.start - row.end : Infinity;
        if (!row || gap > 1400 || (row.text.length > 300 && gap > 300)) {
          row = { ...fragment };
          rows.push(row);
        } else {
          row.text += fragment.text;
          row.end = Math.max(row.end, fragment.end);
          // Preserve the ID of the first received fragment if an earlier one arrives late.
          if (unique.findIndex((f) => f.id === fragment.id) < unique.findIndex((f) => f.id === row!.id)) row.id = fragment.id;
        }
      }
    }
  }
  return rows.sort((a, b) => sessions.indexOf(a.session) - sessions.indexOf(b.session) || a.start - b.start || (a.role === 'user' ? -1 : 1));
}

export function liveHistory(fragments: TranscriptFragment[]) {
  const selected: { role: 'user' | 'assistant'; text: string }[] = [];
  let length = 0;
  for (const row of groupTranscripts(fragments).reverse()) {
    if (!row.text.trim()) continue;
    if (length + row.text.length > 18_000 || selected.length >= 40) break;
    selected.unshift({ role: row.role, text: row.text });
    length += row.text.length;
  }
  return selected;
}
