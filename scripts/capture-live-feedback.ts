import { chromium, webkit, expect, type Page } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { mockLive } from '../tests/browser/fixtures/live';

const phase = process.argv[2] || 'final';
const output = resolve('artifacts/live-feedback', phase);
const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:8787';
const measurements: unknown[] = [];
await mkdir(output, { recursive: true });

async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: false });
  const geometry = await page.evaluate(() => {
    const rect = (el: Element) => {
      const box = el.getBoundingClientRect();
      return { text: el.textContent?.trim(), top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight, clientHeight: document.documentElement.clientHeight, visualHeight: visualViewport?.height, scrollY },
      documentWidth: document.documentElement.scrollWidth,
      controls: [...document.querySelectorAll('.action-card, .live-controls button')].map(rect),
      feedback: [...document.querySelectorAll('.connection-label, .live-stage h2, .live-listening')].map(rect),
      translation: [...document.querySelectorAll('.caption.assistant p')].map(rect),
    };
  });
  measurements.push({ name, ...geometry });
  console.log(`${name}: viewport ${geometry.viewport.height}, controls bottom ${Math.ceil(Math.max(0, ...geometry.controls.map(box => box.bottom)))}`);
}

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  const sizes = engine === chromium ? [[360, 800], [375, 812], [390, 844], [430, 932], [390, 640], [768, 1024], [1024, 900], [1440, 1080]] : [[360, 800], [430, 932], [390, 640]];
  for (const [width, height] of sizes) {
    const name = `${engine.name()}-${width}x${height}`;
    const record = phase === 'final' && engine === chromium && width === 390 && height === 844;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768, serviceWorkers: 'block', recordVideo: record ? { dir: output, size: { width, height } } : undefined });
    const page = await context.newPage();
    await page.addInitScript('window.__name = value => value;');
    await page.route('**/api/health', route => route.fulfill({ json: { ok: true, configured: true } }));
    await mockLive(page, { autoStart: false, meter: true });
    await page.goto(baseURL);
    await page.locator('.action-card').last().waitFor();
    await capture(page, `home-${name}`);
    await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).fakePeer?.connectionState)).toBe('connected');
    await capture(page, `connecting-${name}`);
    if (record) await page.waitForTimeout(1400);
    await page.evaluate(() => (window as any).fakePeer.channel.emit({ type: 'session.started' }));
    await page.getByRole('heading', { name: 'Galite kalbėti', exact: true }).waitFor();
    await capture(page, `listening-${name}`);
    if (record) await page.waitForTimeout(1400);
    await page.evaluate(() => { (window as any).microphoneLevel = 0.2; });
    await expect.poll(() => page.locator('.sound-wave i').evaluateAll(bars => Math.max(...bars.map(bar => parseFloat(getComputedStyle(bar).height))))).toBeGreaterThan(25);
    await capture(page, `voice-${name}`);
    if (record) {
      for (const level of [0.04, 0.18, 0.08, 0.15, 0.03, 0.2]) {
        await page.evaluate(level => { (window as any).microphoneLevel = level; }, level);
        await page.waitForTimeout(280);
      }
    }
    await page.evaluate(() => {
      (window as any).fakePeer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Ar galime čia statyti?', start_ms: 0, end_ms: 800 });
      (window as any).fakePeer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Possiamo parcheggiare qui?', start_ms: 300, end_ms: 1100 });
    });
    await page.getByText('Possiamo parcheggiare qui?', { exact: true }).waitFor();
    await capture(page, `transcript-${name}`);
    if (record) await page.waitForTimeout(1000);
    const video = page.video();
    await context.close();
    if (video) await rename(await video.path(), `${output}/demo-390x844.webm`);
  }
  await browser.close();
}
await writeFile(`${output}/geometry.json`, JSON.stringify(measurements, null, 2) + '\n');
