// Known defects injected into a copy of the data. Each must be caught by the named rule on the named case.

export const MUTATIONS = [
  {
    id: 'MUT-01',
    describes: 'currency re-denominated on every event of a clean case',
    expect: { ruleId: 'WRONG-CURRENCY', caseId: 'ORD-1001' },
    events: (rows) => rows.map((row) => (row.startsWith('ORD-1001,') ? row.replace(',USD,', ',GBP,') : row)),
  },
  {
    id: 'MUT-02',
    describes: 'one-cent amount drift on a single event',
    expect: { ruleId: 'WRONG-AMOUNT', caseId: 'ORD-1001' },
    events: (rows) =>
      rows.map((row) =>
        row.startsWith('ORD-1001,Order Delivered') ? row.replace('12500.00', '12500.01') : row,
      ),
  },
  {
    id: 'MUT-03',
    describes: 'a mandatory lifecycle step dropped by the sync',
    expect: { ruleId: 'WRONG-STEPS', caseId: 'ORD-1002' },
    events: (rows) => rows.filter((row) => !row.startsWith('ORD-1002,Order Confirmed')),
  },
  {
    id: 'MUT-04',
    describes: 'event delivered twice by a retry without idempotency',
    expect: { ruleId: 'WRONG-STEPS', caseId: 'ORD-1004' },
    events: (rows) => {
      const target = rows.find((row) => row.startsWith('ORD-1004,Order Shipped'));
      return target ? [...rows, target] : rows;
    },
  },
  {
    id: 'MUT-05',
    describes: 'local wall-clock time written into a UTC field (+05:30)',
    expect: { ruleId: 'WRONG-DELIVERY-TIME', caseId: 'ORD-1002' },
    events: (rows) =>
      rows.map((row) =>
        row.startsWith('ORD-1002,Order Delivered')
          ? row.replace('2026-08-28T11:00:00Z', '2026-08-28T16:30:00Z')
          : row,
      ),
  },
  {
    id: 'MUT-06',
    describes: 'future-dated event from a bad clock',
    expect: { ruleId: 'FUTURE-DATE', caseId: 'ORD-1004' },
    events: (rows) =>
      rows.map((row) =>
        row.startsWith('ORD-1004,Order Shipped')
          ? row.replace('2026-08-07T09:00:00Z', '2031-08-07T09:00:00Z')
          : row,
      ),
  },
  {
    id: 'MUT-07',
    describes: 'entire order dropped from the sync',
    expect: { ruleId: 'MISSING-ORDER', caseId: 'ORD-1005' },
    events: (rows) => rows.filter((row) => !row.startsWith('ORD-1005,')),
  },
  {
    id: 'MUT-08',
    describes: 'orphan case with no order behind it',
    expect: { ruleId: 'EXTRA-ORDER', caseId: 'ORD-8888' },
    events: (rows) => [
      ...rows,
      'ORD-8888,Order Placed,2026-08-21T09:00:00Z,oms_sync,500.00,USD,Ghost Ltd',
    ],
  },
  {
    id: 'MUT-09',
    describes: 'negative amount in the system of record',
    expect: { ruleId: 'NEGATIVE-AMOUNT', caseId: 'ORD-1001' },
    orders: (rows) => rows.map((row) => (row.startsWith('ORD-1001,') ? row.replace('12500.00', '-12500.00') : row)),
  },
  {
    id: 'MUT-10',
    describes: 'steps emitted out of sequence',
    expect: { ruleId: 'TIME-OUT-OF-ORDER', caseId: 'ORD-1017' },
    events: (rows) =>
      rows.map((row) =>
        row.startsWith('ORD-1017,Order Shipped')
          ? row.replace('2026-08-20T09:00:00Z', '2026-09-20T09:00:00Z')
          : row,
      ),
  },
  {
    id: 'MUT-11',
    describes: 'cart leaked into analytics',
    expect: { ruleId: 'CART-COPIED', caseId: 'ORD-1014' },
    events: (rows) => [
      ...rows,
      'ORD-1014,Order Placed,2026-08-14T09:05:00Z,oms_sync,-500.00,USD,Alpine Ski House',
    ],
  },
  {
    id: 'MUT-12',
    describes: 'activity name the contract does not declare',
    expect: { ruleId: 'UNKNOWN-STEP', caseId: 'ORD-1003' },
    events: (rows) =>
      rows.map((row) =>
        row.startsWith('ORD-1003,Order Shipped') ? row.replace('Order Shipped', 'Order Dispatched') : row,
      ),
  },
  {
    id: 'MUT-13',
    describes: 'OMS LastModified not updated after the last lifecycle change',
    expect: { ruleId: 'STALE-LAST-MODIFIED', caseId: 'ORD-1001' },
    orders: (rows) =>
      rows.map((row) => (row.startsWith('ORD-1001,') ? row.replace('2026-08-20T14:30:05Z', '2026-08-03T09:00:05Z') : row)),
  },
];

const applyToCsv = (text, transform) => {
  if (!transform) return text;
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const [header, ...rows] = lines;
  return [header, ...transform(rows)].join('\n');
};

export const applyMutation = (mutation, { ordersCsv, eventsCsv }) => ({
  ordersCsv: applyToCsv(ordersCsv, mutation.orders),
  eventsCsv: applyToCsv(eventsCsv, mutation.events),
});
