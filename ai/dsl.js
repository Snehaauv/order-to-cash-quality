/**
 * A restricted check vocabulary that LLM-proposed rules must be expressed in, and the compiler that
 * turns one into an executable rule.
 *
 * The obvious design is to let the model emit JavaScript and `eval` it. That is a supply-chain hole
 * in a quality gate: a model that can write arbitrary code into your test suite can also write a
 * rule that always returns "no findings", and it would look plausible in review. Worse, prompt
 * content is attacker-reachable in any real deployment - the contract text might come from a wiki.
 *
 * So the model never emits code. It emits a declaration from the vocabulary below, and this file is
 * the only thing that turns a declaration into behaviour. An unknown check type is rejected rather
 * than interpreted. The cost is expressiveness: a genuinely novel check cannot be generated, only
 * proposed in prose for a human to implement. That trade is deliberate - I would rather lose a rule
 * than execute model output.
 */

import { SCOPE, SEVERITY } from '../src/reconcile/engine.js';
import { parseMinorUnits } from '../src/domain/money.js';
import { normaliseName } from '../src/domain/text.js';
import { parseInstant } from '../src/domain/time.js';

const NORMALISERS = {
  trim: (v) => String(v ?? '').trim(),
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  name: (v) => normaliseName(v),
};

// Only these paths are addressable. A typo or a hallucinated column fails at compile time with a
// clear message instead of silently reading `undefined` and comparing it to `undefined`, which
// would make the rule pass for every row.
const FIELD_PATHS = {
  'order.orderId': (ctx) => ctx.order?.orderId,
  'order.customerId': (ctx) => ctx.order?.customerId,
  'order.customerName': (ctx) => ctx.order?.customerNameRaw,
  'order.amount': (ctx) => ctx.order?.amount?.raw,
  'order.currency': (ctx) => ctx.order?.currency,
  'order.status': (ctx) => ctx.order?.status,
  'order.createdDate': (ctx) => ctx.order?.createdDate?.raw,
  'order.promisedDate': (ctx) => ctx.order?.promisedDate?.raw,
  'order.deliveredDate': (ctx) => ctx.order?.deliveredDate?.raw,
  'order.lastModified': (ctx) => ctx.order?.lastModified?.raw,
  'event.caseId': (ctx) => ctx.event?.caseId,
  'event.activity': (ctx) => ctx.event?.activity,
  'event.timestamp': (ctx) => ctx.event?.timestamp?.raw,
  'event.resourceUser': (ctx) => ctx.event?.resourceUser,
  'event.amount': (ctx) => ctx.event?.amount?.raw,
  'event.currency': (ctx) => ctx.event?.currency,
  'event.customerName': (ctx) => ctx.event?.customerNameRaw,
};

const readField = (path, ctx) => {
  const reader = FIELD_PATHS[path];
  if (!reader) throw new Error(`unknown field path "${path}"`);
  return reader(ctx);
};

const applyNormalisers = (value, names = []) =>
  names.reduce((acc, name) => {
    const fn = NORMALISERS[name];
    if (!fn) throw new Error(`unknown normaliser "${name}"`);
    return fn(acc);
  }, value);

const CHECKS = {
  fieldsEqual: ({ left, right, normalise = [] }) => (ctx) => {
    const a = applyNormalisers(readField(left, ctx), normalise);
    const b = applyNormalisers(readField(right, ctx), normalise);
    return a === b ? null : `${left} is "${a}" but ${right} is "${b}"`;
  },

  fieldPresent: ({ field }) => (ctx) => {
    const value = String(readField(field, ctx) ?? '').trim();
    return value === '' ? `${field} is empty` : null;
  },

  numericNotNegative: ({ field }) => (ctx) => {
    const parsed = parseMinorUnits(readField(field, ctx));
    if (!parsed.ok) return null;
    return parsed.value < 0 ? `${field} is negative (${parsed.raw})` : null;
  },

  valueInSet: ({ field, allowed, normalise = [] }) => (ctx) => {
    const value = applyNormalisers(readField(field, ctx), normalise);
    if (value === '' || value === undefined) return null;
    return allowed.includes(value) ? null : `${field} is "${value}", not one of ${allowed.join(', ')}`;
  },

  timestampOrder: ({ earlier, later }) => (ctx) => {
    const a = parseInstant(readField(earlier, ctx));
    const b = parseInstant(readField(later, ctx));
    if (!a.ok || !b.ok) return null;
    return b.ms < a.ms ? `${later} (${b.raw}) precedes ${earlier} (${a.raw})` : null;
  },

  matchesPattern: ({ field, pattern }) => {
    // The pattern is model-supplied, so it is length-capped and compiled once here. An unbounded
    // model-authored regex is a denial-of-service vector against your own CI.
    if (String(pattern).length > 120) throw new Error('pattern exceeds the 120-character limit');
    const regex = new RegExp(pattern);
    return (ctx) => {
      const value = String(readField(field, ctx) ?? '');
      if (value === '') return null;
      return regex.test(value) ? null : `${field} "${value}" does not match ${pattern}`;
    };
  },
};

export const CHECK_TYPES = Object.keys(CHECKS);
export const FIELD_NAMES = Object.keys(FIELD_PATHS);
export const NORMALISER_NAMES = Object.keys(NORMALISERS);

const REQUIRED = ['id', 'dimension', 'severity', 'scope', 'title', 'contract', 'check'];

export const validateSpec = (spec) => {
  const problems = [];

  for (const field of REQUIRED) {
    if (!spec?.[field]) problems.push(`missing "${field}"`);
  }
  if (spec?.check && !CHECKS[spec.check.type]) {
    problems.push(`unsupported check type "${spec.check?.type}" (allowed: ${CHECK_TYPES.join(', ')})`);
  }
  if (spec?.severity && !Object.values(SEVERITY).includes(spec.severity)) {
    problems.push(`severity "${spec.severity}" is not one of ${Object.values(SEVERITY).join(', ')}`);
  }
  if (spec?.scope && ![SCOPE.ORDER, SCOPE.PAIR].includes(spec.scope)) {
    problems.push(`generated rules may only use scope "${SCOPE.ORDER}" or "${SCOPE.PAIR}"`);
  }

  // Field paths are validated here rather than at evaluation time. A hallucinated column reached at
  // runtime reads as undefined, and a comparison of undefined to undefined passes - so the rule
  // would be accepted, run clean, and report coverage of a field that does not exist.
  for (const key of ['left', 'right', 'field', 'earlier', 'later']) {
    const path = spec?.check?.[key];
    if (path !== undefined && !FIELD_PATHS[path]) {
      problems.push(`check.${key} references unknown field "${path}"`);
    }
  }

  return problems;
};

/**
 * Compiles a validated spec into the same rule shape the hand-written rules use, so generated and
 * authored rules run through one executor and are reported identically. A generated rule gets no
 * privileges and no special path.
 */
export const compileSpec = (spec) => {
  const problems = validateSpec(spec);
  if (problems.length) {
    const error = new Error(`spec ${spec?.id ?? '(no id)'} is invalid: ${problems.join('; ')}`);
    error.problems = problems;
    throw error;
  }

  const predicate = CHECKS[spec.check.type](spec.check);

  return {
    id: spec.id,
    dimension: spec.dimension,
    severity: spec.severity,
    scope: spec.scope,
    title: spec.title,
    contract: spec.contract,
    detection: `Generated rule, check type "${spec.check.type}", verified against labelled fixtures before acceptance.`,
    generated: true,
    evaluate: (subject) => {
      const order = spec.scope === SCOPE.ORDER ? subject : subject.order;
      const events = spec.scope === SCOPE.PAIR ? (subject.eventCase?.events ?? []) : [];

      if (!order) return null;

      // An order-scoped check runs once against the order. A pair-scoped check runs per event, and
      // a case with no events is vacuously fine: there is no event to be wrong. Evaluating once
      // with a null event instead would read every event field as empty and report a defect on
      // every cart - the check would be measuring absence of data as badness of data.
      if (spec.scope === SCOPE.ORDER) {
        const reason = predicate({ order, event: null });
        return reason ? { summary: reason, evidence: { field: spec.check.left ?? spec.check.field } } : null;
      }

      return events
        .map((event) => {
          const reason = predicate({ order, event });
          return reason
            ? { summary: `${event.activity}: ${reason}`, evidence: { activity: event.activity, eventLine: event.line } }
            : null;
        })
        .filter(Boolean);
    },
  };
};
