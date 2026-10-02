import { test, expect } from '../../framework/fixtures/index.js';
import { allRules } from '../../src/rules/index.js';
import { groupByRootCause } from '../../src/reconcile/engine.js';

/**
 * The data layer runs inside Playwright rather than as a separate script, so all three layers -
 * UI, API, data - land in one HTML report. A reviewer opens one artifact and sees the whole picture
 * instead of correlating a test report with a CLI log.
 *
 * Tests are generated from the rule inventory rather than written per rule. Adding a rule to
 * src/rules automatically adds a test; it is impossible to write a rule and forget to assert on it,
 * which is the usual way a check ends up in a suite without ever being exercised.
 */

test.describe('OMS to Analytics reconciliation', () => {
  test('the suite itself executed cleanly - no rule errored', async ({ reconciliation }) => {
    // Checked first and separately. A crashed rule produces no findings, which is indistinguishable
    // from a passing rule unless something asserts on it explicitly.
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

      // Attached rather than asserted away. The expected result of this suite is that known defects
      // ARE found, so a rule raising findings is a pass - the report is the deliverable, and each
      // test carries its own evidence for a reviewer reading the HTML output.
      await test.info().attach(`${rule.id}-findings.json`, {
        body: JSON.stringify({ contract: rule.contract, detection: rule.detection, raised }, null, 2),
        contentType: 'application/json',
      });

      expect(raised.every((finding) => finding.summary && finding.cases.length > 0)).toBe(true);
    });
  }

  test('known defect inventory is stable', async ({ reconciliation }) => {
    // A regression guard on the reconciler. If a refactor changes what the suite detects on fixed
    // input, this fails - which is what you want, because silent drift in a detector is invisible.
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
    // The precision half of the suite. ORD-1015 differs only by case and whitespace, ORD-1016 and
    // ORD-1020 take valid terminal branches, and ORD-1003 and ORD-1005 are mid-lifecycle. A rule
    // change that starts flagging any of them is a false-positive regression.
    const mustBeSilent = ['ORD-1001', 'ORD-1003', 'ORD-1005', 'ORD-1015', 'ORD-1016', 'ORD-1020'];
    const noisy = reconciliation.defects
      .filter((finding) => finding.cases.some((id) => mustBeSilent.includes(id)))
      .map((finding) => `${finding.ruleId} on ${finding.cases.join(',')}: ${finding.summary}`);

    expect(noisy, `false positives on cases the contract says are correct:\n${noisy.join('\n')}`).toEqual([]);
  });
});
