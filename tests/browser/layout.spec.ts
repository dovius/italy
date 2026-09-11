import { test, expect } from '@playwright/test';
import { mockLive } from './fixtures/live';

for (const [width, height] of [[360, 800], [375, 812], [390, 844], [430, 932], [390, 640]]) {
  test(`all three choices fit the first ${width} × ${height} viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ką norite padaryti?' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => ({
      height: window.innerHeight,
      clientHeight: document.documentElement.clientHeight,
      visualHeight: window.visualViewport?.height,
      scrollY: window.scrollY,
      scrollWidth: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll('.action-card')].map(el => {
        const rect = el.getBoundingClientRect();
        const title = el.querySelector('.card-title')!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, titleFits: title.left >= rect.left && title.right <= rect.right && title.bottom <= rect.bottom };
      }),
    }));
    expect(geometry.height).toBe(height);
    expect(geometry.clientHeight).toBe(height);
    expect(geometry.visualHeight).toBe(height);
    expect(geometry.scrollY).toBe(0);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
    expect(geometry.cards).toHaveLength(3);
    for (const card of geometry.cards) {
      expect(card.top).toBeGreaterThanOrEqual(0);
      expect(card.bottom).toBeLessThanOrEqual(geometry.height);
      expect(card.width).toBeGreaterThanOrEqual(48);
      expect(card.height).toBeGreaterThanOrEqual(48);
      expect(card.titleFits).toBe(true);
    }
    for (const name of ['Kalbėtis', 'Išversti nuotrauką', 'Paklausti apie Italiją']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    // Help must also work without scrolling the homepage, and its dismissal must fit.
    await page.getByRole('button', { name: 'Kaip naudotis?', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Supratau', exact: true })).toBeInViewport({ ratio: 1 });
  });
}

test('empty card areas navigate and live controls survive browser height changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLive(page);
  await page.goto('/');
  for (const [name, hash] of [['Išversti nuotrauką', 'photo'], ['Paklausti apie Italiją', 'assistant']]) {
    const button = page.getByRole('button', { name, exact: true });
    const bounds = (await button.boundingBox())!;
    await button.click({ position: { x: bounds.width - 8, y: bounds.height - 8 } });
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Kalbėtis', exact: true }).locator('.card-icon').click();
  await expect(page.getByRole('heading', { name: 'KALBĖKITE', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const peer = (window as any).fakePeer;
    peer.channel.emit({ type: 'session.input_transcript.delta', event_id: 'input_a', delta: 'Ar galime čia statyti?', start_ms: 0, end_ms: 800 });
    peer.channel.emit({ type: 'session.output_transcript.delta', event_id: 'output_a', delta: 'Possiamo parcheggiare qui?', start_ms: 300, end_ms: 1100 });
  });
  await expect(page.getByText('Possiamo parcheggiare qui?', { exact: true })).toBeVisible();
  for (const height of [844, 640, 800]) {
    await page.setViewportSize({ width: 390, height });
    for (const name of ['Pakartoti', 'Parodyti žmogui', 'Baigti pokalbį']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    // In-viewport buttons alone are insufficient if the sticky group covers the answer.
    await expect.poll(async () => {
      const translation = (await page.locator('.caption.assistant p').boundingBox())!;
      const controls = (await page.locator('.live-controls').boundingBox())!;
      return translation.y + translation.height <= controls.y;
    }).toBe(true);
  }
  await page.getByRole('button', { name: 'Baigti pokalbį', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ačiū už pokalbį.', exact: true })).toBeVisible();
});

test('photo and assistant inputs fit a phone with browser controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/#photo');
  await expect(page.getByRole('button', { name: 'Fotografuoti', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Pasirinkti iš nuotraukų', exact: true })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
  await page.getByRole('button', { name: 'Paklausti apie Italiją', exact: true }).click();
  await expect(page.getByLabel('Jūsų klausimas')).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Kalbėti', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Siųsti', exact: true })).toBeInViewport({ ratio: 1 });
});
