import { completenessRules } from './completeness.js';
import { referentialRules } from './referential.js';
import { valueRules } from './value.js';
import { temporalRules } from './temporal.js';
import { conformanceRules } from './conformance.js';
import { qualityRules, observationRules } from './quality.js';

export const allRules = [
  ...completenessRules,
  ...referentialRules,
  ...valueRules,
  ...temporalRules,
  ...conformanceRules,
  ...qualityRules,
  ...observationRules,
];

export const rulesById = new Map(allRules.map((rule) => [rule.id, rule]));

export const DIMENSIONS = [...new Set(allRules.map((rule) => rule.dimension))];
