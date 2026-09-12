import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockLive } from './fixtures/live';

async function connected(page: Page) {
  await page.evaluate(() => (window as any).fakePeer.channel.emit({ type: 'session.started' }));
  await expect(page.getByRole('heading', { name: 'Galite kalbėti', exact: true })).toBeVisible();
}

test('readiness waits for the session, the mobile wave responds to sound, and reconnecting clears it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await mockLive(page, { autoStart: false, meter: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fakePeer?.connectionState)).toBe('connected');
  // WebRTC connected alone is not enough: the translator must confirm readiness.
  await expect(page.getByRole('heading', { name: 'Jungiamės…', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.live-orb .spin')).toBeVisible();
  await expect(page.getByText('Prisijungta', { exact: true })).not.toBeVisible();
  await expect(page.locator('.sound-wave')).not.toBeVisible();
  await connected(page);
  await expect(page.getByText('Prisijungta', { exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.connection-label svg')).toBeVisible();
  await expect(page.getByText('Klausomės', { exact: true })).toBeVisible();
  await expect(page.locator('.sound-wave')).toBeInViewport({ ratio: 1 });
  const transforms = () => page.locator('.sound-wave i').evaluateAll(bars => bars.map(bar => getComputedStyle(bar).transform).join(','));
  const first = await transforms();
  await expect.poll(transforms).not.toBe(first);
  const peak = () => page.locator('.sound-wave i').evaluateAll(bars => Math.max(...bars.map(bar => bar.getBoundingClientRect().height)));
  await expect.poll(peak).toBeLessThanOrEqual(15);
  await page.evaluate(() => { (window as any).microphoneLevel = 0.2; });
  await expect.poll(peak).toBeGreaterThan(25);
  await page.evaluate(() => { (window as any).microphoneLevel = 0; });
  await expect.poll(peak).toBeLessThanOrEqual(15);
  await page.evaluate(() => { const peer = (window as any).fakePeer; peer.connectionState = 'failed'; peer.onconnectionstatechange(); });
  await expect(page.getByRole('heading', { name: 'Atkuriame ryšį…', exact: true })).toBeVisible();
  await expect(page.getByText('Prisijungta', { exact: true })).not.toBeVisible();
  await expect(page.locator('.sound-wave')).not.toBeVisible();
  await page.getByRole('button', { name: 'Baigti pokalbį', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ačiū už pokalbį.', exact: true })).toBeVisible();
});

test('paused and ended microphone states do not show a listening animation', async ({ page }) => {
  await mockLive(page, { meter: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Galite kalbėti', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).fakePeer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Il conto, per favore.', start_ms: 0, end_ms: 500 }));
  await page.getByRole('button', { name: 'Parodyti žmogui', exact: true }).click();
  await expect(page.locator('.live-stage h2')).toHaveText('Mikrofonas pristabdytas');
  await expect(page.locator('.sound-wave')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).captureStreams[0].getTracks()[0].enabled)).toBe(false);
  await page.getByRole('button', { name: 'Grįžti', exact: true }).click();
  await expect(page.locator('.sound-wave')).toBeVisible();
  await page.getByRole('button', { name: 'Baigti pokalbį', exact: true }).click();
  await expect(page.locator('.sound-wave')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).captureStreams[0].getTracks()[0].readyState)).toBe('ended');
});

test('reduced motion keeps explicit readiness and a readable sound indicator', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockLive(page, { meter: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Galite kalbėti', exact: true })).toBeVisible();
  const animations = await page.locator('.sound-wave i, .live-orb').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName));
  expect(animations.every(name => name === 'none')).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
});
