import { CHECK_TYPES, FIELD_NAMES, NORMALISER_NAMES } from './dsl.js';
import { allRules } from '../src/rules/index.js';

export const SYNC_CONTRACT = `
Carts do not sync. Every order in any state other than Cart must have at least an Order Placed event in Analytics.
A delivered order must show the full happy-path sequence; Cancelled and Returned are valid terminal branches.
Amount and currency on every Analytics event must match the source order exactly.
All timestamps are stored in UTC. For a given order, event timestamps must be non-decreasing in happy-path order, and no timestamp may be in the future.
OrderAmount must never be negative for a valid order.
CustomerName refers to the same entity on both sides and should be compared case-insensitively and trimmed.
OrderId is the primary key in format ORD-####. CaseId is a foreign key to OrderId.
PromisedDate is the promised delivery date. DeliveredDate is empty unless Status = Delivered.
Status is one of Cart, Confirmed, Shipped, Delivered, Cancelled, Returned.
Currency is ISO-4217. OrderAmount and Amount are decimal(2).
`.trim();

// Asks the model for gaps in the existing rules, expressed in the DSL vocabulary.
export const buildPrompt = () => {
  const existing = allRules
    .map((rule) => `  ${rule.id} [${rule.dimension}] ${rule.title}`)
    .join('\n');

  return `You are reviewing the test coverage of a data reconciliation suite that validates an Order
Management System against an Analytics event log.

THE SYNC CONTRACT
${SYNC_CONTRACT}

RULES THAT ALREADY EXIST
${existing}

YOUR TASK
Identify clauses or implied invariants in the contract that NO existing rule enforces. For each gap,
emit one rule declaration. Do not re-propose anything already covered above.

You must express each rule using only this vocabulary. Anything outside it will be rejected.

  check types: ${CHECK_TYPES.join(', ')}
  field paths: ${FIELD_NAMES.join(', ')}
  normalisers: ${NORMALISER_NAMES.join(', ')}
  scope:       "order" (evaluates once per order) or "pair" (evaluates once per event)
  severity:    Critical, High, Medium, Low, Info

Check shapes:
  fieldsEqual         { "type": "fieldsEqual", "left": <path>, "right": <path>, "normalise": [<normaliser>] }
  fieldPresent        { "type": "fieldPresent", "field": <path> }
  numericNotNegative  { "type": "numericNotNegative", "field": <path> }
  valueInSet          { "type": "valueInSet", "field": <path>, "allowed": [<string>], "normalise": [<normaliser>] }
  timestampOrder      { "type": "timestampOrder", "earlier": <path>, "later": <path> }
  matchesPattern      { "type": "matchesPattern", "field": <path>, "pattern": <regex string, max 120 chars> }

Reply with a JSON array only. Each element:
{
  "id": "GEN-00n",
  "dimension": "<completeness|referential integrity|value correctness|temporal correctness|process conformance|data quality>",
  "severity": "<severity>",
  "scope": "<order|pair>",
  "title": "<one line>",
  "contract": "<the clause or invariant this enforces>",
  "rationale": "<why the gap matters>",
  "check": { ... }
}`;
};
