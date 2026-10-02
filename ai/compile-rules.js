#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { complete, extractJsonArray, DEFAULT_MODEL } from './llm.js';
import { buildPrompt } from './prompt.js';
import { compileSpec, validateSpec } from './dsl.js';
import { verifyRule } from './fixtures/labelled.js';
import { reconcile } from '../src/reconcile/run.js';
import { allRules } from '../src/rules/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes('--live');
const line = '-'.repeat(78);

const prompt = buildPrompt();
const response = await complete({ prompt, live, label: 'rule-candidates', model: DEFAULT_MODEL });

let candidates;
try {
  candidates = extractJsonArray(response.text);
} catch (error) {
  console.error(`Could not parse the model response: ${error.message}`);
  console.error('Treated as a failed batch. No rules accepted.');
  process.exit(1);
}

console.log(line);
console.log(`Contract-to-rules compiler  (model: ${response.model}, source: ${response.source})`);
console.log(line);
console.log(`${candidates.length} candidate rule(s) proposed. Each must now earn its place.`);
console.log('');

const accepted = [];
const rejected = [];
const quarantined = [];

for (const spec of candidates) {
  const problems = validateSpec(spec);
  if (problems.length) {
    rejected.push({ spec, stage: 'schema', reasons: problems });
    console.log(`REJECTED   ${spec.id ?? '(no id)'}  ${spec.title ?? ''}`);
    console.log(`           schema: ${problems.join('; ')}`);
    console.log('');
    continue;
  }

  let rule;
  try {
    rule = compileSpec(spec);
  } catch (error) {
    rejected.push({ spec, stage: 'compile', reasons: [error.message] });
    console.log(`REJECTED   ${spec.id}  ${spec.title}`);
    console.log(`           compile: ${error.message}`);
    console.log('');
    continue;
  }

  const verification = verifyRule(rule);

  if (verification.verdict === 'accepted') {
    accepted.push({ spec, rule, verification });
    console.log(`ACCEPTED   ${spec.id}  ${spec.title}`);
    console.log(`           caught: ${verification.detected.join('; ')}`);
  } else if (verification.verdict === 'needs-fixture') {
    quarantined.push({ spec, rule, verification });
    console.log(`QUARANTINE ${spec.id}  ${spec.title}`);
    console.log(`           ${verification.reasons.join('; ')}`);
  } else {
    rejected.push({ spec, stage: 'verification', reasons: verification.reasons });
    console.log(`REJECTED   ${spec.id}  ${spec.title}`);
    console.log(`           ${verification.reasons.join('; ')}`);
  }
  console.log('');
}

console.log(line);
console.log(
  `${accepted.length} accepted, ${quarantined.length} quarantined, ${rejected.length} rejected out of ${candidates.length} proposed.`,
);

// Run accepted rules against the real data alongside the hand-written ones.
if (accepted.length) {
  const baseline = new Set(
    reconcile({ now: new Date('2026-10-01T12:00:00Z') }).defects.map((f) => `${f.ruleId}::${f.cases.join(',')}`),
  );
  const withGenerated = reconcile({
    rules: [...allRules, ...accepted.map((a) => a.rule)],
    now: new Date('2026-10-01T12:00:00Z'),
  });
  const novel = withGenerated.defects.filter(
    (f) => !baseline.has(`${f.ruleId}::${f.cases.join(',')}`),
  );

  console.log(line);
  if (novel.length === 0) {
    console.log('Accepted rules found nothing the hand-written rules had not already found.');
    console.log('That is a real outcome, not a failure: it means the existing coverage holds for this dataset.');
  } else {
    console.log(`Accepted rules surfaced ${novel.length} finding(s) the hand-written rules missed:`);
    for (const finding of novel) {
      console.log(`  ${finding.ruleId}  ${finding.cases.join(', ')}  ${finding.summary}`);
    }
  }
}

const outPath = join(here, 'generated-rules.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      model: response.model,
      source: response.source,
      accepted: accepted.map((a) => ({ ...a.spec, verification: a.verification })),
      quarantined: quarantined.map((q) => ({ ...q.spec, verification: q.verification })),
      rejected: rejected.map((r) => ({ id: r.spec?.id, title: r.spec?.title, stage: r.stage, reasons: r.reasons })),
    },
    null,
    2,
  ),
  'utf8',
);

console.log(line);
console.log(`Full audit written to ${outPath}`);
console.log(line);
