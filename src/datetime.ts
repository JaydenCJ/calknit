/**
 * Calendar date/time handling without JS Date. iCalendar values are kept
 * exactly as written ({y,m,d[,h,mi,s]} plus UTC/TZID markers) and all
 * arithmetic is pure Gregorian math. This keeps merging deterministic
 * across host timezones: calknit never converts through the machine's
 * local clock.
 */

import { paramValue } from "./parse.js";
import { normalizeTzid } from "./tzalias.js";
import { DateTime, ParseError, Property } from "./types.js";

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATETIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

/** Parse a DATE or DATE-TIME property value, honoring VALUE= and TZID=. */
export function parseDateTimeProperty(prop: Property): DateTime {
  const tzid = paramValue(prop, "TZID");
  const valueType = paramValue(prop, "VALUE");
  return parseDateTimeValue(prop.value, tzid, valueType);
}

/** Parse one DATE or DATE-TIME string (`20260712` / `20260712T093000[Z]`). */
export function parseDateTimeValue(
  raw: string,
  tzid: string | null,
  valueType: string | null
): DateTime {
  const value = raw.trim();
  const dm = DATE_RE.exec(value);
  if (dm && valueType?.toUpperCase() !== "DATE-TIME") {
    const dt: DateTime = { kind: "date", y: num(dm[1]!), m: num(dm[2]!), d: num(dm[3]!) };
    validateYmd(dt.y, dt.m, dt.d, value);
    return dt;
  }
  const tm = DATETIME_RE.exec(value);
  if (tm) {
    const utc = tm[7] === "Z";
    const dt: DateTime = {
      kind: "datetime",
      y: num(tm[1]!),
      m: num(tm[2]!),
      d: num(tm[3]!),
      h: num(tm[4]!),
      mi: num(tm[5]!),
      s: num(tm[6]!),
      utc,
      tzid: utc ? null : tzid,
    };
    validateYmd(dt.y, dt.m, dt.d, value);
    if (dt.h > 23 || dt.mi > 59 || dt.s > 60) {
      throw new ParseError(`invalid time of day: ${value}`);
    }
    return dt;
  }
  throw new ParseError(`unrecognized date/date-time value: ${value}`);
}

/** Parse an RFC 5545 DURATION (`P1D`, `PT1H30M`, `-PT15M`, `P2W`) to seconds. */
export function parseDuration(raw: string): number {
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    raw.trim()
  );
  if (!m || raw.trim() === "P" || raw.trim().endsWith("T")) {
    throw new ParseError(`unrecognized duration: ${raw}`);
  }
  const sign = m[1] === "-" ? -1 : 1;
  const weeks = m[2] ? Number(m[2]) : 0;
  const days = m[3] ? Number(m[3]) : 0;
  const hours = m[4] ? Number(m[4]) : 0;
  const minutes = m[5] ? Number(m[5]) : 0;
  const seconds = m[6] ? Number(m[6]) : 0;
  const total = ((weeks * 7 + days) * 24 * 3600 + hours * 3600 + minutes * 60 + seconds) * sign;
  if (m[2] === undefined && m[3] === undefined && m[4] === undefined && m[5] === undefined && m[6] === undefined) {
    throw new ParseError(`empty duration: ${raw}`);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Gregorian arithmetic (proleptic, no timezone involvement).

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2 && isLeapYear(y)) return 29;
  return DAYS_IN_MONTH[m - 1]!;
}

/** Days since 1970-01-01 for a calendar date (negative before the epoch). */
export function epochDays(y: number, m: number, d: number): number {
  // Howard Hinnant's days_from_civil algorithm — exact for all Gregorian dates.
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of epochDays. */
export function fromEpochDays(n: number): { y: number; m: number; d: number } {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const yy = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yy + (m <= 2 ? 1 : 0), m, d };
}

/** Day of week, 0=Monday .. 6=Sunday (1970-01-01 was a Thursday). */
export function dayOfWeek(y: number, m: number, d: number): number {
  const days = epochDays(y, m, d);
  return ((days % 7) + 7 + 3) % 7;
}

/** Shift a DateTime by whole days, preserving kind, time of day and TZID. */
export function addDays(dt: DateTime, days: number): DateTime {
  const { y, m, d } = fromEpochDays(epochDays(dt.y, dt.m, dt.d) + days);
  if (dt.kind === "date") return { kind: "date", y, m, d };
  return { ...dt, y, m, d };
}

/**
 * Naive seconds since the epoch, ignoring timezone: what the wall clock
 * reads. Used for ordering, duration math between same-zone endpoints,
 * and horizon bounds — never presented as an absolute instant.
 */
export function naiveSeconds(dt: DateTime): number {
  const days = epochDays(dt.y, dt.m, dt.d);
  if (dt.kind === "date") return days * 86400;
  return days * 86400 + dt.h * 3600 + dt.mi * 60 + dt.s;
}

/**
 * Duration in seconds between two endpoints of the same event. Wall-clock
 * arithmetic: exact when both ends share a zone (the overwhelmingly
 * common case for feed duplicates), approximate across zones.
 */
export function durationBetween(start: DateTime, end: DateTime): number {
  return naiveSeconds(end) - naiveSeconds(start);
}

/**
 * The identity key of a start value. Same key <=> the two values are the
 * same point on the same clock:
 *   date:20260712                        all-day
 *   utc:20260712T133000                  absolute (Z)
 *   local:20260712T093000@america/new_york   zoned (TZID normalized)
 *   local:20260712T093000@floating       floating
 */
export function dateTimeKey(dt: DateTime): string {
  const day = `${pad(dt.y, 4)}${pad(dt.m, 2)}${pad(dt.d, 2)}`;
  if (dt.kind === "date") return `date:${day}`;
  const time = `${pad(dt.h, 2)}${pad(dt.mi, 2)}${pad(dt.s, 2)}`;
  if (dt.utc) return `utc:${day}T${time}`;
  const zone = dt.tzid === null ? "floating" : normalizeTzid(dt.tzid);
  return `local:${day}T${time}@${zone}`;
}

/** Format a DateTime back to its iCalendar value string. */
export function formatDateTimeValue(dt: DateTime): string {
  const day = `${pad(dt.y, 4)}${pad(dt.m, 2)}${pad(dt.d, 2)}`;
  if (dt.kind === "date") return day;
  const time = `${pad(dt.h, 2)}${pad(dt.mi, 2)}${pad(dt.s, 2)}`;
  return `${day}T${time}${dt.utc ? "Z" : ""}`;
}

/** Human-oriented rendering for reports: `2026-07-12 09:30 @Europe/Berlin`. */
export function describeDateTime(dt: DateTime): string {
  const day = `${pad(dt.y, 4)}-${pad(dt.m, 2)}-${pad(dt.d, 2)}`;
  if (dt.kind === "date") return `${day} (all day)`;
  const time = `${pad(dt.h, 2)}:${pad(dt.mi, 2)}`;
  if (dt.utc) return `${day} ${time} UTC`;
  if (dt.tzid === null) return `${day} ${time}`;
  return `${day} ${time} @${dt.tzid}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function num(s: string): number {
  return Number(s);
}

function validateYmd(y: number, m: number, d: number, raw: string): void {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new ParseError(`invalid calendar date: ${raw}`);
  }
}
