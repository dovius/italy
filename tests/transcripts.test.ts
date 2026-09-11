import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTranscripts, liveHistory } from '../src/lib/transcripts';
import type { TranscriptFragment } from '../shared/types';
const fragment = (id: string, role: 'user' | 'assistant', text: string, start: number, end: number, session = 'live_one'): TranscriptFragment => ({ id, role, text, start, end, session });

test('late captions are ordered by timestamps, keep exact spaces, and do not duplicate events', () => {
  const fragments = [fragment('b', 'user', ' čia statyti?', 400, 800), fragment('a', 'user', 'Ar galime', 100, 400)];
  const rows = groupTranscripts([...fragments, fragments[0]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'Ar galime čia statyti?');
  assert.equal(rows[0].id, 'b');
});
test('overlapping input and translation grow independently without swallowing interruptions', () => {
  const rows = groupTranscripts([fragment('a', 'user', 'Kur', 0, 100), fragment('b', 'assistant', 'Dov’è', 200, 400), fragment('c', 'user', ' stotis?', 300, 700), fragment('d', 'assistant', ' la stazione?', 500, 900), fragment('e', 'user', 'Ne, autobusų.', 2800, 3300)]);
  assert.deepEqual(rows.map((r) => r.text), ['Kur stotis?', 'Dov’è la stazione?', 'Ne, autobusų.']);
});
test('new sessions do not merge captions with old timestamps and restore bounded history', () => {
  const fragments = [fragment('a', 'user', 'Klausimas', 5000, 6000), fragment('b', 'assistant', 'Risposta', 0, 400, 'live_two')];
  assert.deepEqual(groupTranscripts(fragments).map((r) => r.text), ['Klausimas', 'Risposta']);
  const many = Array.from({ length: 100 }, (_, i) => fragment(String(i), i % 2 ? 'assistant' : 'user', 'a'.repeat(1000), i * 3000, i * 3000 + 1000));
  const history = liveHistory(many);
  assert.ok(history.length <= 40);
  assert.ok(history.reduce((n, item) => n + item.text.length, 0) <= 18_000);
});
