#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcile, projectRoot } from '../src/reconcile/run.js';
import { MUTATIONS, applyMutation } from '../src/reconcile/mutations.js';

const ORDERS = join(projectRoot, 'data', 'orders.csv');
const EVENTS = join(projectRoot, 'data', 'analytics_event_log.csv');

// Fixed clock so date rules are deterministic.
const NOW = new Date('2026-10-01T12:00:00Z');

const fingerprint = (finding) => `${finding.ruleId}::${finding.cases.join(',')}`;

const ordersCsv = readFileSync(ORDERS, 'utf8');
const eventsCsv = readFileSync(EVENTS, 'utf8');

const flagged = (run) => [...run.defects, ...run.observations].map(fingerprint);
const baseline = new Set(flagged(reconcile({ now: NOW })));

const workDir = mkdtempSync(join(tmpdir(), 'o2c-mutation-'));
const results = [];

try {
  for (const mutation of MUTATIONS) {
    const mutated = applyMutation(mutation, { ordersCsv, eventsCsv });
    const ordersPath = join(workDir, `${mutation.id}-orders.csv`);
    const eventsPath = join(workDir, `${mutation.id}-events.csv`);
    writeFileSync(ordersPath, mutated.ordersCsv, 'utf8');
    writeFileSync(eventsPath, mutated.eventsCsv, 'utf8');

    const run = reconcile({ ordersPath, eventsPath, now: NOW });
    const introduced = flagged(run).filter((fp) => !baseline.has(fp));
    const wanted = `${mutation.expect.ruleId}::${mutation.expect.caseId}`;

    results.push({
      id: mutation.id,
      describes: mutation.describes,
      expected: wanted,
      caught: introduced.includes(wanted),
      introduced,
      erroredRules: run.errors.length,
    });
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

const killed = results.filter((r) => r.caught);
const survived = results.filter((r) => !r.caught);
const line = '-'.repeat(78);

console.log(line);
console.log('Mutation testing - does the suite still detect what it claims to detect?');
console.log(line);

for (const result of results) {
  const mark = result.caught ? 'KILLED  ' : 'SURVIVED';
  console.log(`[${mark}] ${result.id}  ${result.describes}`);
  console.log(`            expected ${result.expected}`);
  if (!result.caught) {
    console.log(`            introduced instead: ${result.introduced.join(', ') || '(nothing)'}`);
  }
}

console.log(line);
console.log(`${killed.length}/${results.length} mutations detected.`);
if (survived.length) {
  console.log(`${survived.length} survived - the suite has a blind spot for: ${survived.map((r) => r.describes).join('; ')}`);
}
console.log(line);

process.exit(survived.length === 0 ? 0 : 1);
