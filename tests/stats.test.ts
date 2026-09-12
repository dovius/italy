import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { createApp } from '../server/app';
import { createNodeStats } from '../server/stats-node';
import { hash } from '../server/stats-auth';
import { ServiceError } from '../server/openai';
import type { Activity, StatsPage } from '../shared/stats';

process.env.OPENAI_API_KEY = 'stats-test-placeholder';
const password = 'test-admin-password-not-a-secret';
const notifications: { url: string; body: Record<string, string>; token: string | null }[] = [];
let notificationFailure = false;
let providerFailure = false;
let providerCalls = 0;
let directory: string;
let stats: NonNullable<ReturnType<typeof createNodeStats>>;
let app: ReturnType<typeof createApp>;
let server: Server;
let origin: string;
let admin: string;
const visitor = randomUUID();
const cookies = (id = visitor) => `trip_visitor=${id}`;
const question = (requestId = randomUUID()) => ({ requestId, mode: 'assistant', messages: [{ role: 'user', text: 'Kur yra stotis?' }] });
const post = (path: string, body: unknown, cookie = cookies(), extra: Record<string, string> = {}) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, ...extra }, body: JSON.stringify(body) });
const getStats = (query = '') => fetch(`${origin}/api/stats${query}`, { headers: { Cookie: admin } }).then(response => response.json() as Promise<StatsPage>);

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'italiano-stats-'));
  stats = createNodeStats({ STATS_ADMIN_PASSWORD: password, STATS_DB_PATH: join(directory, 'stats.sqlite'), NTFY_TOPIC_URL: 'https://ntfy.test/trip', NTFY_TOKEN: 'test-ntfy-token' }, async (url, init) => {
    notifications.push({ url: String(url), body: JSON.parse(String(init?.body)), token: new Headers(init?.headers).get('authorization') });
    return new Response(null, { status: notificationFailure ? 503 : 200 });
  })!;
  app = createApp(async path => {
    providerCalls++;
    if (providerFailure) throw new ServiceError(502, 'upstream_error', 'Nepavyko gauti atsakymo.');
    if (path === 'live/sessions') return Response.json({ session: { id: `live_${randomUUID()}` }, transport: { sdp: 'v=0\r\nanswer' } });
    if (path.endsWith('/hangup')) return new Response(null, { status: 204 });
    if (path === 'audio/transcriptions') return Response.json({ text: 'Diktuotas klausimas' });
    if (path === 'audio/speech') return new Response('audio');
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'La stazione è a destra.' }] }] });
  }, { stats });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = await post('/api/stats/login', { password });
  assert.equal(login.status, 200);
  admin = login.headers.get('set-cookie')!.split(';')[0];
});
after(async () => {
  await app?.locals.closeSessions();
  await stats?.service.flushNotifications();
  await stats?.close();
  server?.close(); server?.closeAllConnections();
  await rm(directory, { recursive: true, force: true });
});

test('stats and image APIs require separate admin authentication with same-origin login', async () => {
  for (const path of ['/api/stats', `/api/stats/images/${'a'.repeat(64)}`, `/api/stats/events/${'a'.repeat(64)}`]) {
    const response = await fetch(`${origin}${path}`, { headers: { Cookie: cookies(), 'x-admin': 'true' } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await post('/api/stats/login', { password }, '', { Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await post('/api/stats/login', { password: 'wrong' })).status, 401);
  assert.equal((await fetch(`${origin}/api/stats`, { headers: { Cookie: admin.replace(/.$/, 'x') } })).status, 401);
  const login = await post('/api/stats/login', { password });
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/api/stats', 'Max-Age=28800']) assert.ok(login.headers.get('set-cookie')!.includes(flag));
  assert.ok(!login.headers.get('set-cookie')!.includes(password));
  const logout = await post('/api/stats/logout', {}, admin);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
});

test('questions record one full answer across concurrent retries; visitors and conversations remain distinct', async () => {
  const body = { ...question(), conversationId: randomUUID() };
  const before = providerCalls;
  const answers = await Promise.all([post('/api/chat', body), post('/api/chat', body)]);
  assert.deepEqual(answers.map(response => response.status), [200, 200]);
  assert.equal(providerCalls - before, 1);
  await post('/api/chat', body);
  const id = await hash(visitor);
  let result = await getStats(`?visitor=${id}`);
  assert.equal(result.total, 1);
  assert.equal(result.events[0].text, 'Kur yra stotis?');
  assert.equal(result.events[0].answer, 'La stazione è a destra.');
  assert.equal(result.events[0].conversationId, body.conversationId);
  assert.ok(!JSON.stringify(result).includes(visitor));
  const other = randomUUID();
  await post('/api/chat', body, cookies(other));
  result = await getStats(`?conversation=${body.conversationId}`);
  assert.equal(result.total, 2);
  assert.equal(new Set(result.events.map(event => event.visitorId)).size, 2);
  await stats.service.flushNotifications();
  assert.equal(notifications.length, 2);
  assert.equal(notifications[0].url, 'https://ntfy.test/');
  assert.equal(notifications[0].token, 'Bearer test-ntfy-token');
  assert.equal(notifications[0].body.topic, 'trip');
  assert.match(notifications[0].body.message, /La stazione/);
  assert.match(notifications[0].body.click, /\/stats\?event=/);
  assert.ok(!JSON.stringify(notifications).includes(password));
});

test('photo history retains the actual image once, including images larger than one SQLite row', async () => {
  const image = 'data:image/jpeg;base64,' + 'YQ=='.slice(0, 2).repeat(1_200_000);
  const conversationId = randomUUID();
  for (const text of ['Išverskite nuotrauką', 'O sekmadienį?']) {
    const response = await post('/api/chat', { ...question(), mode: 'photo', image, imageName: 'meniu.jpg', conversationId, messages: [{ role: 'user', text }] });
    assert.equal(response.status, 200);
  }
  const data = await getStats(`?conversation=${conversationId}`);
  assert.equal(data.total, 2);
  assert.equal(data.counts.photo, 2);
  assert.equal(data.events[0].imageId, data.events[1].imageId);
  assert.equal(data.events[0].imageName, 'meniu.jpg');
  const imageResponse = await fetch(`${origin}/api/stats/images/${data.events[0].imageId}`, { headers: { Cookie: admin } });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg');
  assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
  assert.equal((await imageResponse.arrayBuffer()).byteLength, Buffer.from(image.split(',')[1], 'base64').byteLength);
  const db = new DatabaseSync(join(directory, 'stats.sqlite'));
  assert.equal(db.prepare('SELECT COUNT(DISTINCT id) AS count FROM stats_images').get()!.count, 1);
  assert.ok(Number(db.prepare('SELECT COUNT(*) AS count FROM stats_images').get()!.count) > 1);
  db.close();
});

test('live captions enforce ownership, deduplicate late fragments, and survive ending the call', async () => {
  const response = await post('/api/live/session', { sdp: 'v=0\r\n' + 'offer'.repeat(8) });
  const { session } = await response.json() as { session: { id: string } };
  const fragments = [
    { id: 'input_b', session: session.id, role: 'user', text: ' čia statyti?', start: 400, end: 800 },
    { id: 'input_a', session: session.id, role: 'user', text: 'Ar galime', start: 0, end: 400 },
    { id: 'output', session: session.id, role: 'assistant', text: 'Possiamo parcheggiare qui?', start: 300, end: 1100 },
  ];
  const body = { sessionId: session.id, fragments };
  assert.equal((await post('/api/live/fragments', body, cookies(randomUUID()))).status, 403);
  assert.equal((await post('/api/live/fragments', { ...body, fragments: [{ ...fragments[0], session: 'some_other_session' }] })).status, 400);
  assert.equal((await post('/api/live/fragments', body)).status, 204);
  assert.equal((await post('/api/live/end', { sessionId: session.id })).status, 204);
  assert.equal((await post('/api/live/fragments', body)).status, 204);
  const events = await getStats(`?kind=live&visitor=${await hash(visitor)}`);
  const event = await fetch(`${origin}/api/stats/events/${events.events[0].id}`, { headers: { Cookie: admin } }).then(response => response.json() as Promise<Activity>);
  assert.equal(event.fragments?.length, 3);
  assert.equal(event.text, 'Ar galime čia statyti?');
  assert.equal(event.answer, 'Possiamo parcheggiare qui?');
  assert.equal(event.status, 'ended');
});

test('renaming, literal search, type/date filters and pagination operate on stored history', async () => {
  const id = await hash(visitor);
  assert.equal((await post(`/api/stats/visitors/${id}`, { name: 'Dovydas' }, admin)).status, 200);
  assert.equal((await post(`/api/stats/visitors/${id}`, { name: 'Someone else' }, cookies())).status, 401);
  assert.ok((await getStats('?q=Dovydas')).events.every(event => event.visitorName === 'Dovydas'));
  assert.equal((await getStats('?q=%25')).total, 0);
  assert.equal((await getStats(`?from=${Date.now() + 1000}`)).total, 0);
  for (let i = 0; i < 34; i++) await stats.service.record({ action: 'dictation', visitor: id, text: `Diktuota ${i}` });
  const first = await getStats('?kind=dictation');
  const second = await getStats('?kind=dictation&page=2');
  assert.equal(first.events.length, 30);
  assert.equal(second.events.length, 4);
  assert.equal(new Set([...first.events, ...second.events].map(event => event.id)).size, 34);
  assert.equal((await fetch(`${origin}/api/stats?page=abc`, { headers: { Cookie: admin } })).status, 400);
});

test('provider and notification failures retain the question and recover without another copy', async () => {
  const body = question();
  providerFailure = true;
  assert.equal((await post('/api/chat', body)).status, 502);
  const id = `${await hash(visitor)}-${body.requestId}`;
  assert.equal(stats.service.store.event(id)?.status, 'error');
  providerFailure = false;
  assert.equal((await post('/api/chat', body)).status, 200);
  notificationFailure = true;
  // Target this event first; preceding events have already been validated.
  const db = new DatabaseSync(join(directory, 'stats.sqlite'));
  db.prepare('UPDATE stats_events SET notify_at = NULL WHERE id != ?').run(id);
  db.close();
  await stats.service.flushNotifications();
  assert.equal(stats.service.store.event(id)?.notification, 'failed');
  assert.equal(stats.service.store.event(id)?.status, 'complete');
  notificationFailure = false;
  assert.equal((await post('/api/stats/notifications/retry', {}, admin)).status, 200);
  await stats.service.flushNotifications();
  assert.equal(stats.service.store.event(id)?.notification, 'sent');
});

test('disk history survives closing and reopening the server and expires photos with their last event', async () => {
  const path = join(directory, 'persist.sqlite');
  const config = { STATS_ADMIN_PASSWORD: password, STATS_DB_PATH: path };
  const first = createNodeStats(config)!;
  first.service.setOrigin('https://trip.example');
  const requestId = randomUUID();
  await first.service.record({ action: 'chat', visitor: await hash(visitor), requestId, conversationId: requestId, mode: 'photo', text: 'Persist me', image: 'data:image/png;base64,YQ==' });
  await first.close();
  const second = createNodeStats(config)!;
  assert.equal(second.service.config.APP_ORIGIN, 'https://trip.example');
  const id = `${await hash(visitor)}-${requestId}`;
  const event = second.service.store.event(id)!;
  assert.equal(event.text, 'Persist me');
  assert.equal(second.service.store.image(event.imageId!), 'data:image/png;base64,YQ==');
  const db = new DatabaseSync(path);
  db.prepare('UPDATE stats_events SET updated_at = ?').run(Date.now() - 31 * 86400_000);
  db.close();
  second.service.store.prune(30);
  assert.equal(second.service.store.event(id), undefined);
  assert.equal(second.service.store.image(event.imageId!), undefined);
  await second.close();
});

test('repeated wrong admin passwords are rate limited independently of traveler requests', async () => {
  for (let i = 0; i < 12; i++) await post('/api/stats/login', { password: 'wrong' });
  assert.equal((await post('/api/stats/login', { password: 'wrong' })).status, 429);
  assert.equal((await post('/api/chat', question())).status, 200);
});

test('notification excerpts retain the answer to a long question and the latest live exchange', async () => {
  const sent: { message: string }[] = [];
  const local = createNodeStats({ STATS_ADMIN_PASSWORD: password, STATS_DB_PATH: ':memory:', NTFY_TOPIC_URL: 'https://ntfy.test/trip' }, async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response(null, { status: 200 }); })!;
  const id = await hash(visitor);
  const requestId = randomUUID();
  try {
    await local.service.record({ action: 'chat', visitor: id, requestId, conversationId: requestId, mode: 'assistant', text: 'Klausimas 🧳 '.repeat(600) });
    await local.service.record({ action: 'answer', visitor: id, requestId, text: 'Risposta italiana.', sources: [] });
    await local.service.flushNotifications();
    assert.match(sent[0].message, /Risposta italiana/);
    await local.service.record({ action: 'live', visitor: id, sessionId: 'live_long' });
    await local.service.record({ action: 'fragments', visitor: id, sessionId: 'live_long', fragments: [
      { id: 'input', session: 'live_long', role: 'user', text: 'Ankstesnė frazė 🧳 '.repeat(400) + 'Paskutinis klausimas?', start: 0, end: 1000 },
      { id: 'output', session: 'live_long', role: 'assistant', text: 'Una frase precedente. '.repeat(400) + 'Ultima risposta italiana.', start: 0, end: 1100 },
    ] });
    await local.service.record({ action: 'end', visitor: id, sessionId: 'live_long' });
    await local.service.flushNotifications();
    assert.match(sent[1].message, /Paskutinis klausimas/);
    assert.match(sent[1].message, /Ultima risposta italiana/);
    assert.ok(sent.every(item => !item.message.includes('�') && new TextEncoder().encode(item.message).length < 3100));
  } finally { await local.close(); }
});
