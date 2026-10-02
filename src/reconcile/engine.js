/**
 * The rule executor.
 *
 * Every rule is a declaration: what it checks, which contract clause it enforces, what it iterates
 * over, and how severe a breach is. The engine owns iteration, error containment and finding
 * shape; a rule owns only its predicate. That split is the point - it is what lets a new defect
 * class be added as data rather than as control flow, and it is what gives the LLM in ai/ a fixed
 * target schema to emit against.
 *
 * A rule that throws is reported as an errored rule, never as a pass. A validation suite that goes
 * green because a check crashed is worse than no check at all.
 */

export const SEVERITY = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info',
};

const SEVERITY_ORDER = [
  SEVERITY.CRITICAL,
  SEVERITY.HIGH,
  SEVERITY.MEDIUM,
  SEVERITY.LOW,
  SEVERITY.INFO,
];

export const SCOPE = {
  DATASET: 'dataset',
  ORDER: 'order',
  CASE: 'case',
  PAIR: 'pair',
};

const subjectsFor = (scope, model) => {
  switch (scope) {
    case SCOPE.DATASET:
      return [{ label: 'dataset', subject: model }];
    case SCOPE.ORDER:
      return model.orders.map((order) => ({ label: order.orderId, subject: order }));
    case SCOPE.CASE:
      return [...model.caseById.values()].map((c) => ({ label: c.caseId, subject: c }));
    case SCOPE.PAIR:
      return model.pairs.map((pair) => ({ label: pair.id, subject: pair }));
    default:
      throw new Error(`unknown rule scope: ${scope}`);
  }
};

const normaliseResult = (result) => {
  if (!result) return [];
  return Array.isArray(result) ? result.filter(Boolean) : [result];
};

export const runRules = (rules, model) => {
  const findings = [];
  const errors = [];
  const executed = [];

  for (const rule of rules) {
    let subjects;
    try {
      subjects = subjectsFor(rule.scope, model);
    } catch (error) {
      errors.push({ ruleId: rule.id, phase: 'scope', message: error.message });
      continue;
    }

    let raised = 0;
    for (const { label, subject } of subjects) {
      try {
        for (const violation of normaliseResult(rule.evaluate(subject, model))) {
          raised++;
          findings.push({
            ruleId: rule.id,
            dimension: rule.dimension,
            severity: violation.severity ?? rule.severity,
            title: rule.title,
            contract: rule.contract,
            detection: rule.detection,
            cases: violation.cases ?? [label],
            summary: violation.summary,
            evidence: violation.evidence ?? {},
            classification: violation.classification ?? 'defect',
          });
        }
      } catch (error) {
        errors.push({ ruleId: rule.id, phase: 'evaluate', subject: label, message: error.message });
      }
    }

    executed.push({ id: rule.id, dimension: rule.dimension, subjects: subjects.length, raised });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.ruleId.localeCompare(b.ruleId) ||
      String(a.cases[0]).localeCompare(String(b.cases[0])),
  );

  return { findings, errors, executed, ruleCount: rules.length };
};

/**
 * Groups findings that share a subject.
 *
 * ORD-1010 trips three rules - a transposed delivery timestamp, a non-conformant trace, and a
 * negative step duration - but there is one bug behind all three. Reporting it as three defects
 * would overstate the count and invite the fair criticism that the suite cannot tell distinct bugs
 * apart. Keeping every rule hit but presenting them grouped gives both numbers honestly: how many
 * things are broken, and how many independent checks noticed.
 */
export const groupByRootCause = (findings) => {
  const groups = new Map();

  for (const finding of findings) {
    const key = finding.cases.join('+');
    if (!groups.has(key)) {
      groups.set(key, { cases: finding.cases, findings: [], dimensions: new Set(), ruleIds: [] });
    }
    const group = groups.get(key);
    group.findings.push(finding);
    group.dimensions.add(finding.dimension);
    group.ruleIds.push(finding.ruleId);
  }

  return [...groups.values()]
    .map((group) => ({
      cases: group.cases,
      ruleIds: [...new Set(group.ruleIds)],
      dimensions: [...group.dimensions],
      severity: SEVERITY_ORDER.find((s) => group.findings.some((f) => f.severity === s)),
      findings: group.findings,
      corroborated: group.findings.length > 1,
    }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        String(a.cases[0]).localeCompare(String(b.cases[0])),
    );
};

export const summarise = ({ findings, errors, executed, ruleCount }) => {
  const defects = findings.filter((f) => f.classification === 'defect');
  const observations = findings.filter((f) => f.classification === 'observation');

  const bySeverity = SEVERITY_ORDER.reduce((acc, severity) => {
    const count = defects.filter((f) => f.severity === severity).length;
    if (count) acc[severity] = count;
    return acc;
  }, {});

  const byDimension = defects.reduce((acc, f) => {
    acc[f.dimension] = (acc[f.dimension] ?? 0) + 1;
    return acc;
  }, {});

  return {
    ruleCount,
    rulesRaising: executed.filter((r) => r.raised > 0).length,
    distinctDefects: groupByRootCause(defects).length,
    ruleViolations: defects.length,
    defectCount: defects.length,
    observationCount: observations.length,
    affectedCases: [...new Set(defects.flatMap((f) => f.cases))].sort(),
    bySeverity,
    byDimension,
    erroredRules: errors.length,
  };
};
