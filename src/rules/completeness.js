import { SCOPE, SEVERITY } from '../reconcile/engine.js';
import { ACTIVITIES, STATUSES } from '../domain/lifecycle.js';

export const completenessRules = [
  {
    id: 'MISSING-ORDER',
    dimension: 'completeness',
    severity: SEVERITY.CRITICAL,
    scope: SCOPE.ORDER,
    title: 'Every non-Cart order must reach Analytics',
    contract: 'Carts do not sync. Every order in any state other than Cart must have at least an Order Placed event in Analytics.',
    detection: 'Left anti-join orders -> event log on OrderId = CaseId, excluding Status = Cart.',
    evaluate: (order, model) => {
      if (order.status === STATUSES.CART) return null;

      const eventCase = model.caseById.get(order.orderId);
      if (!eventCase) {
        return {
          summary: `Order is ${order.status} in the OMS but has no events at all in Analytics - the order is invisible to every downstream metric.`,
          evidence: {
            omsStatus: order.status,
            omsAmount: order.amount.raw,
            omsCurrency: order.currency,
            analyticsEventCount: 0,
          },
        };
      }

      if (!eventCase.trace.includes(ACTIVITIES.PLACED)) {
        return {
          summary: `Case exists in Analytics but carries no "${ACTIVITIES.PLACED}" event, so the case has no defined start.`,
          evidence: { omsStatus: order.status, observedTrace: eventCase.trace },
        };
      }

      return null;
    },
  },
  {
    id: 'CART-COPIED',
    dimension: 'completeness',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.ORDER,
    // The inverse of MISSING-ORDER. A sync that leaks work-in-progress carts into analytics inflates
    // order counts and conversion rates, and no rule looking for absence would ever notice.
    title: 'Cart orders must not appear in Analytics',
    contract: 'Carts do not sync.',
    detection: 'Inner join on Status = Cart; any matching case is a violation.',
    evaluate: (order, model) => {
      if (order.status !== STATUSES.CART) return null;

      const eventCase = model.caseById.get(order.orderId);
      if (!eventCase) return null;

      return {
        summary: `Order is still a Cart but ${eventCase.events.length} event(s) were synced to Analytics, counting an unplaced order as real demand.`,
        evidence: { omsStatus: order.status, observedTrace: eventCase.trace },
      };
    },
  },
];
