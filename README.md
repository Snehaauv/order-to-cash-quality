# Order-to-Cash Quality — OMS ↔ Analytics

Validation of a sync pipeline that pushes order lifecycles from an Order Management System into an
Analytics event log. Three layers of testing, a declarative reconciliation engine, and an
LLM-assisted rule compiler with a verification gate.

## Two-minute orientation

```bash
npm install
npm run reconcile        # the core: find every place Analytics disagrees with the OMS
npm run mutation         # prove the detector still detects - 12 injected defects, 12 caught
npm test                 # 49 tests across data, API and UI
npm run ai:compile       # LLM proposes rules; the gate accepts 2, rejects 2, quarantines 1
```

No API key needed for any of the above. `npm run reconcile` and `npm run mutation` have **zero
dependencies** and run on a clean clone before `npm install` finishes.

## Headline results

| | |
|---|---|
| **11 orders with defects** (13 findings) out of 20 | `DEFECT_REPORT.md` |
| **0 false positives** on the 5 cases the contract calls correct | `tests/data/reconciliation.spec.js` |
| **20 rules** across 6 dimensions, 0 errored | `src/rules/` |
| **13/13 mutations killed** | `npm run mutation` |
| **49/49 tests passing** — 24 data, 18 API, 7 UI | `npm test` |
| **2 of 5 LLM-proposed rules accepted**, 2 rejected, 1 quarantined | `ai/generated-rules.json` |

## What's where

| Deliverable | Location |
|---|---|
| **Part A** — test strategy, 29 prioritised scenarios, risk model | [`STRATEGY.md`](STRATEGY.md) |
| **Part B** — Playwright framework | [`framework/README.md`](framework/README.md), `tests/`, `playwright.config.js` |
| **Part C** — reconciliation engine + defect report | `src/`, [`DEFECT_REPORT.md`](DEFECT_REPORT.md) |
| **Part D** — performance plan + k6 stub | [`PERFORMANCE.md`](PERFORMANCE.md), `perf/ingest.js` |
| **Part E1** — AI work log | [`AI_WORKLOG.md`](AI_WORKLOG.md) |
| **Part E2** — AI artifact | [`ai/README.md`](ai/README.md) |

## The three ideas this submission rests on

### 1. The contract is data, not code

Every rule is a declaration — what it checks, which contract clause it enforces, what it iterates
over, how severe a breach is. A small executor owns iteration and error containment; a rule owns
only its predicate.

Adding a defect class is five lines in `src/rules/`, not a new branch in a growing function. That
answers the brief's ask to *"show the method that would catch the ones you didn't think of"*, and it
gives the LLM in `ai/` a fixed schema to emit against instead of free-form code.

Each rule is **named after the defect it detects** — `MISSING-ORDER`, `WRONG-CURRENCY`,
`FUTURE-DATE` — the way linters such as ESLint name rules (`no-unused-vars`). A finding then reads
without a lookup table: `WRONG-CURRENCY on ORD-1008` says everything.

A rule that throws is reported as **errored**, never as passed — a suite that goes green because a
check crashed is worse than no suite.

### 2. Conformance by replay, not by special cases

The lifecycle is declared once as an expected activity trace per terminal status
(`src/domain/lifecycle.js`). Each case's observed trace, ordered by timestamp, is diffed against it.

Missing steps, duplicates, out-of-order steps and invalid branches all fall out of **one algorithm**.
The alternative — a hand-written check per defect shape — grows a branch per incident and misses
every shape nobody thought of.

### 3. Diagnosis, not just detection

Two examples from the real findings:

**ORD-1009** — the Delivered event is 5 h 30 m after the OMS delivery time. That delta is classified
against a table of real UTC offsets, lands on Asia/Kolkata, and the finding says so: a local
wall-clock time was written into a field declared UTC. Not "two timestamps differ, please
investigate".

**ORD-1010** — the Delivered event sits at 08-20, but the OMS records delivery at 08-24T12:00, which
is *exactly* the Shipped event's timestamp. The finding states that the two activities appear to have
been transposed during sync. One line for a developer to fix instead of a half-day investigation.

## Avoiding false positives

Five cases in this dataset look like defects and are not. Reporting any of them would undermine the
other eleven findings:

| Case | Looks like | Actually |
|---|---|---|
| ORD-1015 | Name mismatch — `"VanArsdel  "` vs `"vanarsdel"` | Contract says compare trimmed and case-insensitively. Not a defect. |
| ORD-1014 | Missing from Analytics entirely | It is a Cart. Carts do not sync. Absence is correct. |
| ORD-1016 | Returned with no Delivered event | Valid terminal branch per the state table. |
| ORD-1020 | Cancelled straight after Confirmed | Also valid. |
| 12 orders | Delivered after the promised date | Real, but an SLA finding, not a sync defect. Reported separately as **observations**. |

`tests/data/reconciliation.spec.js` asserts these stay silent, so a future rule change that starts
flagging them fails the build.

**Two orders are suspicious but not counted as defects.** ORD-1005 and ORD-1015 have an Order
Confirmed event later than the OMS `LastModified`. For 16 of 20 orders `LastModified` follows the last
event by seconds; the other two exceptions are ORD-1009 and ORD-1018, both already defects. The
contract does not define `LastModified`, so `STALE-LAST-MODIFIED` reports these as observations to
confirm with the OMS team.

## Honest limitations

- **Timeliness is unmeasurable here.** There is no ingestion timestamp in the data, only event time,
  so sync lag cannot be computed. In production I would assert `ingestedAt - eventTime` against an
  SLO per activity.
- **The AI cassette is authored, not yet live-recorded.** `ai/cache/rule-candidates.json` exists so a
  reviewer with no API key can run the artifact. Re-record with `npm run ai:compile -- --live`. See
  the pending note at the end of `AI_WORKLOG.md`.
- **No performance run was executed.** `perf/ingest.js` is a validated script, not a result. Pointed
  at the mock it would measure a mock — no database, no queue, no network.
- **The UI slice shares a domain model with the data layer but not a data path.** SauceDemo has no
  readable API, so an order placed through the UI cannot then be reconciled. With a real OMS that is
  the first test I would add.
- **Idempotency is specified (`STRATEGY.md` A-05) but not implemented** in the mock, which has no
  cross-request persistence. Testing it would test the mock, not a contract.

## Trade-offs I would defend

**A declarative engine for 20 rules is over-engineered if you only ever have 20 rules.** It is the
right shape at 200, and at 20 it already paid for itself twice: the data tests are generated from
the inventory, and the LLM in `ai/` has a schema to target instead of writing code.

**The LLM is deliberately kept off the critical path.** The obvious artifact — ask a model to explain
the anomalies — puts it between the data and the verdict. Here it is used for recall (which clauses
have no rule) while precision stays in deterministic code. It also means the submission does not
depend on a model being available to produce its result.

**Mutation testing over more rules.** Given a choice between another rule and proving the
existing ones still fire, the proof is worth more. A validation suite's real failure mode is
rotting silently — a renamed column, an over-eager normaliser — and a green run looks identical to
clean data.

## Requirements

Node 18+. Playwright pinned to 1.60.0 to match a locally available chromium build; see
`framework/README.md` if the browser download is blocked on your network. The reconciler and
mutation harness need neither Playwright nor a browser.
