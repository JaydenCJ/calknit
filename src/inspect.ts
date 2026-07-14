/**
 * Per-feed statistics for `calknit inspect`: what a feed contains before
 * any merging happens. Useful for sizing up calendar sprawl and for
 * sanity-checking a feed a merge is about to consume.
 */

import { describeDateTime, naiveSeconds } from "./datetime.js";
import { extractEvents } from "./event.js";
import { findProperty } from "./parse.js";
import { parseFeed } from "./parse.js";
import { unescapeText } from "./text.js";
import { CalEvent } from "./types.js";

export interface FeedStats {
  name: string;
  calname: string | null;
  events: number;
  /** Recurring masters (RRULE present). */
  series: number;
  /** Detached overrides (RECURRENCE-ID present). */
  overrides: number;
  /** Plain one-off events. */
  singles: number;
  /** TZIDs defined by VTIMEZONE components, sorted. */
  timezones: string[];
  earliest: string | null;
  latest: string | null;
  warnings: string[];
}

/** Compute statistics for one feed. */
export function inspectFeed(name: string, text: string): FeedStats {
  const parsed = parseFeed(text, name);
  const extracted = extractEvents(parsed.calendars, 0, name);
  const warnings = [...parsed.warnings, ...extracted.warnings];

  let calname: string | null = null;
  for (const cal of parsed.calendars) {
    const prop = findProperty(cal, "X-WR-CALNAME");
    if (prop) {
      calname = unescapeText(prop.value);
      break;
    }
  }

  const timezones = new Set<string>();
  for (const tz of extracted.timezones) {
    const idProp = findProperty(tz, "TZID");
    if (idProp) timezones.add(idProp.value.trim());
  }

  let series = 0;
  let overrides = 0;
  let singles = 0;
  let earliest: CalEvent | null = null;
  let latest: CalEvent | null = null;
  for (const ev of extracted.events) {
    if (ev.rrule !== null || ev.rruleRaw !== null) series++;
    else if (ev.recurrenceId !== null) overrides++;
    else singles++;
    if (ev.start !== null) {
      if (earliest === null || naiveSeconds(ev.start) < naiveSeconds(earliest.start!)) {
        earliest = ev;
      }
      if (latest === null || naiveSeconds(ev.start) > naiveSeconds(latest.start!)) {
        latest = ev;
      }
    }
  }

  return {
    name,
    calname,
    events: extracted.events.length,
    series,
    overrides,
    singles,
    timezones: [...timezones].sort(),
    earliest: earliest ? describeDateTime(earliest.start!) : null,
    latest: latest ? describeDateTime(latest.start!) : null,
    warnings,
  };
}
