# Test Strategy — Order-to-Cash, OMS ↔ Analytics

## What is actually at risk

The OMS is the system of record. The Analytics event log is a derived copy that business teams mine
for cycle times, bottlenecks and revenue leakage. Nobody reads the event log expecting it to be
wrong, and that is the whole problem: **a sync defect does not look like an outage, it looks like an
insight.** A dropped order lowers the apparent order count, a shifted timestamp shortens apparent
fulfilment time, and a re-denominated amount moves revenue between currencies. Each one produces a
plausible number that someone will act on.

That shapes the strategy. The priority is not "does the sync run" — it is **"can I prove the target
is a faithful representation of the source"**, and failing that, **"can I name exactly which rows
are not."**

Three consequences:

1. **The oracle is the source, not an expected-value table.** Almost every meaningful assertion is a
   comparison against `orders.csv`, not against a hard-coded constant. Hard-coded expectations rot;
   a reconciliation against the system of record stays true as the data changes.
2. **False positives cost more than they do elsewhere.** A defect report that cries wolf gets
   ignored, and the one real finding in it dies with the rest. Normalisation rules are therefore
   part of the contract, not an implementation detail — see `WRONG-NAME` versus the `ORD-1015` trap.
3. **Absence of a finding must be distinguishable from absence of a check.** A suite that goes green
   because a rule crashed is worse than no suite. This is why rule errors are reported separately
   and why the suite is mutation-tested.

## Layer 1 — Frontend / UI

The UI is where a Cart becomes a placed order, so it is the first point at which a value that must
survive the sync is committed. Verification here is cheap and prevents a defect from ever entering
the pipeline.

What I verify and why:

| Verify | Why it matters downstream |
|---|---|
| The total shown is the total committed | A wrong amount at checkout is wrong in the OMS and therefore wrong in Analytics. Catching it here is three layers cheaper than reconciliation. |
| An order cannot be placed with incomplete customer data | Blank denormalised fields become the `CustomerName` mismatches and unattributable cases later. |
| Cart state transitions are reflected immediately and consistently | A stale cart badge is the UI symptom of the same state-vs-event divergence the data layer hunts. |
| Lifecycle actions are available only in valid states | The state table forbids Delivered → Confirmed; if the UI offers it, the event log will eventually contain it. |
| Access control on order management | Not a sync concern, but an order mutated by the wrong actor produces a `ResourceUser` nobody can explain. |

**Automated slice (Part B):** `https://www.saucedemo.com`, chosen because its cart → checkout →
complete flow *is* the Cart → Confirmed transition. The UI layer then tells the same story as the
data layer instead of being an unrelated demo.

**Not automated at this layer:** visual regression and accessibility. Real concerns, wrong exercise —
neither can tell you whether the sync is faithful.

## Layer 2 — Backend / API

The sync/ingest API is the gate. Every defect in `DEFECT_REPORT.md` is data that an ingest endpoint
should have refused. If ingest had rejected the EUR-as-USD event, there would be nothing to
reconcile.

| Check class | What I assert |
|---|---|
| Schema | Required fields, types, `decimal(2)` precision, ISO-8601 with the `Z` designator, ISO-4217 currency |
| Enum | `Activity` within the declared six; `Status` within the declared six |
| Referential | `caseId` matches `ORD-####` and resolves to a real order |
| Status codes | 202 accept, 400 malformed body, 404 unknown resource, 422 schema/validation failure |
| Negative paths | Negative amounts, future timestamps, excess precision, unknown activity, blank actor |
| Transactionality | A batch containing one bad event accepts **none** of it |
| Idempotency | Re-delivering the same event must not create a duplicate (the `ORD-1011` defect class) |
| Contract stability | Response shape and `x-api-version` do not drift silently |

Transactionality deserves emphasis. A partial accept leaves the event log in exactly the
half-synced state that produces the missing-step defects in this dataset, and the caller cannot tell
which half landed.

## Layer 3 — Data validation

This is where the real coverage lives. Six dimensions, each with at least one rule, enforced
declaratively so the contract is reviewable as data rather than buried in control flow.

| Dimension | Question | Method |
|---|---|---|
| Completeness | Did anything get dropped? | Anti-join source → target, excluding Carts |
| Referential integrity | Does every case resolve to an order? | Anti-join target → source |
| Value correctness | Did amounts and currencies survive? | Per-event comparison in integer minor units |
| Temporal correctness | Are timestamps true, ordered and UTC? | Delta classification against real UTC offsets |
| Process conformance | Does the trace match the expected variant? | Replay each case against a declared variant model |
| Data quality | Is the source itself sane? | Intra-row assertions on the OMS |

Two methodological choices worth defending:

**Conformance by replay, not by special cases.** The lifecycle is declared as an expected activity
trace per terminal status; each case's observed trace is diffed against it. Missing steps, duplicate
steps, out-of-order steps and invalid branches all fall out of one algorithm. The alternative — a
hand-written check per defect shape — grows a branch per incident and misses every shape nobody
thought of.

**Delta classification, not delta detection.** When a timestamp mismatch is exactly a real UTC
offset, the finding says so. `ORD-1009` is `+05:30` — Asia/Kolkata — which turns "two timestamps
differ, please investigate" into "local wall-clock time is being written into a UTC field."

**Timeliness** is the one dimension this dataset cannot support: there is no ingestion timestamp, only
event time, so sync lag is unmeasurable here. In production I would assert `ingestedAt - eventTime`
against an SLO per activity. Called out rather than quietly skipped.

## Prioritised scenarios

Priority is risk = (probability the sync gets it wrong) × (cost of the resulting wrong decision).
**P1** means a silent, material, plausible-looking error.

| ID | Layer | Scenario | Priority | Technique | Oracle / expected result |
|---|---|---|---|---|---|
| D-01 | Data | Every non-Cart order appears in Analytics | P1 | Anti-join | Zero orders absent from the event log |
| D-02 | Data | No Analytics case lacks a source order | P1 | Reverse anti-join | Zero orphan cases |
| D-03 | Data | Amount matches on every event | P1 | Integer minor-unit comparison | Exact equality, no tolerance |
| D-04 | Data | Currency matches on every event | P1 | Normalised string comparison | Exact equality after trim/upper |
| D-05 | Data | Delivered orders show the full happy path | P1 | Variant replay | Trace equals `Placed→Confirmed→Shipped→Delivered` |
| D-06 | Data | No event timestamp is in the future | P1 | Clock comparison (injected clock) | All events ≤ reference now |
| D-07 | Data | Delivered event time equals OMS `DeliveredDate` | P1 | Delta classification | Zero delta, or delta named as a timezone fault |
| D-08 | Data | Happy-path events are non-decreasing in time | P1 | Rank-ordered monotonicity | No negative step duration |
| D-09 | Data | No duplicate activity within a case | P2 | Multiset comparison vs variant | Each expected activity occurs exactly once |
| D-10 | Data | Carts do not sync | P2 | Inner join on `Status = Cart` | Zero events for Cart orders |
| D-11 | Data | `OrderAmount` is never negative | P2 | Sign assertion | All amounts ≥ 0 |
| D-12 | Data | `CustomerName` matches after documented normalisation | P2 | Trim + case-fold comparison | Equal; `ORD-1015` must **not** be flagged |
| D-13 | Data | Cancelled / Returned terminal branches are accepted | P2 | Variant replay | Conformant, zero findings |
| D-14 | Data | Timestamps carry an explicit UTC designator | P3 | Pattern assertion | All match `...Z` |
| D-15 | Data | Keys match documented formats | P3 | Regex assertion | `ORD-####`, `CUST-##` |
| A-01 | API | Ingest rejects an unknown activity | P1 | Negative / equivalence class | 422, error names `activity` |
| A-02 | API | Ingest rejects a non-UTC timestamp | P1 | Negative | 422, error names `timestamp` |
| A-03 | API | Ingest rejects a non-ISO currency | P1 | Negative | 422, error names `currency` |
| A-04 | API | A batch with one bad event accepts none | P1 | Transactionality | 422, `accepted: 0` |
| A-05 | API | Re-delivering an event does not duplicate it | P1 | Idempotency | Second call creates no second event |
| A-06 | API | Unknown order returns 404, not empty 200 | P2 | Negative | 404 with `not_found` |
| A-07 | API | Amount boundary: excess precision rejected | P2 | Boundary | 422 on `12500.123` |
| A-08 | API | Negative amount rejected at the door | P2 | Boundary | 422, `range` |
| A-09 | API | Response shape and version do not drift | P3 | Contract snapshot | Keys and `x-api-version` stable |
| U-01 | UI | Cart can be assembled and placed | P1 | E2E happy path | Order confirmation shown |
| U-02 | UI | Checkout total equals the sum of line items | P1 | Calculation check | Total ≥ subtotal, difference is tax only |
| U-03 | UI | Order cannot be placed with missing customer fields | P2 | Negative | Validation error, no order created |
| U-04 | UI | Removing the last item empties the cart | P2 | State consistency | Badge absent, not stale |
| U-05 | UI | Invalid credentials refused without user enumeration | P3 | Security-adjacent negative | Generic failure message |

## If I only had one hour

In this order, and I would stop wherever the hour ran out:

1. **D-01 and D-02** — completeness and orphans. Ten minutes, and they answer the only
   unrecoverable question: is anything missing or invented? Every other defect is a wrong value on a
   row that at least exists.
2. **D-03 and D-04** — amount and currency. These are the findings that move money in a report.
3. **D-05** — conformance for delivered orders. Catches missing, duplicated and out-of-order steps
   in one pass, so it is the highest coverage per minute of anything here.
4. **D-06 and D-07** — future dates and the delivered-timestamp delta. Timestamp faults are the
   hardest to spot by eye and the most corrosive to process mining, which is entirely built on time.

What I would consciously defer: key formats, the UTC designator check, and the whole UI layer. A
malformed key is loud and gets noticed; a 5½-hour timestamp shift is silent and never does.

## Assumptions

- `orders.csv` is authoritative. Where the two disagree without other evidence, Analytics is wrong.
- The 20-row dataset is a sample of a much larger feed, so every check is written to run over a
  stream rather than depending on being able to eyeball the data.
- `PromisedDate` is a commitment, not a sync-controlled field, so breaching it is a business finding
  rather than an integration defect. Reported separately as an observation.
- Reference "now" is injected, not read from the system clock, so the future-timestamp rule is
  reproducible in CI.

## What I would add with more time

- **Timeliness**, once the feed carries an ingestion timestamp — sync lag per activity against an SLO.
- **Volume reconciliation by period**, not just by row: daily counts and sums per currency, because
  at millions of orders a per-row diff is the wrong tool for spotting a partial batch failure.
- **Trend-aware anomaly detection on variant distribution.** If the share of cases following the
  happy path drops week on week, something changed in the sync even when no individual row violates
  a rule.
- **Contract tests shared between producer and consumer**, so the sync and the reconciler cannot
  drift apart — currently both encode the contract independently, and only the reconciler is tested.
