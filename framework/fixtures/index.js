import { test as base, expect } from '@playwright/test';
import { createApp } from '../../mock-api/server.js';
import { reconcile } from '../../src/reconcile/run.js';
import { ApiClient } from '../clients/api-client.js';
import { LoginPage } from '../pages/login-page.js';
import { CatalogPage } from '../pages/catalog-page.js';
import { CheckoutPage } from '../pages/checkout-page.js';

/**
 * Custom fixtures are where this framework earns its keep.
 *
 * Three decisions worth defending:
 *
 * 1. `reconciliation` is worker-scoped. Parsing both CSVs and running nineteen rules per test would
 *    dominate the runtime of a data suite that is otherwise pure computation. One run per worker,
 *    shared read-only.
 *
 * 2. `syncApi` boots the mock on an ephemeral port per worker rather than expecting a server to
 *    already be running. Tests that depend on a manually started process are the first thing to
 *    break in CI, and port 3000 is never free on a developer machine.
 *
 * 3. Page objects are injected as fixtures, not constructed inside tests. A test should name what it
 *    is verifying; `new LoginPage(page)` in every test body is noise that also makes it easy to
 *    forget a required setup step.
 */

export const test = base.extend({
  reconciliation: [
    async ({}, use) => {
      // Clock pinned so the future-timestamp assertions are stable: a test that passes today and
      // fails in 2031 is not a test.
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
});

export { expect };
