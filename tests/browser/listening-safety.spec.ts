import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockLive } from './fixtures/live';

async function prepare(page: Page, hash = '') {
  await page.clock.install({ time: new Date('2026-09-12T09:00:00Z') });
  const connections = await mockLive(page);
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, configured: true } }));
  await page.goto(`/${hash}`);
  await expect(page.locator('main h1')).toBeVisible();
  await page.clock.pauseAt(new Date('2026-09-12T09:01:00Z'));
  return connections;
}

async function startCall(page: Page, resume = false) {
  await page.getByRole('button', { name: resume ? 'Tęsti pokalbį' : 'Kalbėtis', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fakePeer?.connectionState)).toBe('connected');
  await page.clock.runFor(50);
  await expect(page.getByRole('heading', { name: 'Galite kalbėti', exact: true })).toBeVisible();
}

async function say(page: Page, text = 'Sąskaitą, prašau.') {
  await page.evaluate(text => {
    (window as any).fakePeer.channel.emit({ type: 'session.input_transcript.delta', event_id: crypto.randomUUID(), delta: text, start_ms: 0, end_ms: 1000 });
  }, text);
}

async function hidden(page: Page, value = true) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'hidden' : 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

async function expectMicOff(page: Page) {
  expect(await page.evaluate(() => (window as any).captureStreams.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).captureStreams.every((stream: MediaStream) => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
}

test('silence warns for twenty seconds, then stops capture and server session while keeping context', async ({ page }) => {
  const connections = await prepare(page);
  const ended: string[] = [];
  // WebKit does not expose a Blob beacon's body through request interception.
  // The keepalive fallback test below separately verifies the exact session ID.
  await page.route('**/api/live/end', route => { ended.push(route.request().method()); return route.fulfill({ status: 204 }); });
  await startCall(page);
  await say(page);
  await page.clock.fastForward(100_000);
  const warning = page.getByRole('dialog', { name: 'Ar dar kalbatės?' });
  await expect(warning).toBeVisible();
  await expect(warning.locator('strong')).toHaveText('20 s');
  await expect(warning.getByRole('button', { name: 'Tęsti pokalbį', exact: true })).toBeFocused();
  await page.clock.fastForward(19_000);
  await expect(warning.locator('strong')).toHaveText('1 s');
  expect(await page.evaluate(() => (window as any).captureStreams[0].getTracks()[0].readyState)).toBe('live');
  await page.clock.fastForward(1000);
  await expect(warning).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mikrofonas išjungtas' })).toBeVisible();
  await expectMicOff(page);
  expect(await page.evaluate(() => (window as any).fakePeer.connectionState)).toBe('closed');
  await expect.poll(() => ended).toContain('POST');
  await startCall(page, true);
  expect(connections[1].history).toEqual([{ role: 'user', text: 'Sąskaitą, prašau.' }]);
});

test('an explicit continue tap renews the silence deadline without creating another session', async ({ page }) => {
  const connections = await prepare(page);
  await startCall(page);
  await page.clock.fastForward(101_000);
  await page.getByRole('dialog').getByRole('button', { name: 'Tęsti pokalbį', exact: true }).click();
  await page.clock.fastForward(99_000);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Galite kalbėti', exact: true })).toBeVisible();
  expect(connections).toHaveLength(1);
  await page.clock.fastForward(21_000);
  await expectMicOff(page);
});

test('speech clears a silence warning, but empty captions cannot renew listening', async ({ page }) => {
  await prepare(page);
  await startCall(page);
  await page.clock.fastForward(101_000);
  await expect(page.getByRole('dialog')).toBeVisible();
  await say(page);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.clock.fastForward(99_000);
  await say(page, ' \n ');
  await page.clock.fastForward(21_000);
  await expectMicOff(page);
});

for (const confirm of [false, true]) {
  test(`nearby voices cannot bypass the ten-minute confirmation (${confirm ? 'continue' : 'expire'})`, async ({ page }) => {
    const connections = await prepare(page);
    await startCall(page);
    for (let i = 0; i < 7; i++) { await page.clock.fastForward(80_000); await say(page); }
    await page.clock.fastForward(21_000);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Pokalbis trunka beveik 10 minučių.');
    await say(page);
    await expect(dialog).toBeVisible();
    if (confirm) await dialog.getByRole('button', { name: 'Tęsti pokalbį', exact: true }).click();
    await page.clock.fastForward(20_000);
    if (confirm) {
      await expect(page.getByRole('heading', { name: 'Galite kalbėti', exact: true })).toBeVisible();
      expect(connections).toHaveLength(1);
    } else {
      await expect(page.getByRole('heading', { name: 'Mikrofonas išjungtas' })).toBeVisible();
      await expect(page.getByText(/Praėjo 10 minučių/)).toBeVisible();
      await expectMicOff(page);
    }
  });
}

for (const event of ['visibilitychange', 'pagehide']) {
  test(`${event} stops immediately and returning online cannot reopen the microphone`, async ({ page }) => {
    const connections = await prepare(page);
    await startCall(page);
    // Also exercise the fallback when the browser's beacon queue is full.
    await page.evaluate(() => { navigator.sendBeacon = () => false; });
    const ended = page.waitForRequest('**/api/live/end');
    if (event === 'visibilitychange') await hidden(page);
    else await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expectMicOff(page);
    expect((await ended).postDataJSON().sessionId).toBe('live_1');
    await hidden(page, false);
    await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('trip:online')); });
    await page.clock.fastForward(30_000);
    await expect(page.getByRole('heading', { name: 'Mikrofonas išjungtas' })).toBeVisible();
    expect(connections).toHaveLength(1);
    await startCall(page, true);
    expect(connections).toHaveLength(2);
  });
}

test('network reconnection keeps the original inactivity deadline', async ({ page }) => {
  const connections = await prepare(page);
  await startCall(page);
  await page.clock.fastForward(105_000);
  await page.evaluate(() => { const peer = (window as any).fakePeer; peer.connectionState = 'failed'; peer.onconnectionstatechange(); });
  await page.clock.runFor(2100);
  await expect.poll(() => connections.length).toBe(2);
  await page.clock.runFor(50);
  await page.clock.fastForward(13_000);
  await expect(page.getByRole('heading', { name: 'Mikrofonas išjungtas' })).toBeVisible();
  await expectMicOff(page);
  await page.clock.fastForward(60_000);
  expect(connections).toHaveLength(2);
});

for (const mode of ['live', 'assistant']) {
  test(`${mode}: a microphone permission granted after hiding the page never starts capture`, async ({ page }) => {
    const connections = await prepare(page, mode === 'assistant' ? '#assistant' : '');
    await page.evaluate(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { (window as any).releaseMicrophone = async () => resolve(await original({ audio: true })); });
    });
    await page.getByRole('button', { name: mode === 'live' ? 'Kalbėtis' : 'Kalbėti', exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseMicrophone)).toBe('function');
    await hidden(page);
    await hidden(page, false);
    await page.evaluate(() => (window as any).releaseMicrophone());
    await expectMicOff(page);
    expect(connections).toHaveLength(0);
  });
}

test('dictation releases capture on the sixty-second limit and when the page is hidden', async ({ page }) => {
  await prepare(page, '#assistant');
  await page.route('**/api/transcribe', route => route.fulfill({ json: { text: 'Kur yra stotis?' } }));
  await page.evaluate(() => {
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = 'inactive'; mimeType = 'audio/webm'; ondataavailable: any; onstop: any;
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['a'.repeat(300)]) }); queueMicrotask(() => this.onstop?.()); }
    }
    window.MediaRecorder = FakeRecorder as any;
  });
  await page.getByRole('button', { name: 'Kalbėti', exact: true }).click();
  await expect(page.getByText(/Klausomės…/)).toBeVisible();
  await page.clock.fastForward(61_000);
  await expectMicOff(page);
  await expect(page.getByLabel('Jūsų klausimas')).toHaveValue('Kur yra stotis?');
  await page.getByRole('button', { name: 'Kalbėti', exact: true }).click();
  await expect(page.getByText(/Klausomės…/)).toBeVisible();
  await hidden(page);
  await expectMicOff(page);
  await hidden(page, false);
  await expect(page.getByLabel('Jūsų klausimas')).toHaveValue('Kur yra stotis? Kur yra stotis?');
});

test('warning has accessible colors, large buttons and fits the reduced mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await prepare(page);
  await startCall(page);
  await page.clock.fastForward(101_000);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeInViewport({ ratio: 1 });
  for (const button of await dialog.getByRole('button').all()) {
    await expect(button).toBeInViewport({ ratio: 1 });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  }
  // Axe schedules its own browser timers, which must run during its audit.
  await page.clock.resume();
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Baigti pokalbį', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expectMicOff(page);
});

test('after an automatic stop the latest translation remains above the phone controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await prepare(page);
  await startCall(page);
  await say(page);
  await page.evaluate(() => (window as any).fakePeer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Il conto, per favore.', start_ms: 300, end_ms: 1400 }));
  await page.clock.fastForward(120_000);
  await expect(page.getByRole('heading', { name: 'Mikrofonas išjungtas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tęsti pokalbį', exact: true })).toBeInViewport({ ratio: 1 });
  await expect.poll(async () => {
    const translation = (await page.locator('.caption.assistant p').boundingBox())!;
    const controls = (await page.locator('.live-controls').boundingBox())!;
    return translation.y + translation.height <= controls.y;
  }).toBe(true);
});
