# Performance & Load Test Plan — sync/ingest API

Design plus a runnable k6 stub (`perf/ingest.js`). No full run was executed; the stub is there to
prove the shape of the test, not to produce numbers from a laptop against a mock.

## What makes this workload unusual

The interesting property is not peak throughput — it is that **ingest is bursty and ordered.**

- Orders arrive steadily during the day, but lifecycle events arrive in **batch waves**: carriers
  reconcile overnight, so `Order Delivered` events land in a few large bursts rather than spread out.
- Events for a single case **must not be reordered**. The whole value of the event log is sequence.
  So any throughput gain from parallelism is worthless if it reorders events within a case.
- The consumer is a **process-mining platform**, not a dashboard. Latency matters less than
  completeness and ordering. A 2-second p99 is fine; dropping 0.1% of events under load is not.

That reorders the usual priorities. I would spend the budget proving **no loss and no reordering
under burst**, not shaving p95.

## Workload model

Derived from the sample and scaled to enterprise volume:

| Parameter | Value | Basis |
|---|---|---|
| Orders per day | 2,000,000 | Stated enterprise scale |
| Events per order | 3.35 | 67 events ÷ 20 orders in the sample |
| Events per day | ~6.7M | Derived |
| Steady-state rate | ~78 events/sec | 6.7M ÷ 86,400 |
| Business-hours rate | ~190 events/sec | 70% of volume in 8 hours |
| Overnight batch burst | ~5,000 events/sec for ~10 min | Carrier reconciliation wave |
| Batch size | 500 events/request | Tunable; a parameter to find, not assume |
| Payload | ~220 bytes/event, ~110 KB/batch | Measured from the CSV row width |

Activity mix follows the sample: `Placed` 29%, `Confirmed` 28%, `Shipped` 25%, `Delivered` 16%,
`Cancelled`/`Returned` 2%. Case IDs are drawn from a realistic distribution rather than uniformly —
a small share of cases get many events (returns, re-deliveries), and uniform random keys would hide
hot-partition behaviour.

## Scenarios

| Scenario | Shape | Duration | Asks |
|---|---|---|---|
| **Baseline** | 78 events/s, single batch size | 15 min | What does an unloaded system cost per event? Everything else is read against this. |
| **Load** | Ramp to 190 events/s, hold | 60 min | Does it meet SLO at expected business-hours peak? |
| **Burst / Stress** | Step 500 → 1k → 2.5k → 5k → 10k events/s | 10 min per step | Where does it break, and *how*? Graceful 429 or silent loss? |
| **Soak** | 190 events/s | 12 hours | Memory growth, connection-pool exhaustion, index bloat, partition skew |
| **Spike recovery** | Idle → 5k/s for 5 min → idle | 30 min | Does the queue drain, and is anything lost in the process? |
| **Ordering under load** | 1k events/s concentrated on 50 case IDs | 20 min | Do per-case sequences survive concurrency? |

The last one is the scenario most load plans omit and the one this system most needs.

## SLIs and SLOs

| SLI | SLO | Rationale |
|---|---|---|
| Ingest latency p50 | < 150 ms | Comfortable for a batch producer |
| Ingest latency p95 | < 500 ms | Keeps producer retry windows short |
| Ingest latency p99 | < 2,000 ms | Tail tolerance is high; this is not user-facing |
| Throughput sustained | ≥ 2,000 events/s | ~10× business-hours peak, so a burst is absorbed without backpressure |
| Error rate (5xx) | < 0.1% | Producer must be able to retry a small failure set |
| **Event loss** | **0** | Non-negotiable. An accepted event that never appears is the `ORD-1006` defect at scale. |
| **Per-case ordering violations** | **0** | Non-negotiable. Reordering silently corrupts every cycle time. |
| Validation rejections | tracked, not capped | A rising 422 rate is a *producer* regression signal, not an ingest failure |
| End-to-end sync lag p95 | < 5 min | Operational reporting is only useful if it is current |

Two of those are correctness assertions, not performance ones, and that is intentional. A load test
that measures only latency will happily certify a system that drops 2% of events at peak.

## How loss and ordering get verified

Latency comes from k6. Correctness needs a reconciliation step, which is the point where this plan
connects back to Part C:

1. The generator writes every event it *successfully sent* to a local ledger.
2. After the run, query the platform for those case IDs.
3. Run the **same reconciliation rules** from `src/rules/` against sent-vs-stored.
4. `MISSING-ORDER` becomes the loss check. `TIME-OUT-OF-ORDER` becomes the ordering check.

The reconciler built for Part C is therefore the oracle for Part D. I would rather reuse one
definition of correctness than maintain a second, subtly different one inside the load test.

## Tooling

**k6**, for three reasons: the test is code and lives in the same repo as everything else;
thresholds are declarative and fail the build without a plugin; and its resource cost per VU is low
enough to drive 5k events/s from a couple of agents. JMeter would need a cluster and a GUI-authored
plan I could not review in a pull request. Locust would be a reasonable alternative if the team were
Python-first.

For burst work the generator must run on **at least two agents** — a single machine driving 5k
requests/s is measuring its own network stack as much as the service.

## What I would want instrumented before trusting any of it

A load test against a black box produces a number, not an explanation. Before the stress runs I
would want: ingest queue depth, consumer lag, DB write latency separated from API latency,
connection-pool saturation, and GC pause time. Otherwise "p99 degraded at 2.5k/s" has no actionable
cause and the next step is guesswork.

## Honest limitations

- The event-per-order ratio comes from 20 orders. It is the right method with the wrong sample size;
  I would recompute it from a month of production volume before committing to capacity numbers.
- No full run was performed. The stub runs against the local mock, which validates the script but
  tells you nothing about the real service — the mock has no database, no queue and no network.
- The burst figure (5k/s for 10 min) is inferred from "carriers reconcile overnight" rather than
  measured. It is a hypothesis to confirm with the integration owner, not a requirement.
