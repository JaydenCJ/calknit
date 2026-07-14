/**
 * RRULE parsing, canonicalization and bounded expansion. Expansion is the
 * engine behind recurrence-aware dedupe: it lets calknit prove that a
 * standalone "Team sync, 2026-08-03 09:30" in one feed is occurrence #4
 * of a weekly series in another.
 *
 * Supported for expansion: FREQ=DAILY/WEEKLY/MONTHLY/YEARLY with
 * INTERVAL, COUNT, UNTIL, BYDAY (ordinals in MONTHLY/YEARLY), BYMONTHDAY
 * (negatives allowed), BYMONTH, BYSETPOS and WKST. Rules using parts
 * beyond that (BYHOUR, BYWEEKNO, ...) still parse and still merge by
 * exact rule equality — they are just never expanded, so calknit will
 * not silently guess occurrences it cannot compute.
 */

import {
  dayOfWeek,
  daysInMonth,
  epochDays,
  formatDateTimeValue,
  fromEpochDays,
  naiveSeconds,
  parseDateTimeValue,
} from "./datetime.js";
import { DateTime, ParseError, RRule } from "./types.js";

const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const FREQS = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
/** Parts that parse but disable expansion (calknit will not guess). */
const KNOWN_UNSUPPORTED = new Set([
  "BYSECOND",
  "BYMINUTE",
  "BYHOUR",
  "BYWEEKNO",
  "BYYEARDAY",
  "FREQ:SECONDLY",
  "FREQ:MINUTELY",
  "FREQ:HOURLY",
]);

/** Parse an RRULE property value. Throws ParseError on structural garbage. */
export function parseRRule(value: string): RRule {
  const rule: RRule = {
    freq: "DAILY",
    interval: 1,
    count: null,
    until: null,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    bySetPos: [],
    wkst: 0,
    unsupported: [],
  };
  let sawFreq = false;

  for (const part of value.split(";")) {
    if (part.trim() === "") continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new ParseError(`malformed RRULE part: ${part}`);
    const key = part.slice(0, eq).trim().toUpperCase();
    const val = part.slice(eq + 1).trim();
    switch (key) {
      case "FREQ": {
        const freq = val.toUpperCase();
        if (FREQS.has(freq)) {
          rule.freq = freq as RRule["freq"];
        } else if (KNOWN_UNSUPPORTED.has(`FREQ:${freq}`)) {
          rule.unsupported.push(`FREQ=${freq}`);
        } else {
          throw new ParseError(`unknown RRULE FREQ: ${val}`);
        }
        sawFreq = true;
        break;
      }
      case "INTERVAL":
        rule.interval = positiveInt(val, "INTERVAL");
        break;
      case "COUNT":
        rule.count = positiveInt(val, "COUNT");
        break;
      case "UNTIL":
        rule.until = parseDateTimeValue(val, null, null);
        break;
      case "BYDAY":
        rule.byDay = val.split(",").map(parseByDay);
        break;
      case "BYMONTHDAY":
        rule.byMonthDay = val.split(",").map((v) => boundedInt(v, "BYMONTHDAY", 31));
        break;
      case "BYMONTH":
        rule.byMonth = val.split(",").map((v) => positiveInt(v, "BYMONTH", 12));
        break;
      case "BYSETPOS":
        rule.bySetPos = val.split(",").map((v) => boundedInt(v, "BYSETPOS", 366));
        break;
      case "WKST": {
        const idx = DAY_CODES.indexOf(val.toUpperCase() as (typeof DAY_CODES)[number]);
        if (idx < 0) throw new ParseError(`unknown RRULE WKST: ${val}`);
        rule.wkst = idx;
        break;
      }
      default:
        rule.unsupported.push(`${key}=${val.toUpperCase()}`);
        break;
    }
  }
  if (!sawFreq) throw new ParseError(`RRULE missing FREQ: ${value}`);
  // Ordinal BYDAY is only defined for MONTHLY and YEARLY.
  if (rule.byDay.some((b) => b.ord !== 0) && (rule.freq === "DAILY" || rule.freq === "WEEKLY")) {
    rule.unsupported.push("BYDAY-ORDINAL");
  }
  return rule;
}

/**
 * A canonical, order-independent rendering of a rule. Two series merge as
 * the same recurrence only when their canonical forms are equal, so
 * `FREQ=WEEKLY;BYDAY=WE,MO` and `BYDAY=MO,WE;FREQ=WEEKLY;INTERVAL=1`
 * compare equal while genuinely different rules never do.
 */
export function canonicalRRule(rule: RRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== null) parts.push(`UNTIL=${formatDateTimeValue(rule.until)}`);
  if (rule.byMonth.length > 0) parts.push(`BYMONTH=${[...rule.byMonth].sort(cmpNum).join(",")}`);
  if (rule.byMonthDay.length > 0)
    parts.push(`BYMONTHDAY=${[...rule.byMonthDay].sort(cmpNum).join(",")}`);
  if (rule.byDay.length > 0) {
    const days = [...rule.byDay]
      .sort((a, b) => a.ord - b.ord || a.day - b.day)
      .map((b) => `${b.ord === 0 ? "" : b.ord}${DAY_CODES[b.day]}`);
    parts.push(`BYDAY=${days.join(",")}`);
  }
  if (rule.bySetPos.length > 0) parts.push(`BYSETPOS=${[...rule.bySetPos].sort(cmpNum).join(",")}`);
  if (rule.wkst !== 0) parts.push(`WKST=${DAY_CODES[rule.wkst]}`);
  for (const u of [...rule.unsupported].sort()) parts.push(u);
  return parts.join(";");
}

/** True when calknit can enumerate this rule's occurrences. */
export function isExpandable(rule: RRule): boolean {
  return rule.unsupported.length === 0;
}

export interface ExpandOptions {
  /** Stop once occurrences pass this naive-seconds bound. */
  untilNaive: number;
  /** Hard cap on generated occurrences (safety valve). */
  maxOccurrences: number;
}

/**
 * Enumerate occurrences of `rule` anchored at `start`, in ascending
 * order, bounded by COUNT, UNTIL, `opts.untilNaive` and
 * `opts.maxOccurrences`. DTSTART is always the first occurrence (RFC
 * 5545 counts it even when it does not match the pattern). Returns null
 * when the rule is not expandable.
 */
export function expandOccurrences(
  start: DateTime,
  rule: RRule,
  opts: ExpandOptions
): DateTime[] | null {
  if (!isExpandable(rule)) return null;

  const startDay = epochDays(start.y, start.m, start.d);
  const untilNaive = ruleUntilNaive(start, rule, opts.untilNaive);
  const out: DateTime[] = [];
  const seen = new Set<number>();

  const push = (day: number): boolean => {
    // Returns false when the enumeration is complete.
    if (day < startDay || seen.has(day)) return true;
    const occ = onDay(start, day);
    if (naiveSeconds(occ) > untilNaive) return false;
    seen.add(day);
    out.push(occ);
    if (rule.count !== null && out.length >= rule.count) return false;
    if (out.length >= opts.maxOccurrences) return false;
    return true;
  };

  // DTSTART is occurrence #1 unconditionally.
  if (!push(startDay)) return out;

  const maxPeriods = 40000; // safety valve against degenerate rules
  switch (rule.freq) {
    case "DAILY": {
      for (let i = 1, day = startDay + rule.interval; i < maxPeriods; i++, day += rule.interval) {
        const { y, m, d } = fromEpochDays(day);
        if (naiveSeconds(onDay(start, day)) > untilNaive) return out;
        if (rule.byMonth.length > 0 && !rule.byMonth.includes(m)) continue;
        if (rule.byMonthDay.length > 0 && !matchesMonthDay(rule.byMonthDay, y, m, d)) continue;
        if (rule.byDay.length > 0 && !rule.byDay.some((b) => b.day === dayOfWeek(y, m, d)))
          continue;
        if (!push(day)) return out;
      }
      return out;
    }
    case "WEEKLY": {
      const startDow = dayOfWeek(start.y, start.m, start.d);
      const weekAnchor = startDay - ((startDow - rule.wkst + 7) % 7);
      const days = rule.byDay.length > 0 ? rule.byDay.map((b) => b.day) : [startDow];
      for (let week = 0; week < maxPeriods; week++) {
        const anchor = weekAnchor + week * rule.interval * 7;
        const candidates = days
          .map((dow) => anchor + ((dow - rule.wkst + 7) % 7))
          .sort(cmpNum);
        if (candidates.length > 0 && anchorBeyond(candidates[0]!, start, untilNaive)) return out;
        for (const day of candidates) {
          const { y: _y, m } = fromEpochDays(day);
          if (rule.byMonth.length > 0 && !rule.byMonth.includes(m)) continue;
          if (!push(day)) return out;
        }
      }
      return out;
    }
    case "MONTHLY": {
      for (let i = 0; i < maxPeriods; i++) {
        const total = (start.y * 12 + (start.m - 1)) + i * rule.interval;
        const y = Math.floor(total / 12);
        const m = (total % 12) + 1;
        if (rule.byMonth.length > 0 && !rule.byMonth.includes(m)) {
          if (anchorBeyond(epochDays(y, m, 1), start, untilNaive)) return out;
          continue;
        }
        const candidates = monthCandidates(rule, y, m, start.d);
        if (anchorBeyond(epochDays(y, m, 1), start, untilNaive)) return out;
        for (const day of applySetPos(candidates, rule.bySetPos)) {
          if (!push(day)) return out;
        }
      }
      return out;
    }
    case "YEARLY": {
      for (let i = 0; i < maxPeriods; i++) {
        const y = start.y + i * rule.interval;
        if (anchorBeyond(epochDays(y, 1, 1), start, untilNaive)) return out;
        const months =
          rule.byMonth.length > 0
            ? [...rule.byMonth].sort(cmpNum)
            : rule.byDay.length > 0 && rule.byMonthDay.length === 0
              ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
              : [start.m];
        let candidates: number[] = [];
        if (rule.byDay.some((b) => b.ord !== 0) && rule.byMonth.length === 0) {
          // Nth weekday of the *year* (e.g. BYDAY=20MO with FREQ=YEARLY).
          candidates = yearDayCandidates(rule, y);
        } else {
          for (const m of months) {
            candidates = candidates.concat(monthCandidates(rule, y, m, start.d));
          }
        }
        for (const day of applySetPos(candidates.sort(cmpNum), rule.bySetPos)) {
          if (!push(day)) return out;
        }
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------------------

function parseByDay(token: string): { ord: number; day: number } {
  const m = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(token.trim());
  if (!m) throw new ParseError(`unknown RRULE BYDAY token: ${token}`);
  const ord = m[1] ? Number(m[1]) : 0;
  if (ord !== 0 && (Math.abs(ord) < 1 || Math.abs(ord) > 53)) {
    throw new ParseError(`RRULE BYDAY ordinal out of range: ${token}`);
  }
  return { ord, day: DAY_CODES.indexOf(m[2]!.toUpperCase() as (typeof DAY_CODES)[number]) };
}

/** Candidate epoch-days inside one month, per the MONTHLY/YEARLY rules. */
function monthCandidates(rule: RRule, y: number, m: number, startDom: number): number[] {
  const dim = daysInMonth(y, m);
  let days: number[];

  if (rule.byMonthDay.length > 0) {
    days = rule.byMonthDay
      .map((md) => (md > 0 ? md : dim + 1 + md))
      .filter((d) => d >= 1 && d <= dim);
  } else if (rule.byDay.length > 0) {
    days = [];
  } else {
    // Plain monthly: same day-of-month as DTSTART; months lacking it skip.
    return startDom <= dim ? [epochDays(y, m, startDom)] : [];
  }

  if (rule.byDay.length > 0) {
    const byDayDays: number[] = [];
    for (const b of rule.byDay) {
      const matches: number[] = [];
      for (let d = 1; d <= dim; d++) {
        if (dayOfWeek(y, m, d) === b.day) matches.push(d);
      }
      if (b.ord === 0) byDayDays.push(...matches);
      else {
        const pick = b.ord > 0 ? matches[b.ord - 1] : matches[matches.length + b.ord];
        if (pick !== undefined) byDayDays.push(pick);
      }
    }
    days =
      rule.byMonthDay.length > 0
        ? days.filter((d) => byDayDays.includes(d))
        : byDayDays;
  }

  return [...new Set(days)].sort(cmpNum).map((d) => epochDays(y, m, d));
}

/** Nth-weekday-of-year candidates for YEARLY;BYDAY with ordinals. */
function yearDayCandidates(rule: RRule, y: number): number[] {
  const first = epochDays(y, 1, 1);
  const last = epochDays(y, 12, 31);
  const out: number[] = [];
  for (const b of rule.byDay) {
    const matches: number[] = [];
    for (let day = first; day <= last; day++) {
      const { y: yy, m, d } = fromEpochDays(day);
      if (dayOfWeek(yy, m, d) === b.day) matches.push(day);
    }
    if (b.ord === 0) out.push(...matches);
    else {
      const pick = b.ord > 0 ? matches[b.ord - 1] : matches[matches.length + b.ord];
      if (pick !== undefined) out.push(pick);
    }
  }
  return [...new Set(out)].sort(cmpNum);
}

/** BYSETPOS selects the nth candidates (1-based; negative from the end). */
function applySetPos(candidates: number[], setPos: number[]): number[] {
  if (setPos.length === 0) return candidates;
  const out: number[] = [];
  for (const pos of setPos) {
    const pick = pos > 0 ? candidates[pos - 1] : candidates[candidates.length + pos];
    if (pick !== undefined) out.push(pick);
  }
  return [...new Set(out)].sort(cmpNum);
}

function matchesMonthDay(byMonthDay: number[], y: number, m: number, d: number): boolean {
  const dim = daysInMonth(y, m);
  return byMonthDay.some((md) => (md > 0 ? md === d : dim + 1 + md === d));
}

/** Rebuild an occurrence DateTime on a given epoch-day. */
function onDay(start: DateTime, day: number): DateTime {
  const { y, m, d } = fromEpochDays(day);
  if (start.kind === "date") return { kind: "date", y, m, d };
  return { ...start, y, m, d };
}

/** True when a period anchored at `day` starts past the horizon. */
function anchorBeyond(day: number, start: DateTime, untilNaive: number): boolean {
  return naiveSeconds(onDay(start, day)) > untilNaive;
}

/** Combine RRULE UNTIL with the caller's horizon into one naive bound. */
function ruleUntilNaive(start: DateTime, rule: RRule, horizon: number): number {
  if (rule.until === null) return horizon;
  let u = naiveSeconds(rule.until);
  if (rule.until.kind === "date" && start.kind === "datetime") {
    u += 86399; // a DATE UNTIL against a timed start covers that whole day
  }
  return Math.min(u, horizon);
}

/** Parse a strictly positive integer rule part, optionally bounded. */
function positiveInt(value: string, part: string, max?: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    throw new ParseError(`RRULE ${part} out of range: ${value}`);
  }
  return n;
}

/** Parse a nonzero integer in [-max, max] (BYMONTHDAY, BYSETPOS). */
function boundedInt(value: string, part: string, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n === 0 || Math.abs(n) > max) {
    throw new ParseError(`RRULE ${part} out of range: ${value}`);
  }
  return n;
}

function cmpNum(a: number, b: number): number {
  return a - b;
}

export { DAY_CODES };
