/**
 * Timestamp handling, plus the diagnosis layer that turns "these two timestamps differ" into a
 * root-cause hypothesis.
 *
 * A bare mismatch is a weak finding: it tells an engineer to go and investigate. When the delta is
 * exactly a real-world UTC offset, the mismatch is almost certainly a local wall-clock time written
 * into a field declared as UTC - a timezone handling bug in the sync, not clock drift. Classifying
 * the delta turns the finding into something actionable.
 */

export const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export const parseInstant = (raw) => {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: false, reason: 'empty' };

  const ms = Date.parse(text);
  if (Number.isNaN(ms)) return { ok: false, reason: 'unparseable', raw: text };

  return {
    ok: true,
    ms,
    raw: text,
    declaredUtc: ISO_UTC_PATTERN.test(text),
  };
};

// Offsets that exist as real zones. Half-hour and three-quarter-hour entries matter: they are the
// ones that cannot be explained away as a rounding or daylight-saving artefact.
const KNOWN_OFFSETS_MINUTES = [
  { minutes: 330, zones: 'Asia/Kolkata, Asia/Colombo' },
  { minutes: 345, zones: 'Asia/Kathmandu' },
  { minutes: 270, zones: 'Asia/Kabul' },
  { minutes: 210, zones: 'Asia/Tehran' },
  { minutes: 240, zones: 'Asia/Dubai' },
  { minutes: 480, zones: 'Asia/Singapore, Asia/Shanghai' },
  { minutes: 540, zones: 'Asia/Tokyo' },
  { minutes: 60, zones: 'Europe/Berlin (CET), Europe/London (BST)' },
  { minutes: 120, zones: 'Europe/Berlin (CEST), Europe/Athens' },
  { minutes: -300, zones: 'America/New_York (EST)' },
  { minutes: -240, zones: 'America/New_York (EDT)' },
  { minutes: -480, zones: 'America/Los_Angeles (PST)' },
  { minutes: -420, zones: 'America/Los_Angeles (PDT)' },
];

const MS_PER_MINUTE = 60_000;

export const classifyDelta = (expectedMs, actualMs) => {
  const deltaMs = actualMs - expectedMs;
  if (deltaMs === 0) return { kind: 'equal', deltaMs, deltaMinutes: 0 };

  const deltaMinutes = deltaMs / MS_PER_MINUTE;
  const match = KNOWN_OFFSETS_MINUTES.find((o) => o.minutes === deltaMinutes);

  if (match) {
    return {
      kind: 'timezone-offset',
      deltaMs,
      deltaMinutes,
      hypothesis: `delta is exactly ${formatOffset(deltaMinutes)}, the UTC offset for ${match.zones} - a local wall-clock time was almost certainly written into a field declared as UTC`,
    };
  }

  if (Number.isInteger(deltaMinutes) && Math.abs(deltaMinutes) % 60 === 0) {
    return {
      kind: 'whole-hour-shift',
      deltaMs,
      deltaMinutes,
      hypothesis: `delta is a whole number of hours (${formatOffset(deltaMinutes)}) but does not map to a common zone - check for a hard-coded offset or a daylight-saving transition`,
    };
  }

  return {
    kind: 'arbitrary-skew',
    deltaMs,
    deltaMinutes,
    hypothesis: 'delta does not correspond to a timezone offset - this looks like an independently recorded time rather than a conversion fault',
  };
};

export const formatOffset = (minutes) => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.trunc(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

export const formatDuration = (ms) => {
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
};
