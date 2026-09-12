import { chromium, webkit, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mockLive } from '../tests/browser/fixtures/live';

// Run against the built app: node --import tsx scripts/capture-layout.ts iteration-1
// Every image deliberately captures only the viewport. No scrolling to reveal controls.
const phase = process.argv[2] || 'final';
const output = resolve('artifacts/mobile-ux', phase);
const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
await mkdir(output, { recursive: true });
const sizes = [[360, 800], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 900], [1440, 1080], [390, 640]];
const measurements: unknown[] = [];

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: 'disabled' });
  const geometry = await page.evaluate(() => {
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { text: el.textContent?.trim(), x: rect.x, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight, clientHeight: document.documentElement.clientHeight, visualHeight: visualViewport?.height, scrollY },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      actions: [...document.querySelectorAll('.action-card')].map(box),
      liveControls: [...document.querySelectorAll('.live-controls button')].map(box),
      text: [...document.querySelectorAll('.card-title, .card-subtitle, .card-description')].map(el => ({ ...box(el), fontSize: getComputedStyle(el).fontSize })),
    };
  });
  measurements.push({ name, ...geometry });
  console.log(`${name}: viewport ${geometry.viewport.height}, actions bottom ${Math.ceil(Math.max(0, ...geometry.actions.map(box => box.bottom)))}, controls bottom ${Math.ceil(Math.max(0, ...geometry.liveControls.map(box => box.bottom)))}`);
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  // Inspect all requested sizes in Chromium; confirm Safari at both phone extremes.
  for (const [width, height] of engine === chromium ? sizes : [[360, 800], [430, 932]]) {
    const name = `${engine.name()}-${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block' });
    const page = await context.newPage();
    // tsx's function-name helper must also exist in serialized browser callbacks.
    await page.addInitScript('window.__name = value => value;');
    await page.route('**/api/health', route => route.fulfill({ json: { ready: true } }));
    await mockLive(page);
    await page.goto(baseURL);
    await page.locator('.action-card').last().waitFor();
    await capture(page, `home-${name}`);
    if (width < 768) {
      await page.getByRole('button', { name: 'Kaip naudotis?', exact: true }).click();
      await capture(page, `help-${name}`);
      await page.getByRole('button', { name: 'Supratau', exact: true }).click();
      await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
      await page.getByRole('heading', { name: 'Galite kalbėti', exact: true }).waitFor();
      await capture(page, `live-ready-${name}`);
      await page.evaluate(() => {
        const peer = (window as any).fakePeer;
        peer.channel.emit({ type: 'session.input_transcript.delta', event_id: 'input_a', delta: 'Ar galime čia statyti?', start_ms: 0, end_ms: 800 });
        peer.channel.emit({ type: 'session.output_transcript.delta', event_id: 'output_a', delta: 'Possiamo parcheggiare qui?', start_ms: 300, end_ms: 1100 });
      });
      await page.getByText('Possiamo parcheggiare qui?', { exact: true }).waitFor();
      await capture(page, `live-transcript-${name}`);
      if (width === 390 && height === 844) {
        await page.setViewportSize({ width: 390, height: 640 });
        await capture(page, `live-resized-${engine.name()}-390x640`);
        await page.setViewportSize({ width, height });
      }
      if (width === 390) {
        await page.getByRole('button', { name: 'Parodyti žmogui', exact: true }).click();
        await capture(page, `live-fullscreen-${name}`);
        await page.getByRole('button', { name: 'Grįžti', exact: true }).click();
        await page.evaluate(() => { const peer = (window as any).fakePeer; peer.connectionState = 'failed'; peer.onconnectionstatechange(); });
        await page.getByRole('heading', { name: 'Atkuriame ryšį…', exact: true }).waitFor();
        await capture(page, `live-reconnecting-${name}`);
        await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
        await page.getByRole('button', { name: 'Išversti nuotrauką', exact: true }).click();
        await capture(page, `photo-${name}`);
        await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
        await page.getByRole('button', { name: 'Paklausti apie Italiją', exact: true }).click();
        await capture(page, `assistant-${name}`);
      }
    }
    await context.close();
  }
  await browser.close();
}
await writeFile(`${output}/geometry.json`, JSON.stringify(measurements, null, 2) + '\n');
