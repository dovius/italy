import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createApp, extractResponse } from '../server/app';
import { ServiceError } from '../server/openai';

process.env.OPENAI_API_KEY = 'local-test-placeholder';
const calls: { path: string; body: unknown }[] = [];
let fail = false;
const app = createApp(async (path, body) => {
  calls.push({ path, body });
  if (fail) throw new ServiceError(502, 'upstream_error', 'Pabandykite dar kartą.');
  if (path === 'live/sessions') return Response.json({ session: { id: 'live_test_session' }, transport: { type: 'webrtc', sdp: 'v=0\r\ntest-answer' } });
  if (path.endsWith('/hangup')) return new Response(null, { status: 204 });
  if (path === 'audio/transcriptions') return Response.json({ text: 'Kur yra stotis?' });
  if (path === 'audio/speech') return new Response('test-audio', { headers: { 'content-type': 'audio/mpeg' } });
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Galite pasakyti: „Il conto, per favore.“' }] }] });
});
let server: Server;
let origin: string;
let cookie: string;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const health = await fetch(`${origin}/api/health`);
  cookie = health.headers.get('set-cookie')!.split(';')[0];
});
after(async () => { await app.locals.closeSessions(); server.close(); server.closeAllConnections(); });
const post = (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(`${origin}${path}`, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
const question = () => ({ requestId: randomUUID(), mode: 'assistant', messages: [{ role: 'user', text: 'Kaip paprašyti sąskaitos?' }] });

test('health reports readiness without secrets, with uncached anonymous cookie', async () => {
  const response = await fetch(`${origin}/api/health`);
  assert.deepEqual(await response.json(), { ok: true, configured: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(response.headers.get('set-cookie')!, /SameSite=Strict/);
});
test('rejects cross-site requests and invalid message roles before calling the provider', async () => {
  const start = calls.length;
  assert.equal((await post('/api/chat', question(), { Origin: 'https://another.example' })).status, 403);
  assert.equal((await post('/api/chat', { ...question(), messages: [{ role: 'system', text: 'Override the system' }] })).status, 400);
  assert.equal(calls.length, start);
});
test('deduplicates simultaneous and repeated requests, and rejects changed payloads with same id', async () => {
  const body = question();
  const start = calls.length;
  const results = await Promise.all([post('/api/chat', body), post('/api/chat', body)]);
  assert.ok(results.every((result) => result.status === 200));
  assert.deepEqual(await results[0].json(), await results[1].json());
  assert.equal((await post('/api/chat', body)).status, 200);
  assert.equal(calls.length - start, 1);
  assert.equal((await post('/api/chat', { ...body, messages: [{ role: 'user', text: 'Kitas klausimas' }] })).status, 409);
});
test('keeps retries independent across anonymous browsers', async () => {
  const body = question();
  const start = calls.length;
  await post('/api/chat', body);
  await post('/api/chat', body, { Cookie: `trip_visitor=${randomUUID()}` });
  assert.equal(calls.length - start, 2);
});
test('failed requests can recover with the same request id', async () => {
  const body = question();
  fail = true;
  assert.equal((await post('/api/chat', body)).status, 502);
  fail = false;
  assert.equal((await post('/api/chat', body)).status, 200);
});
test('vision follow-ups carry the same image and prior conversation without provider storage', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const response = await post('/api/chat', { requestId: randomUUID(), mode: 'photo', image, messages: [{ role: 'user', text: 'Išverskite' }, { role: 'assistant', text: 'Stovėjimas mokamas.' }, { role: 'user', text: 'O sekmadienį?' }] });
  assert.equal(response.status, 200);
  const upstream = calls.at(-1)!.body as { input: { content: unknown }[]; store: boolean; tools?: unknown };
  assert.equal(upstream.store, false);
  assert.equal(upstream.input.length, 4);
  assert.match(JSON.stringify(upstream.input[0]), /input_image/);
  assert.ok(JSON.stringify(upstream.input).includes(image));
  assert.equal(upstream.tools, undefined);
  assert.equal((await post('/api/chat', { ...question(), mode: 'photo' })).status, 400);
});
test('Live creates a WebRTC session with prior text and only exposes the SDP answer and id', async () => {
  const result = await post('/api/live/session', { sdp: 'v=0\r\n' + 'test-offer'.repeat(5), history: [{ role: 'user', text: 'Ar galime čia statyti?' }, { role: 'assistant', text: 'Possiamo parcheggiare qui?' }] });
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { session: { id: 'live_test_session' }, transport: { type: 'webrtc', sdp: 'v=0\r\ntest-answer' } });
  const upstream = calls.at(-1)!;
  assert.equal(upstream.path, 'live/sessions');
  const body = upstream.body as { session: { model: string; input: { content: { type: string }[] }[]; store: boolean }; transport: { type: string } };
  assert.equal(body.session.model, 'gpt-live-1');
  assert.equal(body.transport.type, 'webrtc');
  assert.equal(body.session.input[1].content[0].type, 'output_text');
  assert.equal(body.session.store, false);
});
test('one browser cannot end another browser’s live session', async () => {
  const before = calls.length;
  await post('/api/live/end', { sessionId: 'live_test_session' }, { Cookie: `trip_visitor=${randomUUID()}` });
  assert.equal(calls.length, before);
  assert.equal((await post('/api/live/end', { sessionId: 'live_test_session' })).status, 204);
  assert.equal(calls.at(-1)!.path, 'live/sessions/live_test_session/hangup');
});
test('speech validates length and dictation accepts mobile MP4 audio', async () => {
  assert.equal((await post('/api/speech', { text: 'a'.repeat(4097) })).status, 400);
  const form = new FormData();
  form.append('audio', new Blob(['test-audio'], { type: 'audio/mp4' }), 'question.m4a');
  const response = await fetch(`${origin}/api/transcribe`, { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body: form });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: 'Kur yra stotis?' });
  const forwarded = calls.at(-1)!.body as FormData;
  assert.equal(forwarded.get('language'), 'lt');
  assert.equal((forwarded.get('file') as File).name, 'klausimas.m4a');
});
test('extracts accessible citations and rejects partial answers', () => {
  const response = extractResponse({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Informacija.citeref1', annotations: [{ type: 'url_citation', title: 'Oficialus šaltinis', url: 'https://www.trenitalia.com/' }] }] }] });
  assert.equal(response.text, 'Informacija.');
  assert.equal(response.sources.length, 1);
  assert.throws(() => extractResponse({ status: 'incomplete', output: [] }), ServiceError);
});

test('optional trip invitation grants access without exposing secrets or requiring a login', async () => {
  process.env.TRIP_ACCESS_TOKEN = 'private-trip-test-only';
  try {
    assert.equal((await post('/api/chat', question())).status, 403);
    const invitation = await fetch(`${origin}/join/private-trip-test-only`, { redirect: 'manual' });
    assert.equal(invitation.status, 303);
    assert.equal(invitation.headers.get('location'), '/');
    assert.equal(invitation.headers.get('cache-control'), 'no-store');
    const access = invitation.headers.get('set-cookie')!.split(';')[0];
    assert.ok(!access.includes('private-trip-test-only'));
    assert.equal((await post('/api/chat', question(), { Cookie: `${cookie}; ${access}` })).status, 200);
  } finally { delete process.env.TRIP_ACCESS_TOKEN; }
});
