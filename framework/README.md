# Playwright Framework

Three layers — UI, API, data — under one runner, producing one report.

```bash
npm install
npx playwright install chromium      # see "if the download is blocked" below
npm test                             # all three layers
npm run test:data                    # data only, no browser
npm run test:api                     # api only, no browser
npm run test:ui                      # ui only, needs a browser
npx playwright show-report
```

Current state: **48 tests, all passing.** 21 data, 20 API, 7 UI.

## Layout

```
framework/
  fixtures/index.js      custom fixtures - the extension point
  pages/                 page objects for the UI slice
  clients/api-client.js  HTTP client for the sync/ingest API
tests/
  data/                  reconciliation rules as Playwright tests
  api/                   contract, schema, status, negative paths
  ui/                    order lifecycle against a public demo app
mock-api/server.js       stand-in sync/ingest service, zero dependencies
src/                     the reconciliation engine the data tests exercise
```

The split is by **layer, not by browser**. Data and API tests need no browser at all, so giving
them one costs worker startup time for nothing.

## Design decisions worth defending

**Projects by layer, one report.** A reviewer runs one command and sees UI, API and data results
together. An integration suite whose layers report separately makes you correlate a test report with
a CLI log to answer "is the integration healthy", which is the question the suite exists to answer.

**Only the UI project retries.** A data rule is pure computation over fixed input: if it fails,
retrying is dishonest, because it will fail identically and the retry only hides how reproducible
the failure was. UI against a public demo site is subject to genuine network flake, so one retry
there is justified. Retries configured uniformly are how a flaky suite becomes a trusted one by
accident.

**`reconciliation` is worker-scoped.** Parsing both CSVs and running nineteen rules per test would
dominate the runtime of a suite that is otherwise pure computation. One run per worker, shared
read-only.

**The clock is injected, never read from the system.** `reconcile({ now: ... })`. The
future-timestamp rule would otherwise change behaviour with the calendar — a test that passes today
and fails in 2031 is not a test.

**The mock API boots on an ephemeral port inside a fixture.** Not an externally started server.
Tests that need a manually launched process are the first thing to break in CI, and port 3000 is
never free on a developer machine.

**Page objects are injected as fixtures.** A test body should name what it verifies. `new
LoginPage(page)` repeated in every test is noise that also makes it easy to skip a setup step.

**Data tests are generated from the rule inventory.** Adding a rule to `src/rules/` automatically
adds a test. It is therefore impossible to write a rule and forget to assert on it — the usual way a
check ends up in a suite without ever being exercised.

## Why SauceDemo

Its cart → checkout → complete flow *is* the Cart → Confirmed transition from the lifecycle under
test, so the UI layer tells the same story as the data layer instead of being an unrelated demo. It
also has stable `data-test` attributes, which are the only selectors on that app not coupled to
layout or copy.

Override with `UI_BASE_URL` if you want to point the suite elsewhere.

## What the API tests weight toward

Negative paths, deliberately. A happy-path ingest test tells you the endpoint works; the rejection
tests tell you it defends the contract. Every defect in `DEFECT_REPORT.md` is data an ingest endpoint
should have refused at the door — had ingest rejected the EUR-as-USD event, there would be nothing
to reconcile afterwards.

The mock enforces the same invariants the reconciler checks after the fact. An ingest endpoint that
accepts data its own reconciliation will later reject is the bug this whole exercise is about.

## If the browser download is blocked

Corporate networks often block the Playwright CDN. Two ways out:

```bash
# 1. Use a locally installed Chrome instead of the bundled chromium
UI_BASE_URL=https://www.saucedemo.com npx playwright test --project=ui --browser=chromium

# 2. Pin @playwright/test to a version whose browser build is already present
ls ~/AppData/Local/ms-playwright/        # or ~/.cache/ms-playwright on Linux/macOS
```

This repo is pinned to **1.60.0** because that is the release matching the chromium build already on
the machine it was built on. The data and API projects need no browser and run regardless.

## Known gaps

- **No visual or accessibility testing.** Real concerns, but neither can tell you whether the sync is
  faithful, which is what this exercise is about.
- **The UI slice does not create data the data layer then reconciles.** SauceDemo has no API to read
  the resulting order from, so the two layers share a domain model but not a data path. With a real
  OMS I would place an order through the UI, then assert its events arrive in Analytics — that is the
  test this framework is shaped to grow into.
- **Idempotency is specified in `STRATEGY.md` (A-05) but not implemented in the mock.** The mock has
  no persistence across requests beyond an in-memory array, so a genuine duplicate-rejection test
  would be testing the mock rather than a contract. Called out rather than faked.
