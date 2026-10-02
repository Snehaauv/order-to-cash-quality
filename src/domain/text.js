/**
 * Normalisation used before any cross-system string comparison.
 *
 * The contract states CustomerName "refers to the same entity on both sides and should be compared
 * case-insensitively and trimmed". ORD-1015 holds "VanArsdel  " in the OMS and "vanarsdel" in the
 * event log. Comparing raw values reports a defect that the contract explicitly says is not one -
 * so normalisation is not a convenience here, it is the difference between a true finding and a
 * false positive.
 *
 * Each normaliser is kept separate and named so a finding can state which transformations were
 * applied before the comparison failed. "Differs after trim and case-fold" is a defensible claim;
 * "differs" is not.
 */

export const collapseWhitespace = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const caseFold = (value) => String(value ?? '').toLowerCase();

export const normaliseName = (value) => caseFold(collapseWhitespace(value));

export const describeNormalisation = (raw, normalised) => {
  const changes = [];
  const text = String(raw ?? '');
  if (text !== text.trim()) changes.push('leading/trailing whitespace');
  if (/\s{2,}/.test(text)) changes.push('repeated inner whitespace');
  if (text.trim() !== normalised && caseFold(text.trim()) === normalised) changes.push('letter case');
  return changes;
};
