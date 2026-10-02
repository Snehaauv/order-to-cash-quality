// Amounts are compared as integer minor units, never as floats.

const MINOR_UNIT_DIGITS = 2;

export const parseMinorUnits = (raw) => {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: false, reason: 'empty' };

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return { ok: false, reason: 'unparseable', raw: text };

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > MINOR_UNIT_DIGITS) {
    return { ok: false, reason: 'excess-precision', raw: text };
  }

  const padded = fraction.padEnd(MINOR_UNIT_DIGITS, '0');
  const value = Number(`${whole}${padded}`);
  return { ok: true, value: sign === '-' ? -value : value, raw: text };
};

export const formatMinorUnits = (minor) => {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(MINOR_UNIT_DIGITS, '0');
  return `${sign}${whole}.${fraction}`;
};

export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const normaliseCurrency = (raw) => String(raw ?? '').trim().toUpperCase();
