import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { randomSeed } from 'k6';

// k6 load test for the ingest endpoint. See PERFORMANCE.md.
//
//   npm run mock-api
//   k6 run perf/ingest.js
//   k6 run -e SCENARIO=burst perf/ingest.js

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const BATCH_SIZE = Number(__ENV.BATCH_SIZE || 500);
const SCENARIO = __ENV.SCENARIO || 'baseline';

const sentEvents = new Counter('events_sent');
const acceptedEvents = new Counter('events_accepted');
const rejectedBatches = new Counter('batches_rejected');
const batchLatency = new Trend('batch_latency_ms', true);

// Seeded for repeatable case IDs.
randomSeed(20260801);

const SCENARIOS = {
  baseline: {
    executor: 'constant-arrival-rate',
    rate: Math.ceil(78 / BATCH_SIZE) || 1,
    timeUnit: '1s',
    duration: '15m',
    preAllocatedVUs: 5,
    maxVUs: 20,
  },
  load: {
    executor: 'ramping-arrival-rate',
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 20,
    maxVUs: 100,
    stages: [
      { target: Math.ceil(190 / BATCH_SIZE) || 1, duration: '5m' },
      { target: Math.ceil(190 / BATCH_SIZE) || 1, duration: '55m' },
    ],
  },
  burst: {
    executor: 'ramping-arrival-rate',
    startRate: 1,
    timeUnit: '1s',
    preAllocatedVUs: 50,
    maxVUs: 400,
    stages: [
      { target: Math.ceil(500 / BATCH_SIZE), duration: '10m' },
      { target: Math.ceil(1000 / BATCH_SIZE), duration: '10m' },
      { target: Math.ceil(2500 / BATCH_SIZE), duration: '10m' },
      { target: Math.ceil(5000 / BATCH_SIZE), duration: '10m' },
      { target: Math.ceil(10000 / BATCH_SIZE), duration: '10m' },
    ],
  },
  soak: {
    executor: 'constant-arrival-rate',
    rate: Math.ceil(190 / BATCH_SIZE) || 1,
    timeUnit: '1s',
    duration: '12h',
    preAllocatedVUs: 20,
    maxVUs: 60,
  },
  // Concentrates load on a few cases to test per-case ordering.
  ordering: {
    executor: 'constant-arrival-rate',
    rate: Math.ceil(1000 / 10),
    timeUnit: '1s',
    duration: '20m',
    preAllocatedVUs: 50,
    maxVUs: 200,
  },
};

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] },
  thresholds: {
    'http_req_duration{expected_response:true}': ['p(50)<150', 'p(95)<500', 'p(99)<2000'],
    http_req_failed: ['rate<0.001'],
    // Loss is checked after the run by reconciliation - see PERFORMANCE.md.
    batches_rejected: ['count<1'],
  },
};

const ACTIVITY_MIX = [
  ...Array(29).fill('Order Placed'),
  ...Array(28).fill('Order Confirmed'),
  ...Array(25).fill('Order Shipped'),
  ...Array(16).fill('Order Delivered'),
  'Order Cancelled',
  'Order Returned',
];

const CASE_POOL_SIZE = SCENARIO === 'ordering' ? 50 : 2_000_000;

const makeEvent = () => {
  const caseNumber = 1000 + Math.floor(Math.random() * CASE_POOL_SIZE);
  const amount = (Math.floor(Math.random() * 5_000_00) / 100).toFixed(2);
  return {
    caseId: `ORD-${String(caseNumber).padStart(4, '0')}`,
    activity: ACTIVITY_MIX[Math.floor(Math.random() * ACTIVITY_MIX.length)],
    timestamp: new Date(Date.now() - Math.floor(Math.random() * 86_400_000)).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    resourceUser: 'load_gen',
    amount,
    currency: 'USD',
    customerName: `Load Customer ${caseNumber}`,
  };
};

export default function ingestBatch() {
  const events = Array.from({ length: BATCH_SIZE }, makeEvent);

  const response = http.post(`${BASE_URL}/sync/events`, JSON.stringify({ events }), {
    headers: { 'content-type': 'application/json' },
    tags: { name: 'POST /sync/events' },
  });

  sentEvents.add(events.length);
  batchLatency.add(response.timings.duration);

  const accepted = check(response, {
    'batch accepted with 202': (r) => r.status === 202,
    'response names how many were accepted': (r) => {
      try {
        return JSON.parse(r.body).accepted === events.length;
      } catch {
        return false;
      }
    },
  });

  if (accepted) acceptedEvents.add(events.length);
  else rejectedBatches.add(1);
}

export function handleSummary(data) {
  // Record of sent events for post-run reconciliation.
  return {
    'perf/summary.json': JSON.stringify(
      {
        scenario: SCENARIO,
        batchSize: BATCH_SIZE,
        eventsSent: data.metrics.events_sent?.values.count ?? 0,
        eventsAccepted: data.metrics.events_accepted?.values.count ?? 0,
        batchesRejected: data.metrics.batches_rejected?.values.count ?? 0,
        latency: data.metrics.http_req_duration?.values ?? {},
        note: 'Reconcile eventsAccepted against the platform with src/rules/ to prove zero loss and zero reordering.',
      },
      null,
      2,
    ),
  };
}
