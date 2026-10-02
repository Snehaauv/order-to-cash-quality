import { SCOPE, SEVERITY } from '../reconcile/engine.js';
import { STATUSES } from '../domain/lifecycle.js';
import { formatDuration } from '../domain/time.js';

/**
 * Rules in this file inspect the OMS in isolation. They matter because the OMS is the source of
 * record: a cross-system comparison can only ever tell you the two sides agree, and two sides can
 * agree on a value that is wrong. A negative order amount that syncs faithfully is still a defect.
 */
export const qualityRules = [
  {
    id: 'NEGATIVE-AMOUNT',
    dimension: 'data quality',
    severity: SEVERITY.HIGH,
    scope: SCOPE.ORDER,
    title: 'OrderAmount must not be negative',
    contract: 'OrderAmount must never be negative for a valid order.',
    detection: 'Sign assertion on the parsed minor-unit value of every source row.',
    evaluate: (order) => {
      if (!order.amount.ok || order.amount.value >= 0) return null;

      return {
        summary: `OrderAmount is ${order.amount.raw}. The order is a ${order.status}, so it is not expected in Analytics, but a negative amount in the system of record will corrupt any total that includes carts or that later converts this order.`,
        evidence: { amount: order.amount.raw, status: order.status, line: order.line },
      };
    },
  },
  {
    id: 'UNKNOWN-STATUS',
    dimension: 'data quality',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.ORDER,
    title: 'Status must be a declared lifecycle state',
    contract: 'Status enum Cart, Confirmed, Shipped, Delivered, Cancelled, Returned',
    detection: 'Enum membership assertion. An unrecognised status would otherwise fall through the conformance model with no expected variant.',
    evaluate: (order) =>
      Object.values(STATUSES).includes(order.status)
        ? null
        : {
            summary: `Status "${order.status}" is not one of the declared lifecycle states.`,
            evidence: { status: order.status, line: order.line },
          },
  },
  {
    id: 'MISSING-FIELD',
    dimension: 'data quality',
    severity: SEVERITY.HIGH,
    scope: SCOPE.DATASET,
    title: 'Mandatory fields must be present and parseable',
    contract: 'Schema types declared in the data pack reference (decimal(2), ISO-8601 UTC).',
    detection: 'Every parse result carries its failure reason; this rule surfaces them rather than letting a downstream comparison report a misleading mismatch.',
    evaluate: (model) => {
      const findings = [];

      for (const order of model.orders) {
        if (!order.amount.ok) {
          findings.push({
            cases: [order.orderId],
            summary: `OrderAmount "${order.amount.raw ?? ''}" could not be parsed as decimal(2) (${order.amount.reason}).`,
            evidence: { field: 'OrderAmount', value: order.amount.raw ?? '', reason: order.amount.reason, line: order.line },
          });
        }
        if (!order.createdDate.ok) {
          findings.push({
            cases: [order.orderId],
            summary: `CreatedDate "${order.createdDate.raw ?? ''}" could not be parsed as ISO-8601 (${order.createdDate.reason}).`,
            evidence: { field: 'CreatedDate', value: order.createdDate.raw ?? '', reason: order.createdDate.reason, line: order.line },
          });
        }
      }

      for (const event of model.events) {
        if (!event.timestamp.ok) {
          findings.push({
            cases: [event.caseId],
            summary: `Event "${event.activity}" has Timestamp "${event.timestamp.raw ?? ''}" which could not be parsed (${event.timestamp.reason}).`,
            evidence: { field: 'Timestamp', activity: event.activity, value: event.timestamp.raw ?? '', reason: event.timestamp.reason, line: event.line },
          });
        }
        if (!event.amount.ok) {
          findings.push({
            cases: [event.caseId],
            summary: `Event "${event.activity}" has Amount "${event.amount.raw ?? ''}" which could not be parsed (${event.amount.reason}).`,
            evidence: { field: 'Amount', activity: event.activity, value: event.amount.raw ?? '', reason: event.amount.reason, line: event.line },
          });
        }
      }

      return findings;
    },
  },
];

/**
 * Observations are reported separately from defects. The sync is behaving correctly in every case
 * below - the finding is about the business process, not the integration. Mixing the two is how a
 * defect report loses credibility, because a reviewer who finds one non-defect starts doubting the
 * rest.
 */
export const observationRules = [
  {
    id: 'LATE-DELIVERY',
    dimension: 'process insight',
    severity: SEVERITY.INFO,
    scope: SCOPE.ORDER,
    title: 'Delivery breached the promised date',
    contract: 'Not a sync rule. PromisedDate is the commitment; DeliveredDate is the outcome.',
    detection: 'Compare DeliveredDate against PromisedDate on the source of record.',
    evaluate: (order) => {
      if (!order.deliveredDate.ok || !order.promisedDate.ok) return null;
      if (order.deliveredDate.ms <= order.promisedDate.ms) return null;

      return {
        classification: 'observation',
        summary: `Delivered ${formatDuration(order.deliveredDate.ms - order.promisedDate.ms)} after the promised date. The sync reproduced both dates faithfully - this is an SLA finding, not an integration defect.`,
        evidence: {
          promisedDate: order.promisedDate.raw,
          deliveredDate: order.deliveredDate.raw,
          lateBy: formatDuration(order.deliveredDate.ms - order.promisedDate.ms),
        },
      };
    },
  },
];
