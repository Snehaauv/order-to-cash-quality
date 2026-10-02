#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconcile, projectRoot } from '../src/reconcile/run.js';
import { renderDefectReport } from '../src/reconcile/report.js';

const args = process.argv.slice(2);
const wantsJson = args.includes('--json');
const wantsReport = args.includes('--write-report');
const frozenClock = args.find((a) => a.startsWith('--now='))?.split('=')[1];

const result = reconcile(frozenClock ? { now: new Date(frozenClock) } : {});

if (wantsJson) {
  const payload = {
    generatedAt: result.model.now.toISOString(),
    summary: result.summary,
    defects: result.defects,
    observations: result.observations,
    erroredRules: result.errors,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  const { summary } = result;
  const line = '-'.repeat(78);

  console.log(line);
  console.log('OMS -> Analytics reconciliation');
  console.log(line);
  console.log(
    `source: ${result.model.counts.orders} orders | target: ${result.model.counts.events} events across ${result.model.counts.cases} cases`,
  );
  console.log(`rules: ${summary.ruleCount} executed, ${summary.rulesRaising} raised at least one finding`);
  console.log(
    `defects: ${summary.distinctDefects} distinct (${summary.ruleViolations} rule violations)   observations: ${summary.observationCount}   errored rules: ${summary.erroredRules}`,
  );
  console.log(`severity: ${Object.entries(summary.bySeverity).map(([k, v]) => `${k} ${v}`).join('  ') || 'none'}`);
  console.log(line);

  for (const finding of result.defects) {
    console.log(`[${finding.severity.toUpperCase().padEnd(8)}] ${finding.ruleId.padEnd(19)}  ${finding.cases.join(', ')}`);
    console.log(`            ${finding.dimension} - ${finding.summary}`);
  }

  if (result.observations.length) {
    console.log(line);
    console.log('Observations (not defects):');
    for (const finding of result.observations) {
      console.log(`[${'INFO'.padEnd(8)}] ${finding.ruleId.padEnd(19)}  ${finding.cases.join(', ')}  ${finding.summary}`);
    }
  }

  if (result.errors.length) {
    console.log(line);
    console.log('Rules that failed to execute (treated as failures, never as passes):');
    for (const error of result.errors) {
      console.log(`  ${error.ruleId} [${error.phase}] ${error.subject ?? ''} ${error.message}`);
    }
  }

  console.log(line);
}

if (wantsReport) {
  const path = join(projectRoot, 'DEFECT_REPORT.md');
  writeFileSync(path, renderDefectReport(result), 'utf8');
  console.log(`wrote ${path}`);
}

process.exit(result.errors.length > 0 ? 2 : 0);
