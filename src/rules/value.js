import { SCOPE, SEVERITY } from '../reconcile/engine.js';
import { formatMinorUnits, CURRENCY_PATTERN } from '../domain/money.js';
import { normaliseName, describeNormalisation } from '../domain/text.js';

export const valueRules = [
  {
    id: 'WRONG-AMOUNT',
    dimension: 'value correctness',
    severity: SEVERITY.CRITICAL,
    scope: SCOPE.PAIR,
    title: 'Event amount must equal the source order amount',
    contract: 'Amount and currency on every Analytics event must match the source order exactly.',
    detection: 'Per-event comparison in integer minor units (see src/domain/money.js) - no float tolerance.',
    evaluate: ({ order, eventCase }) => {
      if (!order || !eventCase || !order.amount.ok) return null;

      return eventCase.events
        .filter((event) => event.amount.ok && event.amount.value !== order.amount.value)
        .map((event) => ({
          summary: `"${event.activity}" carries ${event.amount.raw} but the order is ${order.amount.raw} - a ${formatMinorUnits(event.amount.value - order.amount.value)} discrepancy on a single event, so the case reconciles differently depending on which event a report reads.`,
          evidence: {
            activity: event.activity,
            omsAmount: order.amount.raw,
            analyticsAmount: event.amount.raw,
            differenceMinorUnits: event.amount.value - order.amount.value,
            eventLine: event.line,
          },
        }));
    },
  },
  {
    id: 'WRONG-CURRENCY',
    dimension: 'value correctness',
    severity: SEVERITY.CRITICAL,
    scope: SCOPE.PAIR,
    title: 'Event currency must equal the source order currency',
    contract: 'Amount and currency on every Analytics event must match the source order exactly.',
    detection: 'Per-event comparison after trimming and upper-casing the ISO-4217 code.',
    evaluate: ({ order, eventCase }) => {
      if (!order || !eventCase || order.currency === '') return null;

      const wrong = eventCase.events.filter((event) => event.currency !== order.currency);
      if (wrong.length === 0) return null;

      // Reported once per case, not per event.
      return {
        summary: `Order is denominated in ${order.currency} but ${wrong.length} of ${eventCase.events.length} Analytics event(s) say ${[...new Set(wrong.map((e) => e.currency))].join(', ')}. Revenue for this case is silently re-denominated downstream.`,
        evidence: {
          omsCurrency: order.currency,
          analyticsCurrencies: [...new Set(wrong.map((e) => e.currency))],
          amount: order.amount.raw,
          affectedActivities: wrong.map((e) => e.activity),
        },
      };
    },
  },
  {
    id: 'WRONG-NAME',
    dimension: 'value correctness',
    severity: SEVERITY.LOW,
    scope: SCOPE.PAIR,
    title: 'Customer name must match after documented normalisation',
    contract: 'CustomerName refers to the same entity on both sides and should be compared case-insensitively and trimmed.',
    detection: 'Compare after collapsing whitespace and case-folding. A raw comparison here produces a false positive the contract explicitly disclaims.',
    evaluate: ({ order, eventCase }) => {
      if (!order || !eventCase) return null;

      const expected = normaliseName(order.customerNameRaw);
      const mismatched = eventCase.events.filter(
        (event) => normaliseName(event.customerNameRaw) !== expected,
      );
      if (mismatched.length === 0) return null;

      return {
        summary: `Customer name still differs after trimming and case-folding: OMS "${order.customerNameRaw}" vs Analytics "${mismatched[0].customerNameRaw}".`,
        evidence: {
          omsRaw: order.customerNameRaw,
          analyticsRaw: mismatched[0].customerNameRaw,
          normalisationsApplied: ['collapse whitespace', 'case-fold'],
          affectedActivities: mismatched.map((e) => e.activity),
        },
      };
    },
  },
  {
    id: 'BAD-CURRENCY-CODE',
    dimension: 'value correctness',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.DATASET,
    title: 'Currency codes must be well-formed ISO-4217',
    contract: 'Currency ISO-4217 e.g. USD, EUR, GBP',
    detection: 'Shape assertion across both datasets. Catches blank and malformed codes that a value comparison between two equally wrong sides would miss.',
    evaluate: (model) => {
      const bad = [
        ...model.orders
          .filter((o) => !CURRENCY_PATTERN.test(o.currency))
          .map((o) => ({ id: o.orderId, source: 'orders.csv', value: o.currencyRaw, line: o.line })),
        ...model.events
          .filter((e) => !CURRENCY_PATTERN.test(e.currency))
          .map((e) => ({ id: e.caseId, source: 'analytics_event_log.csv', value: e.currencyRaw, line: e.line })),
      ];

      return bad.map((entry) => ({
        cases: [entry.id],
        summary: `${entry.source} line ${entry.line} holds currency "${entry.value}", which is not a three-letter ISO-4217 code.`,
        evidence: entry,
      }));
    },
  },
];
