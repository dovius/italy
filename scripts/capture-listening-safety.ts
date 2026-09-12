import { chromium, webkit, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mockLive } from '../tests/browser/fixtures/live';

// Run against a built local app. All screenshots capture the visible viewport only.
const phase = process.argv[2] || 'final';
const output = resolve('artifacts/listening-safety', phase);
const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8787';
const measurements: unknown[] = [];
await mkdir(output, { recursive: true });

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false, animations: 'disabled' });
  const geometry = await page.evaluate(() => {
    const rect = (el: Element) => {
      const box = el.getBoundingClientRect();
      return { text: el.textContent?.trim(), top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight, clientHeight: document.documentElement.clientHeight, visualHeight: visualViewport?.height, scrollY },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      actions: [...document.querySelectorAll('.action-card, .listening-actions button, .live-stage > button')].map(rect),
      dialog: [...document.querySelectorAll('dialog[open]')].map(rect),
    };
  });
  measurements.push({ name, ...geometry });
  console.log(`${name}: viewport ${geometry.viewport.height}; action bottom ${Math.ceil(Math.max(0, ...geometry.actions.map(box => box.bottom)))}`);
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const sizes = engine === chromium ? [[360, 800], [375, 812], [390, 844], [430, 932], [390, 640], [768, 1024], [1024, 900], [1440, 1080]] : [[360, 800], [430, 932]];
  for (const [width, height] of sizes) {
    const name = `${engine.name()}-${width}x${height}`;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript('window.__name = value => value;');
    await page.clock.install({ time: new Date('2026-09-12T09:00:00Z') });
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, configured: true } }));
    await mockLive(page);
    await page.goto(baseURL);
    await page.locator('.action-card').last().waitFor();
    await page.clock.pauseAt(new Date('2026-09-12T09:01:00Z'));
    await capture(page, `home-${name}`);
    await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).fakePeer?.connectionState)).toBe('connected');
    await page.clock.runFor(100);
    await page.getByRole('heading', { name: 'Galite kalbėti', exact: true }).waitFor();
    await page.evaluate(() => {
      (window as any).fakePeer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Sąskaitą, prašau.', start_ms: 0, end_ms: 1000 });
      (window as any).fakePeer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Il conto, per favore.', start_ms: 300, end_ms: 1400 });
    });
    await page.clock.fastForward(100_000);
    await page.getByRole('dialog', { name: 'Ar dar kalbatės?' }).waitFor();
    await capture(page, `warning-${name}`);
    await page.clock.fastForward(20_000);
    await page.getByRole('heading', { name: 'Mikrofonas išjungtas', exact: true }).waitFor();
    await capture(page, `stopped-${name}`);
    await context.close();
  }
  await browser.close();
}
await writeFile(`${output}/geometry.json`, JSON.stringify(measurements, null, 2) + '\n');
