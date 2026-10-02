import { test as base, expect } from '@playwright/test';
import { createApp } from '../../mock-api/server.js';
import { reconcile } from '../../src/reconcile/run.js';
import { ApiClient } from '../clients/api-client.js';
import { LoginPage } from '../pages/login-page.js';
import { CatalogPage } from '../pages/catalog-page.js';
import { CheckoutPage } from '../pages/checkout-page.js';

export const test = base.extend({
  reconciliation: [
    async ({}, use) => {
      // Fixed clock so date rules are deterministic.
      await use(reconcile({ now: new Date('2026-10-01T12:00:00Z') }));
    },
    { scope: 'worker' },
  ],

  syncApi: [
    async ({}, use) => {
      const server = createApp();
      await new Promise((resolve) => server.listen(0, resolve));
      const { port } = server.address();
      await use({ baseUrl: `http://localhost:${port}` });
      await new Promise((resolve) => server.close(resolve));
    },
    { scope: 'worker' },
  ],

  api: async ({ syncApi, request }, use) => {
    await use(new ApiClient(request, syncApi.baseUrl));
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  catalogPage: async ({ page }, use) => {
    await use(new CatalogPage(page));
  },

  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },

  // Attaches a named full-page screenshot to the report.
  evidence: async ({ page }, use, testInfo) => {
    await use({
      capture: async (label) => {
        await testInfo.attach(label, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      },
    });
  },
});

export { expect };
