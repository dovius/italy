import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import type { Activity, StatsPage } from '../../shared/stats';
import { mockLive } from './fixtures/live';

const traveler = 'a'.repeat(64);
const other = 'b'.repeat(64);
const imageId = 'c'.repeat(64);
const timestamp = new Date('2026-09-12T10:20:00Z').getTime();
const events: Activity[] = [
  { id: `${traveler}-photo`, visitorId: traveler, visitorName: 'Dovydas', kind: 'photo', conversationId: 'photo-conversation', createdAt: timestamp, updatedAt: timestamp, status: 'complete', text: 'Išverskite ir paprastai paaiškinkite šią nuotrauką.', answer: 'Spagečiai su pesto kainuoja **12 eurų**. Aptarnavimo mokestis vienam žmogui – 2,50 euro.', error: '', imageId, imageName: 'Trattoria-meniu.jpg', sources: [], notification: 'sent' },
  { id: `${other}-question`, visitorId: other, visitorName: 'Rūta', kind: 'question', conversationId: 'question-conversation', createdAt: timestamp - 240_000, updatedAt: timestamp - 240_000, status: 'complete', text: 'Kur Florencijoje galima išgerti geros kavos?', answer: 'Užsukite į vietinę kavinę ir užsisakykite espresso prie baro. Itališkai: „Un caffè, per favore.“', error: '', imageId: null, imageName: '', sources: [], notification: 'sent' },
  { id: `${traveler}-live`, visitorId: traveler, visitorName: 'Dovydas', kind: 'live', conversationId: 'live-conversation', createdAt: timestamp - 500_000, updatedAt: timestamp - 500_000, status: 'ended', text: 'Ar galime čia statyti?', answer: 'Possiamo parcheggiare qui?', error: '', imageId: null, imageName: '', sources: [], notification: 'sent', fragments: [
    { id: 'b', session: 'live-conversation', role: 'user', text: ' čia statyti?', start: 400, end: 900 },
    { id: 'a', session: 'live-conversation', role: 'user', text: 'Ar galime', start: 0, end: 400 },
    { id: 'c', session: 'live-conversation', role: 'assistant', text: 'Possiamo parcheggiare qui?', start: 400, end: 1200 },
  ] },
];

async function mockStats(page: Page, empty = false) {
  const calls: { path: string; query: URLSearchParams; body?: any }[] = [];
  const items = structuredClone(empty ? [] : events);
  let authenticated = true;
  let holdNext = false;
  let release: (() => void) | undefined;
  const menu = await readFile('tests/fixtures/menu.svg', 'utf8');
  await page.route('**/api/stats**', async route => {
    const url = new URL(route.request().url());
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    calls.push({ path: url.pathname, query: url.searchParams, body });
    const headers = { 'Cache-Control': 'no-store' };
    if (!authenticated) { await route.fulfill({ status: 401, json: { code: 'admin_auth', error: 'Prisijunkite prie administravimo puslapio.' }, headers }); return; }
    if (url.pathname.includes('/images/')) { await route.fulfill({ contentType: 'image/svg+xml', body: menu, headers }); return; }
    if (url.pathname.includes('/events/')) { await route.fulfill({ json: items.find(event => url.pathname.endsWith(event.id)), headers }); return; }
    if (url.pathname.includes('/visitors/')) {
      for (const event of items) if (url.pathname.endsWith(event.visitorId)) event.visitorName = body.name;
      await route.fulfill({ json: { ok: true }, headers }); return;
    }
    if (url.pathname.endsWith('/logout')) { authenticated = false; await route.fulfill({ status: 204, headers }); return; }
    const kind = url.searchParams.get('kind');
    const visitor = url.searchParams.get('visitor');
    const q = url.searchParams.get('q')?.toLowerCase();
    const filtered = items.filter(event => (!kind || event.kind === kind) && (!visitor || event.visitorId === visitor) && (!q || [event.text, event.answer, event.visitorName].join(' ').toLowerCase().includes(q)));
    const data: StatsPage = {
      events: filtered.map(event => ({ ...event, fragments: undefined })), total: filtered.length, page: 1, pages: 1,
      counts: { question: filtered.filter(event => event.kind === 'question').length, photo: filtered.filter(event => event.kind === 'photo').length, live: filtered.filter(event => event.kind === 'live').length, dictation: 0, speech: 0 },
      visitors: [...new Set(items.map(event => event.visitorId))].map(id => ({ id, name: items.find(event => event.visitorId === id)!.visitorName, count: items.filter(event => event.visitorId === id).length, lastSeen: timestamp })), retentionDays: 30, ntfyConfigured: true, notificationFailures: 0,
    };
    if (holdNext) { holdNext = false; await new Promise<void>(resolve => { release = resolve; }); }
    await route.fulfill({ json: data, headers }).catch(() => {});
  });
  return { calls, expire: () => { authenticated = false; }, hold: () => { holdNext = true; }, waiting: () => Boolean(release), release: () => { release?.(); } };
}

test('stats has its own working login and is absent from the main navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ką norite padaryti?' })).toBeVisible();
  await expect(page.locator('a[href*="/stats"]')).toHaveCount(0);
  await page.goto('/stats');
  await expect(page.getByRole('button', { name: 'Prisijungti', exact: true })).toBeVisible();
  await page.getByLabel('Administratoriaus slaptažodis').fill('wrong');
  await page.getByRole('button', { name: 'Prisijungti', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Neteisingas slaptažodis.');
  await page.getByLabel('Administratoriaus slaptažodis').fill('browser-test-admin-password');
  await page.getByRole('button', { name: 'Prisijungti', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visa veikla' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Visa veikla' })).toBeVisible();
  await page.getByRole('button', { name: 'Atsijungti' }).click();
  await expect(page.getByLabel('Administratoriaus slaptažodis')).toBeVisible();
  const response = await page.request.get('/api/stats');
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('dashboard shows photos, answers, identity filters, search, rename, and full conversation detail', async ({ page }, testInfo) => {
  const mock = await mockStats(page);
  await page.goto('/stats');
  await expect(page.locator('.stats-event')).toHaveCount(3);
  await expect(page.getByText('ntfy įjungta', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({ path: `artifacts/stats/${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Nuotraukos', exact: true }).click();
  await expect(page.locator('.stats-event')).toHaveCount(1);
  await page.getByRole('button', { name: 'Visas įrašas' }).click();
  await expect(page.getByRole('dialog')).toContainText('Asistentas → Dovydas');
  await expect(page.getByRole('dialog').getByAltText('Trattoria-meniu.jpg')).toBeVisible();
  await expect(page.getByRole('dialog').locator('strong', { hasText: '12 eurų' })).toBeVisible();
  await page.getByRole('button', { name: 'Visi šio pokalbio klausimai' }).click();
  await expect(page.getByRole('heading', { name: 'Pasirinkto pokalbio istorija' })).toBeVisible();
  await expect.poll(() => mock.calls.some(call => call.query.get('conversation') === 'photo-conversation')).toBe(true);
  await page.getByRole('button', { name: 'Išvalyti filtrus' }).click();
  await page.getByRole('combobox', { name: 'Keliautojas', exact: true }).selectOption(other);
  await expect(page.locator('.stats-event')).toHaveCount(1);
  await page.getByRole('button', { name: 'Keisti vardą', exact: true }).click();
  await page.getByLabel('Vardas', { exact: true }).fill('Rūta ir Tomas');
  await page.getByRole('button', { name: 'Išsaugoti vardą' }).click();
  await expect(page.locator('.stats-event-person')).toHaveText('Rūta ir Tomas');
  expect(mock.calls.some(call => call.path.endsWith(other) && call.body?.name === 'Rūta ir Tomas')).toBe(true);
  await page.getByRole('button', { name: 'Išvalyti filtrus' }).click();
  await page.getByLabel('Ieškoti istorijoje').fill('espresso');
  await expect(page.locator('.stats-event')).toHaveCount(1);
  await expect(page.locator('.stats-event')).toContainText('Florencijoje');
  await page.getByLabel('Ieškoti istorijoje').fill('niekonerasta');
  await expect(page.getByRole('heading', { name: 'Tokių įrašų nėra' })).toBeVisible();
});

test('ntfy deep links open ordered live captions and expired authentication clears private content', async ({ page }) => {
  const mock = await mockStats(page);
  await page.goto(`/stats?event=${events[2].id}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Ar galime čia statyti?', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Possiamo parcheggiare qui?', { exact: true })).toBeVisible();
  await expect(page.locator('.stats-transcript')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Uždaryti', exact: true }).click();
  mock.expire();
  await page.getByRole('button', { name: 'Atnaujinti', exact: true }).click();
  await expect(page.getByLabel('Administratoriaus slaptažodis')).toBeVisible();
  await expect(page.locator('.stats-event')).toHaveCount(0);
  await expect(page.getByText('Trattoria-meniu.jpg')).toHaveCount(0);
});

test('empty history explains when entries appear and login remains accessible', async ({ page }) => {
  await mockStats(page, true);
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: 'Kelionės istorija prasideda čia' })).toBeVisible();
  await page.getByRole('button', { name: 'Atsijungti' }).click();
  await expect(page.getByLabel('Administratoriaus slaptažodis')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('an in-flight history refresh cannot restore private content after logout', async ({ page }) => {
  const mock = await mockStats(page);
  await page.goto('/stats');
  await expect(page.locator('.stats-event')).toHaveCount(3);
  // Let the ready-state authentication check finish before delaying a refresh.
  await expect.poll(() => mock.calls.filter(call => call.path === '/api/stats').length).toBeGreaterThanOrEqual(2);
  mock.hold();
  await page.getByRole('button', { name: 'Atnaujinti', exact: true }).click();
  await expect.poll(mock.waiting).toBe(true);
  await page.getByRole('button', { name: 'Atsijungti', exact: true }).click();
  await expect(page.getByLabel('Administratoriaus slaptažodis')).toBeVisible();
  mock.release();
  await expect(page.locator('.stats-event')).toHaveCount(0);
  await expect(page.getByLabel('Administratoriaus slaptažodis')).toBeVisible();
});

test('ending a live call flushes the original and Italian captions with their owning session', async ({ page }) => {
  await mockLive(page);
  const batches: any[] = [];
  await page.route('**/api/live/fragments', async route => { batches.push(route.request().postDataJSON()); await route.fulfill({ status: 204 }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
  await expect(page.getByText('Galite kalbėti', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const peer = (window as any).fakePeer;
    peer.channel.emit({ type: 'session.input_transcript.delta', event_id: 'user-caption', delta: 'Labas rytas', start_ms: 0, end_ms: 600 });
    peer.channel.emit({ type: 'session.output_transcript.delta', event_id: 'assistant-caption', delta: 'Buongiorno', start_ms: 500, end_ms: 900 });
  });
  await page.getByRole('button', { name: 'Baigti pokalbį', exact: true }).click();
  await expect.poll(() => batches.length).toBeGreaterThan(0);
  const fragments = batches.flatMap(batch => batch.fragments);
  expect(fragments.some(fragment => fragment.role === 'user' && fragment.text === 'Labas rytas')).toBe(true);
  expect(fragments.some(fragment => fragment.role === 'assistant' && fragment.text === 'Buongiorno')).toBe(true);
  expect(batches.every(batch => batch.fragments.every((fragment: any) => fragment.session === batch.sessionId))).toBe(true);
});
