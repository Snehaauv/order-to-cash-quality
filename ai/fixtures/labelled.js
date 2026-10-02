// Labelled rows a generated rule must pass: flag every mustFlag row, stay silent on every mustPass row.

export const GOOD_ROWS = [
  {
    label: 'clean delivered order, all values agreeing',
    order: {
      orderId: 'FIX-0001',
      customerId: 'CUST-01',
      customerNameRaw: 'Northwind Traders',
      amount: { ok: true, value: 1250000, raw: '12500.00' },
      currency: 'USD',
      status: 'Delivered',
      createdDate: { ok: true, ms: Date.parse('2026-08-01T09:00:00Z'), raw: '2026-08-01T09:00:00Z' },
      promisedDate: { ok: true, ms: Date.parse('2026-08-08T00:00:00Z'), raw: '2026-08-08T00:00:00Z' },
      deliveredDate: { ok: true, ms: Date.parse('2026-08-20T14:30:00Z'), raw: '2026-08-20T14:30:00Z' },
      lastModified: { ok: true, ms: Date.parse('2026-08-20T14:30:05Z'), raw: '2026-08-20T14:30:05Z' },
    },
    events: [
      {
        caseId: 'FIX-0001',
        activity: 'Order Delivered',
        timestamp: { ok: true, ms: Date.parse('2026-08-20T14:30:00Z'), raw: '2026-08-20T14:30:00Z' },
        resourceUser: 'carrier',
        amount: { ok: true, value: 1250000, raw: '12500.00' },
        currency: 'USD',
        customerNameRaw: 'Northwind Traders',
        line: 2,
      },
    ],
  },
  {
    // Differs only by case and whitespace - not a defect.
    label: 'customer name differing only by case and trailing whitespace - contract says equal',
    order: {
      orderId: 'FIX-0002',
      customerId: 'CUST-15',
      customerNameRaw: 'VanArsdel  ',
      amount: { ok: true, value: 910000, raw: '9100.00' },
      currency: 'USD',
      status: 'Confirmed',
      createdDate: { ok: true, ms: Date.parse('2026-08-15T10:30:00Z'), raw: '2026-08-15T10:30:00Z' },
      promisedDate: { ok: true, ms: Date.parse('2026-08-22T00:00:00Z'), raw: '2026-08-22T00:00:00Z' },
      deliveredDate: { ok: false, reason: 'empty' },
      lastModified: { ok: true, ms: Date.parse('2026-08-15T10:30:02Z'), raw: '2026-08-15T10:30:02Z' },
    },
    events: [
      {
        caseId: 'FIX-0002',
        activity: 'Order Confirmed',
        timestamp: { ok: true, ms: Date.parse('2026-08-17T09:00:00Z'), raw: '2026-08-17T09:00:00Z' },
        resourceUser: 'a.rao',
        amount: { ok: true, value: 910000, raw: '9100.00' },
        currency: 'USD',
        customerNameRaw: 'vanarsdel',
        line: 3,
      },
    ],
  },
  {
    label: 'cart with no events - carts do not sync, so absence is correct',
    order: {
      orderId: 'FIX-0003',
      customerId: 'CUST-14',
      customerNameRaw: 'Alpine Ski House',
      amount: { ok: true, value: 50000, raw: '500.00' },
      currency: 'USD',
      status: 'Cart',
      createdDate: { ok: true, ms: Date.parse('2026-08-14T09:00:00Z'), raw: '2026-08-14T09:00:00Z' },
      promisedDate: { ok: true, ms: Date.parse('2026-08-21T00:00:00Z'), raw: '2026-08-21T00:00:00Z' },
      deliveredDate: { ok: false, reason: 'empty' },
      lastModified: { ok: true, ms: Date.parse('2026-08-14T09:00:01Z'), raw: '2026-08-14T09:00:01Z' },
    },
    events: [],
  },
];

export const BAD_ROWS = [
  {
    label: 'currency re-denominated on the event',
    mustBeCaughtBy: ['currency', 'value'],
    order: { ...GOOD_ROWS[0].order, orderId: 'FIX-9001', currency: 'EUR' },
    events: [{ ...GOOD_ROWS[0].events[0], caseId: 'FIX-9001', currency: 'USD' }],
  },
  {
    label: 'amount drifted by four minor units',
    mustBeCaughtBy: ['amount', 'value'],
    order: { ...GOOD_ROWS[0].order, orderId: 'FIX-9002' },
    events: [
      {
        ...GOOD_ROWS[0].events[0],
        caseId: 'FIX-9002',
        amount: { ok: true, value: 1250004, raw: '12500.04' },
      },
    ],
  },
  {
    label: 'customer name genuinely different entity',
    mustBeCaughtBy: ['name', 'customer'],
    order: { ...GOOD_ROWS[0].order, orderId: 'FIX-9003' },
    events: [{ ...GOOD_ROWS[0].events[0], caseId: 'FIX-9003', customerNameRaw: 'Southwind Traders' }],
  },
  {
    label: 'negative order amount',
    mustBeCaughtBy: ['amount', 'negative'],
    order: {
      ...GOOD_ROWS[0].order,
      orderId: 'FIX-9004',
      amount: { ok: true, value: -1250000, raw: '-12500.00' },
    },
    events: [{ ...GOOD_ROWS[0].events[0], caseId: 'FIX-9004' }],
  },
  {
    label: 'promised date precedes creation date',
    mustBeCaughtBy: ['date', 'promised', 'order'],
    order: {
      ...GOOD_ROWS[0].order,
      orderId: 'FIX-9005',
      promisedDate: { ok: true, ms: Date.parse('2026-07-01T00:00:00Z'), raw: '2026-07-01T00:00:00Z' },
    },
    events: [{ ...GOOD_ROWS[0].events[0], caseId: 'FIX-9005' }],
  },
  {
    label: 'event carries no resource user',
    mustBeCaughtBy: ['resource', 'user', 'present'],
    order: { ...GOOD_ROWS[0].order, orderId: 'FIX-9006' },
    events: [{ ...GOOD_ROWS[0].events[0], caseId: 'FIX-9006', resourceUser: '' }],
  },
];

const asPair = (row) => ({
  id: row.order.orderId,
  order: row.order,
  eventCase: row.events.length ? { caseId: row.order.orderId, events: row.events, trace: row.events.map((e) => e.activity) } : null,
});

// Rejected if it flags a good row, quarantined if it flags no bad row, otherwise accepted.
export const verifyRule = (rule) => {
  const falsePositives = [];
  const detected = [];

  const evaluate = (row) => {
    const pair = asPair(row);
    const subject = rule.scope === 'order' ? pair.order : pair;
    const result = rule.evaluate(subject);
    const findings = Array.isArray(result) ? result.filter(Boolean) : result ? [result] : [];
    return findings;
  };

  for (const row of GOOD_ROWS) {
    const findings = evaluate(row);
    if (findings.length) {
      falsePositives.push({ row: row.label, reason: findings[0].summary });
    }
  }

  for (const row of BAD_ROWS) {
    const findings = evaluate(row);
    if (findings.length) detected.push(row.label);
  }

  const reasons = [];
  let verdict;

  if (falsePositives.length) {
    verdict = 'rejected';
    reasons.push(
      `fires on ${falsePositives.length} row(s) the contract says are correct: ${falsePositives.map((f) => f.row).join('; ')}`,
    );
  } else if (detected.length === 0) {
    // No labelled defect caught: needs a fixture before it can be trusted.
    verdict = 'needs-fixture';
    reasons.push(
      'silent on every labelled defect - the gate cannot confirm it detects anything, so a fixture is needed before it can be trusted',
    );
  } else {
    verdict = 'accepted';
  }

  return { verdict, falsePositives, detected, reasons };
};
