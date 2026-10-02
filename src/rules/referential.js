import { SCOPE, SEVERITY } from '../reconcile/engine.js';

export const referentialRules = [
  {
    id: 'REF-001',
    dimension: 'referential integrity',
    severity: SEVERITY.HIGH,
    scope: SCOPE.CASE,
    title: 'Every Analytics case must resolve to an OMS order',
    contract: 'The OMS is the system of record; the Analytics event log is the target (CaseId == OrderId).',
    detection: 'Right anti-join event log -> orders on CaseId = OrderId.',
    evaluate: (eventCase, model) => {
      if (model.orderById.has(eventCase.caseId)) return null;

      const amounts = [...new Set(eventCase.events.map((e) => e.amount.raw))];
      return {
        summary: `Case exists in Analytics with ${eventCase.events.length} event(s) but no such order exists in the OMS - an orphan case inflating volume and revenue with no source of record.`,
        evidence: {
          observedTrace: eventCase.trace,
          amounts,
          customerName: eventCase.events[0]?.customerNameRaw,
          firstSeen: eventCase.events[0]?.timestamp.raw,
        },
      };
    },
  },
  {
    id: 'REF-002',
    dimension: 'referential integrity',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.ORDER,
    title: 'OrderId must match the documented key format',
    contract: 'OrderId string Primary key, format ORD-####',
    detection: 'Regex assertion on the primary key of every source row.',
    evaluate: (order) =>
      /^ORD-\d{4}$/.test(order.orderId)
        ? null
        : {
            summary: `OrderId "${order.orderId}" does not match the documented ORD-#### format, so any join or partition that assumes the format will mis-handle it.`,
            evidence: { orderId: order.orderId, line: order.line },
          },
  },
];
