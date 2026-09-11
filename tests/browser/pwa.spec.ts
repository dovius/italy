import { test, expect } from '@playwright/test';
import express from 'express';
import { resolve } from 'node:path';
import { once } from 'node:events';
test.use({ serviceWorkers: 'allow' });

test('production shell and local draft open without a network connection', async ({ page }) => {
  // Shut down a real server instead of WebKit's offline emulation, which also
  // rejects service-worker-handled navigations with an internal browser error.
  const app = express();
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use(express.static(resolve('dist')));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Kaip galime padėti?' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: /Paklausti/ }).click();
  await page.getByLabel('Jūsų klausimas').fill('Mano išsaugotas klausimas');
  await page.waitForTimeout(350);
  await page.reload();
  await expect(page.getByLabel('Jūsų klausimas')).toHaveValue('Mano išsaugotas klausimas');
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await page.reload();
  await expect(page.getByLabel('Jūsų klausimas')).toHaveValue('Mano išsaugotas klausimas');
  await expect(page.locator('.offline-banner')).toBeVisible();
  const cached = await page.evaluate(async () => { const names = await caches.keys(); return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)))).flat(); });
  expect(cached.some((url) => url.includes('/api/'))).toBe(false);
  } finally { if (server.listening) { server.closeAllConnections(); server.close(); } }
});
