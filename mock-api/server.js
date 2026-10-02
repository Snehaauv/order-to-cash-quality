import { createServer } from 'node:http';
import { reconcile } from '../src/reconcile/run.js';
import { parseMinorUnits, CURRENCY_PATTERN } from '../src/domain/money.js';
import { ISO_UTC_PATTERN } from '../src/domain/time.js';
import { EXPECTED_VARIANT } from '../src/domain/lifecycle.js';

/**
 * A stand-in for the sync/ingest API, built over the same CSVs the reconciler reads.
 *
 * The brief allows either a public API or a local mock. A mock is the better choice here because the
 * interesting API tests are negative ones - what does ingest do with a malformed payload, an unknown
 * order, a bad currency - and no public sandbox will reproduce this contract. The validation below
 * is deliberately the same set of invariants the reconciler enforces after the fact: an ingest
 * endpoint that accepts data its own reconciliation will later reject is the bug this whole exercise
 * is about.
 *
 * Zero dependencies, so `npm run mock-api` works on a clean clone with nothing installed.
 */

const DECLARED_ACTIVITIES = new Set(Object.values(EXPECTED_VARIANT).flat());

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'x-api-version': '1',
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const validateEvent = (event) => {
  const errors = [];
  const require = (field) => {
    if (event?.[field] === undefined || event[field] === null || event[field] === '') {
      errors.push({ field, code: 'required' });
      return false;
    }
    return true;
  };

  if (require('caseId') && !/^ORD-\d{4}$/.test(event.caseId)) {
    errors.push({ field: 'caseId', code: 'format', expected: 'ORD-####' });
  }
  if (require('activity') && !DECLARED_ACTIVITIES.has(event.activity)) {
    errors.push({ field: 'activity', code: 'enum', allowed: [...DECLARED_ACTIVITIES] });
  }
  // Required because process mining attributes every activity to a resource. An event with no
  // actor is not merely untidy - it silently joins an "unknown" bucket in every handover analysis.
  require('resourceUser');

  if (require('timestamp') && !ISO_UTC_PATTERN.test(event.timestamp)) {
    errors.push({ field: 'timestamp', code: 'format', expected: 'ISO-8601 UTC with Z designator' });
  }
  if (require('currency') && !CURRENCY_PATTERN.test(String(event.currency).toUpperCase())) {
    errors.push({ field: 'currency', code: 'format', expected: 'ISO-4217' });
  }
  if (require('amount')) {
    const parsed = parseMinorUnits(event.amount);
    if (!parsed.ok) errors.push({ field: 'amount', code: 'format', expected: 'decimal(2)' });
    else if (parsed.value < 0) errors.push({ field: 'amount', code: 'range', expected: 'non-negative' });
  }

  return errors;
};

export const createApp = ({ state = reconcile() } = {}) => {
  const orders = state.model.orders;
  const caseById = state.model.caseById;
  const ingested = [];

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && path === '/health') {
      return json(res, 200, { status: 'ok', orders: orders.length, cases: caseById.size });
    }

    if (req.method === 'GET' && path === '/orders') {
      const status = url.searchParams.get('status');
      const filtered = status ? orders.filter((o) => o.status === status) : orders;
      return json(res, 200, {
        count: filtered.length,
        orders: filtered.map((o) => ({
          orderId: o.orderId,
          customerId: o.customerId,
          customerName: o.customerNameRaw,
          amount: o.amount.raw,
          currency: o.currency,
          status: o.status,
          createdDate: o.createdDate.raw,
          promisedDate: o.promisedDate.raw ?? null,
          deliveredDate: o.deliveredDate.raw ?? null,
        })),
      });
    }

    const orderMatch = /^\/orders\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && orderMatch) {
      const order = orders.find((o) => o.orderId === orderMatch[1]);
      if (!order) return json(res, 404, { error: 'not_found', orderId: orderMatch[1] });
      return json(res, 200, {
        orderId: order.orderId,
        status: order.status,
        amount: order.amount.raw,
        currency: order.currency,
        customerName: order.customerNameRaw,
      });
    }

    const eventsMatch = /^\/cases\/([^/]+)\/events$/.exec(path);
    if (req.method === 'GET' && eventsMatch) {
      const eventCase = caseById.get(eventsMatch[1]);
      if (!eventCase) return json(res, 404, { error: 'not_found', caseId: eventsMatch[1] });
      return json(res, 200, {
        caseId: eventCase.caseId,
        trace: eventCase.trace,
        events: eventCase.events.map((e) => ({
          activity: e.activity,
          timestamp: e.timestamp.raw,
          resourceUser: e.resourceUser,
          amount: e.amount.raw,
          currency: e.currency,
        })),
      });
    }

    if (req.method === 'POST' && path === '/sync/events') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: 'invalid_json' });
      }

      const events = Array.isArray(body?.events) ? body.events : null;
      if (!events) {
        return json(res, 422, { error: 'schema', detail: 'expected { events: [...] }' });
      }

      const rejected = [];
      const accepted = [];
      events.forEach((event, index) => {
        const errors = validateEvent(event);
        if (errors.length) rejected.push({ index, caseId: event?.caseId ?? null, errors });
        else accepted.push(event);
      });

      // All-or-nothing. A partial accept leaves the event log in a state the reconciler will
      // immediately flag as non-conformant, and the caller has no way to know which half landed.
      if (rejected.length) {
        return json(res, 422, { error: 'validation_failed', accepted: 0, rejected });
      }

      ingested.push(...accepted);
      return json(res, 202, { accepted: accepted.length, rejected: 0, ingestedTotal: ingested.length });
    }

    return json(res, 404, { error: 'no_route', method: req.method, path });
  });
};

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isDirectRun) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => console.log(`mock sync/ingest API on http://localhost:${port}`));
}
