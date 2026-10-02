// Normalisers for cross-system string comparison. The contract compares names trimmed and case-insensitive.

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
