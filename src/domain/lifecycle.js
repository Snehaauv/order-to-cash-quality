/**
 * The process model, and conformance checking by replaying each case against it.
 *
 * The alternative - one hand-written check per defect shape (missing step, extra step, wrong order,
 * invalid branch) - grows a new branch every time the process changes and silently misses any shape
 * nobody thought to write. Declaring the expected variant per terminal status and diffing the
 * observed trace against it catches all four shapes with one algorithm, and the model stays
 * readable enough to review against the written contract.
 */

export const ACTIVITIES = {
  PLACED: 'Order Placed',
  CONFIRMED: 'Order Confirmed',
  SHIPPED: 'Order Shipped',
  DELIVERED: 'Order Delivered',
  CANCELLED: 'Order Cancelled',
  RETURNED: 'Order Returned',
};

export const STATUSES = {
  CART: 'Cart',
  CONFIRMED: 'Confirmed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
};

export const HAPPY_PATH = [
  ACTIVITIES.PLACED,
  ACTIVITIES.CONFIRMED,
  ACTIVITIES.SHIPPED,
  ACTIVITIES.DELIVERED,
];

/**
 * Expected activity trace for an order sitting in each terminal status. A Cart has no expected
 * trace at all - the contract says carts do not sync, so an empty event log is conformant and the
 * presence of events would be the defect.
 */
export const EXPECTED_VARIANT = {
  [STATUSES.CART]: [],
  [STATUSES.CONFIRMED]: [ACTIVITIES.PLACED, ACTIVITIES.CONFIRMED],
  [STATUSES.SHIPPED]: [ACTIVITIES.PLACED, ACTIVITIES.CONFIRMED, ACTIVITIES.SHIPPED],
  [STATUSES.DELIVERED]: HAPPY_PATH,
  [STATUSES.CANCELLED]: [ACTIVITIES.PLACED, ACTIVITIES.CONFIRMED, ACTIVITIES.CANCELLED],
  [STATUSES.RETURNED]: [
    ACTIVITIES.PLACED,
    ACTIVITIES.CONFIRMED,
    ACTIVITIES.SHIPPED,
    ACTIVITIES.RETURNED,
  ],
};

export const VALID_TRANSITIONS = {
  [STATUSES.CART]: [STATUSES.CONFIRMED],
  [STATUSES.CONFIRMED]: [STATUSES.SHIPPED, STATUSES.CANCELLED],
  [STATUSES.SHIPPED]: [STATUSES.DELIVERED, STATUSES.RETURNED],
  [STATUSES.DELIVERED]: [STATUSES.RETURNED],
  [STATUSES.CANCELLED]: [],
  [STATUSES.RETURNED]: [],
};

export const happyPathRank = (activity) => HAPPY_PATH.indexOf(activity);

const countBy = (items) =>
  items.reduce((acc, item) => acc.set(item, (acc.get(item) ?? 0) + 1), new Map());

/**
 * Diffs an observed trace against the expected variant and reports each deviation shape separately,
 * because they have different causes: a missing step suggests a dropped sync message, a duplicate
 * suggests a retry without idempotency, and an ordering violation suggests the events were
 * timestamped or emitted out of sequence.
 */
export const checkConformance = (status, observedTrace) => {
  const expected = EXPECTED_VARIANT[status];
  if (!expected) {
    return { conformant: false, unknownStatus: true, deviations: [] };
  }

  const expectedCounts = countBy(expected);
  const observedCounts = countBy(observedTrace);
  const deviations = [];

  for (const [activity, needed] of expectedCounts) {
    const seen = observedCounts.get(activity) ?? 0;
    if (seen < needed) {
      deviations.push({ type: 'missing', activity, expected: needed, observed: seen });
    }
  }

  for (const [activity, seen] of observedCounts) {
    const needed = expectedCounts.get(activity) ?? 0;
    if (needed === 0) {
      deviations.push({ type: 'unexpected', activity, observed: seen });
    } else if (seen > needed) {
      deviations.push({ type: 'duplicate', activity, expected: needed, observed: seen });
    }
  }

  // Ordering is assessed only over activities the variant actually expects, and each is considered
  // once. Without that filter a duplicate or an unexpected activity would also be reported as an
  // ordering fault, turning one defect into three findings.
  const seenOnce = new Set();
  const orderedKnown = observedTrace.filter((activity) => {
    if (!expectedCounts.has(activity) || seenOnce.has(activity)) return false;
    seenOnce.add(activity);
    return true;
  });

  const positions = orderedKnown.map((activity) => expected.indexOf(activity));
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] < positions[i - 1]) {
      deviations.push({
        type: 'out-of-order',
        activity: orderedKnown[i],
        precededBy: orderedKnown[i - 1],
        expectedOrder: expected,
      });
    }
  }

  return {
    conformant: deviations.length === 0,
    expectedTrace: expected,
    observedTrace,
    deviations,
  };
};
