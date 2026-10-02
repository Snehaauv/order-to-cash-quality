import { SCOPE, SEVERITY } from '../reconcile/engine.js';
import { classifyDelta, formatDuration, formatOffset, ISO_UTC_PATTERN } from '../domain/time.js';
import { ACTIVITIES, STATUSES, happyPathRank } from '../domain/lifecycle.js';

export const temporalRules = [
  {
    id: 'FUTURE-DATE',
    dimension: 'temporal correctness',
    severity: SEVERITY.HIGH,
    scope: SCOPE.CASE,
    title: 'No event timestamp may be in the future',
    contract: 'No timestamp may be in the future.',
    detection: 'Compare every event timestamp against the reconciliation clock (injectable, so the check is deterministic in CI).',
    evaluate: (eventCase, model) =>
      eventCase.events
        .filter((event) => event.timestamp.ok && event.timestamp.ms > model.nowMs)
        .map((event) => ({
          summary: `"${event.activity}" is dated ${event.timestamp.raw}, which is ${formatDuration(event.timestamp.ms - model.nowMs)} in the future. Future-dated events break cycle-time maths and can hide a case from "open work" reports.`,
          evidence: {
            activity: event.activity,
            timestamp: event.timestamp.raw,
            aheadOfNowBy: formatDuration(event.timestamp.ms - model.nowMs),
            referenceNow: model.now.toISOString(),
            eventLine: event.line,
          },
        })),
  },
  {
    id: 'WRONG-DELIVERY-TIME',
    dimension: 'temporal correctness',
    severity: SEVERITY.HIGH,
    scope: SCOPE.PAIR,
    title: 'Delivered event timestamp must equal the OMS DeliveredDate',
    contract: 'All timestamps are stored in UTC.',
    detection: 'Compare the Order Delivered event against DeliveredDate, then classify the delta against real UTC offsets to separate a timezone fault from independent clock skew.',
    evaluate: ({ order, eventCase }) => {
      if (!order || !eventCase || !order.deliveredDate.ok) return null;

      const delivered = eventCase.events.find((e) => e.activity === ACTIVITIES.DELIVERED);
      if (!delivered?.timestamp.ok) return null;
      if (delivered.timestamp.ms === order.deliveredDate.ms) return null;

      const delta = classifyDelta(order.deliveredDate.ms, delivered.timestamp.ms);

      // When the OMS delivery time matches a *different* activity exactly, the likeliest cause is
      // two activity labels being swapped during the sync rather than a clock problem at all.
      const twin = eventCase.events.find(
        (e) => e.activity !== ACTIVITIES.DELIVERED && e.timestamp.ok && e.timestamp.ms === order.deliveredDate.ms,
      );

      return {
        summary: twin
          ? `Delivered event is ${delivered.timestamp.raw} but the OMS records delivery at ${order.deliveredDate.raw} - which is exactly the timestamp carried by "${twin.activity}". The two activities appear to have been transposed during sync.`
          : `Delivered event is ${delivered.timestamp.raw} but the OMS records delivery at ${order.deliveredDate.raw} (${formatOffset(delta.deltaMinutes)}): ${delta.hypothesis}.`,
        severity: delta.kind === 'timezone-offset' ? SEVERITY.HIGH : SEVERITY.CRITICAL,
        evidence: {
          omsDeliveredDate: order.deliveredDate.raw,
          analyticsDeliveredAt: delivered.timestamp.raw,
          delta: formatOffset(delta.deltaMinutes),
          deltaKind: delta.kind,
          hypothesis: delta.hypothesis,
          transposedWith: twin?.activity ?? null,
        },
      };
    },
  },
  {
    id: 'TIME-OUT-OF-ORDER',
    dimension: 'temporal correctness',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.CASE,
    title: 'Happy-path events must be non-decreasing in time',
    contract: 'For a given order, event timestamps must be non-decreasing in happy-path order.',
    detection: 'Rank each happy-path activity, then assert timestamps rise with rank. Independent of the conformance replay, which reads the trace order rather than the clock.',
    evaluate: (eventCase) => {
      const ranked = eventCase.events
        .filter((e) => e.timestamp.ok && happyPathRank(e.activity) >= 0)
        .map((e) => ({ activity: e.activity, rank: happyPathRank(e.activity), ms: e.timestamp.ms, raw: e.timestamp.raw }))
        .sort((a, b) => a.rank - b.rank);

      const violations = [];
      for (let i = 1; i < ranked.length; i++) {
        if (ranked[i].ms < ranked[i - 1].ms) {
          violations.push({
            summary: `"${ranked[i].activity}" (${ranked[i].raw}) precedes "${ranked[i - 1].activity}" (${ranked[i - 1].raw}) even though it comes later in the happy path. Any duration measured between these two steps is negative.`,
            evidence: {
              earlierInPath: ranked[i - 1].activity,
              earlierTimestamp: ranked[i - 1].raw,
              laterInPath: ranked[i].activity,
              laterTimestamp: ranked[i].raw,
              negativeDurationOf: formatDuration(ranked[i - 1].ms - ranked[i].ms),
            },
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'NOT-UTC',
    dimension: 'temporal correctness',
    severity: SEVERITY.LOW,
    scope: SCOPE.DATASET,
    title: 'Timestamps must be explicitly UTC',
    contract: 'All timestamps are stored in UTC.',
    detection: 'Assert the Z designator on every timestamp in both files. A naive local-time string parses without error and silently adopts the reader machine timezone.',
    evaluate: (model) => {
      const offenders = [
        ...model.events
          .filter((e) => e.timestamp.ok && !ISO_UTC_PATTERN.test(e.timestamp.raw))
          .map((e) => ({ id: e.caseId, field: 'Timestamp', value: e.timestamp.raw, line: e.line })),
        ...model.orders.flatMap((o) =>
          [
            ['CreatedDate', o.createdDate],
            ['PromisedDate', o.promisedDate],
            ['DeliveredDate', o.deliveredDate],
            ['LastModified', o.lastModified],
          ]
            .filter(([, parsed]) => parsed.ok && !ISO_UTC_PATTERN.test(parsed.raw))
            .map(([field, parsed]) => ({ id: o.orderId, field, value: parsed.raw, line: o.line })),
        ),
      ];

      return offenders.map((entry) => ({
        cases: [entry.id],
        summary: `${entry.field} "${entry.value}" carries no UTC designator, so its meaning depends on whoever parses it.`,
        evidence: entry,
      }));
    },
  },
  {
    id: 'BAD-OMS-DATES',
    dimension: 'temporal correctness',
    severity: SEVERITY.MEDIUM,
    scope: SCOPE.ORDER,
    title: 'OMS dates must be internally coherent',
    contract: 'DeliveredDate ISO-8601 UTC Empty unless Status = Delivered',
    detection: 'Intra-row assertions on the source of record: delivery cannot precede creation, and a delivery date may only exist on a Delivered order.',
    evaluate: (order) => {
      const violations = [];

      if (order.deliveredDate.ok && order.createdDate.ok && order.deliveredDate.ms < order.createdDate.ms) {
        violations.push({
          summary: `DeliveredDate ${order.deliveredDate.raw} precedes CreatedDate ${order.createdDate.raw}.`,
          evidence: { createdDate: order.createdDate.raw, deliveredDate: order.deliveredDate.raw },
        });
      }

      if (order.deliveredDate.ok && order.status !== STATUSES.DELIVERED) {
        violations.push({
          summary: `Status is ${order.status} but DeliveredDate is populated (${order.deliveredDate.raw}); the schema reserves this field for delivered orders.`,
          evidence: { status: order.status, deliveredDate: order.deliveredDate.raw },
        });
      }

      if (order.status === STATUSES.DELIVERED && !order.deliveredDate.ok) {
        violations.push({
          summary: 'Status is Delivered but DeliveredDate is empty, so delivery cycle time cannot be computed from the source of record.',
          evidence: { status: order.status, deliveredDate: order.deliveredDate.raw ?? '' },
        });
      }

      return violations;
    },
  },
];
