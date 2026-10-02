import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildModel } from '../domain/model.js';
import { allRules } from '../rules/index.js';
import { runRules, summarise } from './engine.js';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..', '..');

/**
 * `now` is injected rather than read from the system clock inside the rules. The future-timestamp
 * rule would otherwise change behaviour with the calendar, which makes a CI failure impossible to
 * reproduce later. Default is the real clock; tests and the mutation harness pin it.
 */
export const reconcile = ({
  ordersPath = join(projectRoot, 'data', 'orders.csv'),
  eventsPath = join(projectRoot, 'data', 'analytics_event_log.csv'),
  rules = allRules,
  now = new Date(),
} = {}) => {
  const model = buildModel({ ordersPath, eventsPath, now });
  const result = runRules(rules, model);

  return {
    model,
    ...result,
    summary: summarise(result),
    defects: result.findings.filter((f) => f.classification === 'defect'),
    observations: result.findings.filter((f) => f.classification === 'observation'),
  };
};
