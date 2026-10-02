import { SCOPE, SEVERITY } from '../reconcile/engine.js';
import { checkConformance, EXPECTED_VARIANT, STATUSES } from '../domain/lifecycle.js';

const SEVERITY_BY_DEVIATION = {
  missing: SEVERITY.HIGH,
  'out-of-order': SEVERITY.HIGH,
  duplicate: SEVERITY.MEDIUM,
  unexpected: SEVERITY.MEDIUM,
};

const describe = (deviation, status) => {
  switch (deviation.type) {
    case 'missing':
      return `A ${status} order must show "${deviation.activity}" but the event log does not contain it. The step is missing from every variant and conformance report, so the process looks shorter than it is.`;
    case 'duplicate':
      return `"${deviation.activity}" appears ${deviation.observed} times where the variant expects ${deviation.expected}. Duplicate events double-count the step and distort activity frequency and rework metrics.`;
    case 'unexpected':
      return `"${deviation.activity}" is not part of the expected variant for a ${status} order, so the case will be classified as a non-standard variant.`;
    case 'out-of-order':
      return `"${deviation.activity}" occurs after "${deviation.precededBy}" although the variant requires the reverse. Process discovery will infer an edge that does not exist in the real process.`;
    default:
      return `Unclassified deviation on "${deviation.activity}".`;
  }
};

export const conformanceRules = [
  {
    id: 'CNF-001',
    dimension: 'process conformance',
    severity: SEVERITY.HIGH,
    scope: SCOPE.PAIR,
    title: 'Observed trace must conform to the expected variant for the order status',
    contract: 'A delivered order must show the full happy-path sequence; Cancelled and Returned are valid terminal branches.',
    detection: 'Replay each case trace (ordered by timestamp) against the declared variant for its OMS status; report each deviation shape separately. See src/domain/lifecycle.js.',
    evaluate: ({ order, eventCase }) => {
      // Orphans and dropped orders are already reported by REF-001 and COM-001. Re-reporting them
      // here would turn one root cause into two findings and overstate the defect count.
      if (!order || !eventCase) return null;
      if (order.status === STATUSES.CART) return null;

      const result = checkConformance(order.status, eventCase.trace);
      if (result.unknownStatus) {
        return {
          summary: `Order status "${order.status}" is not a known lifecycle state, so no expected variant could be applied.`,
          evidence: { status: order.status, observedTrace: eventCase.trace },
        };
      }
      if (result.conformant) return null;

      return result.deviations.map((deviation) => ({
        severity: SEVERITY_BY_DEVIATION[deviation.type] ?? SEVERITY.MEDIUM,
        summary: describe(deviation, order.status),
        evidence: {
          omsStatus: order.status,
          deviationType: deviation.type,
          activity: deviation.activity,
          expectedTrace: result.expectedTrace,
          observedTrace: result.observedTrace,
        },
      }));
    },
  },
  {
    id: 'CNF-002',
    dimension: 'process conformance',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.DATASET,
    title: 'Every activity must be a declared lifecycle activity',
    contract: 'Activity enum Order Placed, Order Confirmed, Order Shipped, Order Delivered, Order Cancelled, Order Returned',
    detection: 'Set difference between observed activity names and the declared enum. Catches typos and new activity names the sync starts emitting without a contract change.',
    evaluate: (model) => {
      const declared = new Set(Object.values(EXPECTED_VARIANT).flat());
      const unknown = new Map();

      for (const event of model.events) {
        if (!declared.has(event.activity)) {
          if (!unknown.has(event.activity)) unknown.set(event.activity, []);
          unknown.get(event.activity).push(event.caseId);
        }
      }

      return [...unknown.entries()].map(([activity, cases]) => ({
        cases: [...new Set(cases)],
        summary: `Activity "${activity}" is not in the declared enum but appears ${cases.length} time(s).`,
        evidence: { activity, occurrences: cases.length },
      }));
    },
  },
];
