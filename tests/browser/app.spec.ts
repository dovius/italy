import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const answer = 'Galite pasakyti: **Il conto, per favore.** Tai reiškia „Sąskaitą, prašau“. ';
async function mockChat(page: Page) {
  const requests: Record<string, any>[] = [];
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ json: { text: body.mode === 'photo' ? 'Tai meniu. **Spagečiai su pesto kainuoja 12 eurų.** Aptarnavimo mokestis vienam žmogui – 2,50 euro.' : answer, sources: [] } });
  });
  return requests;
}
async function layout(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }

test('home has three generous actions, clear focus, no overflow, and accessible colors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ką norite padaryti?' })).toBeVisible();
  await layout(page);
  const cards = page.locator('.action-card');
  await expect(cards).toHaveCount(3);
  for (const button of await cards.all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(100);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole('button', { name: 'Kaip naudotis?' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Supratau', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('assistant preserves conversation and unsent draft across navigation and reload', async ({ page }) => {
  const requests = await mockChat(page);
  await page.goto('/#assistant');
  await page.getByRole('button', { name: 'Kaip paprašyti sąskaitos?' }).click();
  await expect(page.getByText('Il conto, per favore.', { exact: false })).toBeVisible();
  await page.getByLabel('Jūsų klausimas').fill('O kaip padėkoti?');
  await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
  await page.getByRole('button', { name: /Paklausti/ }).click();
  await expect(page.getByLabel('Jūsų klausimas')).toHaveValue('O kaip padėkoti?');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByLabel('Jūsų klausimas')).toHaveValue('O kaip padėkoti?');
  await page.getByRole('button', { name: 'Siųsti', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  expect(requests[1].messages).toHaveLength(3);
  await layout(page);
});
test('each tool has accessible text, labeled controls, and no horizontal scrolling', async ({ page }) => {
  for (const route of ['photo', 'assistant', 'live']) {
    await page.goto(`/#${route}`);
    await expect(page.locator('main h1')).toBeVisible();
    await page.getByRole('link', { name: 'Pereiti prie turinio' }).focus();
    await page.getByRole('link', { name: 'Pereiti prie turinio' }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${route}$`));
    await expect(page.locator('main')).toBeFocused();
    await layout(page);
    const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(report.violations, route).toEqual([]);
  }
});
test('photo translates, compresses, and retains image for follow-ups and reload', async ({ page }) => {
  const requests = await mockChat(page);
  await page.goto('/#photo');
  await page.getByLabel('Pasirinkti nuotraukos failą').setInputFiles('tests/fixtures/menu.svg');
  await expect(page.getByText('Spagečiai su pesto kainuoja 12 eurų.', { exact: false })).toBeVisible();
  expect(requests[0].image).toMatch(/^data:image\/jpeg;base64,/);
  await page.getByLabel('Klausimas apie nuotrauką').fill('Kiek kainuoja vanduo?');
  await page.getByRole('button', { name: 'Siųsti', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  expect(requests[1].image).toBe(requests[0].image);
  expect(requests[1].messages).toHaveLength(3);
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByAltText('Jūsų verčiama nuotrauka')).toBeVisible();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await layout(page);
});
test('offline question remains visible and automatically continues when connection returns', async ({ page, context }) => {
  const requests = await mockChat(page);
  await page.goto('/#assistant');
  await expect(page.getByLabel('Jūsų klausimas')).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Jūsų klausimas').fill('Kaip pasakyti ačiū?');
  await page.getByRole('button', { name: 'Siųsti', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Nėra interneto');
  await expect(page.locator('.message.user')).toContainText('Kaip pasakyti ačiū?');
  await context.setOffline(false);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  expect(requests).toHaveLength(1);
});
test('microphone denial has an actionable Lithuanian error and a working exit', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Kalbėtis', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('leiskite naudoti mikrofoną');
  await expect(page.getByRole('button', { name: 'Pradėti pokalbį', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Į pradžią', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ką norite padaryti?' })).toBeVisible();
});
test('missing provider setup is friendly and does not delete the question', async ({ page }) => {
  await page.route('**/api/chat', (route) => route.fulfill({ status: 503, json: { code: 'not_configured', error: 'Vertėjas dar neparuoštas. Paprašykite kelionės organizatoriaus jį įjungti.' } }));
  await page.goto('/#assistant');
  await page.getByLabel('Jūsų klausimas').fill('Kur yra stotis?');
  await page.getByRole('button', { name: 'Siųsti', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Vertėjas dar neparuoštas');
  await expect(page.locator('.message.user')).toContainText('Kur yra stotis?');
  await expect(page.getByRole('button', { name: /Pabandyti dar kartą/ })).toBeVisible();
});
