import { defineConfig, devices } from '@playwright/test';

const cloudflare = process.env.E2E_TARGET === 'cloudflare';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 3,
  timeout: 30_000,
  expect: { timeout: 8000 },
  use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 }, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } },
    { name: 'android', use: { ...devices['Pixel 7'], launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } },
    { name: 'iphone', use: { ...devices['iPhone 13'], launchOptions: { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE } } },
  ],
  webServer: {
    command: cloudflare ? 'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx wrangler dev --port 4173 --var OPENAI_API_KEY:browser-test-placeholder --var TRIP_ACCESS_TOKEN: --show-interactive-dev-session=false' : 'PORT=4173 npm start',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: !cloudflare && !process.env.CI,
    timeout: 30_000,
  },
});
