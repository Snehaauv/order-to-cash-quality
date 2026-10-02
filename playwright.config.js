import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
  ],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'data',
      testDir: './tests/data',
      retries: 0,
      use: {},
    },
    {
      name: 'api',
      testDir: './tests/api',
      retries: 0,
      use: {},
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      retries: process.env.CI ? 1 : 0,
      use: {
        browserName: 'chromium',
        baseURL: process.env.UI_BASE_URL ?? 'https://www.saucedemo.com',
        video: 'retain-on-failure',
        // viewport must be null for --start-maximized to apply.
        viewport: null,
        launchOptions: { args: ['--start-maximized'] },
      },
    },
  ],
});
