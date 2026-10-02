import { test, expect } from '../../framework/fixtures/index.js';
import { allRules } from '../../src/rules/index.js';
import { groupByRootCause } from '../../src/reconcile/engine.js';

// Tests are generated from the rule inventory, so every rule is asserted.

test.describe('OMS to Analytics reconciliation', () => {
  test('the suite itself executed cleanly - no rule errored', async ({ reconciliation }) => {
    // A crashed rule must fail the suite, not look like a pass.
    expect(
      reconciliation.errors,
      `rules that failed to execute: ${reconciliation.errors.map((e) => `${e.ruleId} (${e.message})`).join(', ')}`,
    ).toEqual([]);
  });

  test('every declared dimension has at least one rule', async ({ reconciliation }) => {
    const required = [
      'completeness',
      'referential integrity',
      'value correctness',
      'temporal correctness',
      'process conformance',
      'data quality',
    ];
    const covered = new Set(allRules.map((rule) => rule.dimension));
    const gaps = required.filter((dimension) => !covered.has(dimension));

    expect(gaps, `dimensions with no rule - these are blind spots: ${gaps.join(', ')}`).toEqual([]);
  });

  for (const rule of allRules) {
    test(`${rule.id} [${rule.dimension}] ${rule.title}`, async ({ reconciliation }) => {
      const raised = reconciliation.findings.filter((finding) => finding.ruleId === rule.id);

      // Findings are attached as evidence; finding the known defects is the expected result.
      await test.info().attach(`${rule.id}-findings.json`, {
        body: JSON.stringify({ contract: rule.contract, detection: rule.detection, raised }, null, 2),
        contentType: 'application/json',
      });

      expect(raised.every((finding) => finding.summary && finding.cases.length > 0)).toBe(true);
    });
  }

  test('known defect inventory is stable', async ({ reconciliation }) => {
    // Regression guard: expected findings on fixed input.
    const actual = groupByRootCause(reconciliation.defects).map((group) => group.cases.join('+'));

    expect(actual.sort()).toEqual(
      [
        'ORD-1006',
        'ORD-1007',
        'ORD-1008',
        'ORD-1009',
        'ORD-1010',
        'ORD-1011',
        'ORD-1012',
        'ORD-1013',
        'ORD-1014',
        'ORD-1018',
        'ORD-9999',
      ].sort(),
    );
  });

  test('cases the contract declares correct raise nothing', async ({ reconciliation }) => {
    // False-positive guard: cases the contract calls correct must not be flagged.
    const mustBeSilent = ['ORD-1001', 'ORD-1003', 'ORD-1005', 'ORD-1015', 'ORD-1016', 'ORD-1020'];
    const noisy = reconciliation.defects
      .filter((finding) => finding.cases.some((id) => mustBeSilent.includes(id)))
      .map((finding) => `${finding.ruleId} on ${finding.cases.join(',')}: ${finding.summary}`);

    expect(noisy, `false positives on cases the contract says are correct:\n${noisy.join('\n')}`).toEqual([]);
  });
});
