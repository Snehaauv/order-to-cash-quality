import { defineConfig, devices } from '@playwright/test';

/**
 * Three projects, one report.
 *
 * Splitting by layer rather than by browser is the decision worth defending here. The data and api
 * projects need no browser at all, so giving them one would cost startup time per worker for
 * nothing. Keeping them as Playwright projects rather than separate scripts means a reviewer runs
 * `npx playwright test` once and gets UI, API and data results in a single HTML report - which is
 * the thing an integration suite is supposed to give you.
 *
 * The ui project is the only one that is allowed to retry. A data rule is pure computation over
 * fixed input: if it fails, retrying it is dishonest, because it will fail identically and the
 * retry only hides how reproducible the failure was. UI against a public demo site is subject to
 * real network flake, so one retry there is reasonable.
 */
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
        ...devices['Desktop Chrome'],
        baseURL: process.env.UI_BASE_URL ?? 'https://www.saucedemo.com',
        video: 'retain-on-failure',
      },
    },
  ],
});
