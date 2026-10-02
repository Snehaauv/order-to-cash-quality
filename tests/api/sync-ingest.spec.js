import { test, expect } from '../../framework/fixtures/index.js';

/**
 * API-layer tests against the mock sync/ingest service.
 *
 * The weight is deliberately on the negative paths. A happy-path ingest test tells you the endpoint
 * works; the rejection tests tell you the endpoint defends the contract, and every defect in
 * DEFECT_REPORT.md is data that an ingest endpoint should have refused at the door. If ingest had
 * rejected the EUR-to-USD event, nobody would be reconciling it after the fact.
 */

const validEvent = (overrides = {}) => ({
  caseId: 'ORD-1001',
  activity: 'Order Shipped',
  timestamp: '2026-08-03T09:00:00Z',
  resourceUser: 'wh_bot',
  amount: '12500.00',
  currency: 'USD',
  customerName: 'Northwind Traders',
  ...overrides,
});

test.describe('contract and read paths', () => {
  test('health reports the loaded dataset', async ({ api }) => {
    const { status, body } = await api.health();
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
    expect(body.orders).toBeGreaterThan(0);
  });

  test('order list is filterable and shape-stable', async ({ api }) => {
    const { status, body } = await api.listOrders({ status: 'Delivered' });
    expect(status).toBe(200);
    expect(body.count).toBe(body.orders.length);
    expect(body.orders.every((order) => order.status === 'Delivered')).toBe(true);
    expect(Object.keys(body.orders[0]).sort()).toEqual(
      ['amount', 'createdDate', 'currency', 'customerId', 'customerName', 'deliveredDate', 'orderId', 'promisedDate', 'status'].sort(),
    );
  });

  test('a known order resolves with its source values', async ({ api }) => {
    const { status, body } = await api.getOrder('ORD-1008');
    expect(status).toBe(200);
    // The currency the OMS holds, which is the value the event log contradicts - see D-04.
    expect(body).toMatchObject({ orderId: 'ORD-1008', currency: 'EUR', amount: '5000.00' });
  });

  test('an unknown order is 404, not an empty 200', async ({ api }) => {
    const { status, body } = await api.getOrder('ORD-0000');
    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  test('case events are returned in trace order', async ({ api }) => {
    const { status, body } = await api.getCaseEvents('ORD-1001');
    expect(status).toBe(200);
    expect(body.trace).toEqual(['Order Placed', 'Order Confirmed', 'Order Shipped', 'Order Delivered']);
  });

  test('an orphan case is still readable - the API must not hide the data defect', async ({ api }) => {
    // ORD-9999 has events but no order. The API returning them is correct: suppressing the orphan
    // would hide D-09 from anyone querying the platform.
    const { status, body } = await api.getCaseEvents('ORD-9999');
    expect(status).toBe(200);
    expect(body.events).toHaveLength(4);
  });
});

test.describe('ingest validation', () => {
  test('a well-formed batch is accepted with 202', async ({ api }) => {
    const { status, body } = await api.ingest([validEvent()]);
    expect(status).toBe(202);
    expect(body).toMatchObject({ accepted: 1, rejected: 0 });
  });

  test('malformed JSON is 400', async ({ api }) => {
    const { status, body } = await api.ingestMalformed('{ not json');
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_json');
  });

  test('a payload missing the events array is 422', async ({ api }) => {
    const { status, body } = await api.ingestRaw({ event: validEvent() });
    expect(status).toBe(422);
    expect(body.error).toBe('schema');
  });

  const rejections = [
    ['activity outside the declared enum', { activity: 'Order Dispatched' }, 'activity', 'enum'],
    ['timestamp without a UTC designator', { timestamp: '2026-08-03T09:00:00' }, 'timestamp', 'format'],
    ['currency that is not ISO-4217', { currency: 'DOLLARS' }, 'currency', 'format'],
    ['negative amount', { amount: '-10.00' }, 'amount', 'range'],
    ['amount with excess precision', { amount: '12500.123' }, 'amount', 'format'],
    ['caseId not matching ORD-####', { caseId: 'CASE-1' }, 'caseId', 'format'],
    ['missing resource user', { resourceUser: '' }, 'resourceUser', 'required'],
  ];

  for (const [name, override, field, code] of rejections) {
    test(`rejects ${name}`, async ({ api }) => {
      const { status, body } = await api.ingest([validEvent(override)]);
      expect(status).toBe(422);
      expect(body.rejected[0].errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field, code })]),
      );
    });
  }

  test('a batch with one bad event accepts none of it', async ({ api }) => {
    // Asserting the all-or-nothing contract. A partial accept would leave the event log in exactly
    // the half-synced state that produces the missing-step defects in this report.
    const { status, body } = await api.ingest([validEvent(), validEvent({ currency: 'NOPE' })]);
    expect(status).toBe(422);
    expect(body.accepted).toBe(0);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].index).toBe(1);
  });

  test('every rejection names the offending field', async ({ api }) => {
    const { body } = await api.ingest([validEvent({ currency: 'NOPE', amount: 'abc' })]);
    const fields = body.rejected[0].errors.map((error) => error.field);
    expect(fields).toContain('currency');
    expect(fields).toContain('amount');
  });
});
