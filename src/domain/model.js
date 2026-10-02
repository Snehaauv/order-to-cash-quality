import { readCsv } from '../io/csv.js';
import { parseMinorUnits, normaliseCurrency } from './money.js';
import { parseInstant } from './time.js';

/**
 * Builds the single joined view that every rule reads from.
 *
 * Parsing happens once, here, and the parse outcome is kept on the record rather than thrown away:
 * a value that could not be parsed is itself a finding, so rules need to distinguish "absent",
 * "present but unparseable" and "present and valid". Rules that silently coerce a bad value would
 * report a misleading comparison failure instead of the actual data-quality fault.
 */

const toOrder = (row) => ({
  line: row.__line,
  orderId: row.OrderId.trim(),
  customerId: row.CustomerId.trim(),
  customerNameRaw: row.CustomerName,
  amount: parseMinorUnits(row.OrderAmount),
  currencyRaw: row.Currency,
  currency: normaliseCurrency(row.Currency),
  status: row.Status.trim(),
  createdDate: parseInstant(row.CreatedDate),
  promisedDate: parseInstant(row.PromisedDate),
  deliveredDate: parseInstant(row.DeliveredDate),
  lastModified: parseInstant(row.LastModified),
});

const toEvent = (row) => ({
  line: row.__line,
  caseId: row.CaseId.trim(),
  activity: row.Activity.trim(),
  timestamp: parseInstant(row.Timestamp),
  resourceUser: row.ResourceUser.trim(),
  amount: parseMinorUnits(row.Amount),
  currencyRaw: row.Currency,
  currency: normaliseCurrency(row.Currency),
  customerNameRaw: row.CustomerName,
});

export const buildModel = ({ ordersPath, eventsPath, now = new Date() }) => {
  const orders = readCsv(ordersPath).rows.map(toOrder);
  const events = readCsv(eventsPath).rows.map(toEvent);

  const orderById = new Map(orders.map((order) => [order.orderId, order]));

  const caseById = new Map();
  for (const event of events) {
    if (!caseById.has(event.caseId)) {
      caseById.set(event.caseId, { caseId: event.caseId, events: [] });
    }
    caseById.get(event.caseId).events.push(event);
  }

  // Sorting by timestamp - not by file order - is what makes the ORD-1010 ordering defect visible.
  // Events with an unparseable timestamp sort last so they never masquerade as the earliest event.
  for (const eventCase of caseById.values()) {
    eventCase.events.sort((a, b) => {
      if (!a.timestamp.ok) return 1;
      if (!b.timestamp.ok) return -1;
      return a.timestamp.ms - b.timestamp.ms;
    });
    eventCase.trace = eventCase.events.map((event) => event.activity);
  }

  const allIds = [...new Set([...orderById.keys(), ...caseById.keys()])].sort();
  const pairs = allIds.map((id) => ({
    id,
    order: orderById.get(id) ?? null,
    eventCase: caseById.get(id) ?? null,
  }));

  return {
    now,
    nowMs: now.getTime(),
    orders,
    events,
    orderById,
    caseById,
    pairs,
    counts: {
      orders: orders.length,
      events: events.length,
      cases: caseById.size,
    },
  };
};
