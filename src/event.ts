/**
 * Extraction of typed CalEvents from a parsed VCALENDAR. Extraction is
 * forgiving: a VEVENT with an unparseable DTSTART or RRULE still enters
 * the merge (it can match by UID) — it just cannot participate in
 * fingerprint or recurrence matching, and the report says so.
 */

import {
  durationBetween,
  parseDateTimeProperty,
  parseDateTimeValue,
  parseDuration,
} from "./datetime.js";
import { findProperties, findProperty, paramValue } from "./parse.js";
import { parseRRule } from "./rrule.js";
import { unescapeText } from "./text.js";
import { CalEvent, Component, DateTime, ParseError, RRule } from "./types.js";

export interface ExtractResult {
  events: CalEvent[];
  /** VTIMEZONE components, passed through to the merged output. */
  timezones: Component[];
  warnings: string[];
}

/** Pull events and timezones out of every VCALENDAR in a parsed feed. */
export function extractEvents(
  calendars: Component[],
  feedIndex: number,
  feedName: string
): ExtractResult {
  const events: CalEvent[] = [];
  const timezones: Component[] = [];
  const warnings: string[] = [];

  for (const cal of calendars) {
    for (const comp of cal.components) {
      if (comp.name === "VTIMEZONE") {
        timezones.push(comp);
        continue;
      }
      if (comp.name !== "VEVENT") continue; // VTODO/VJOURNAL etc. pass by
      events.push(extractEvent(comp, feedIndex, feedName, warnings));
    }
  }
  return { events, timezones, warnings };
}

function extractEvent(
  comp: Component,
  feedIndex: number,
  feedName: string,
  warnings: string[]
): CalEvent {
  const uidProp = findProperty(comp, "UID");
  const uid = uidProp ? uidProp.value.trim() || null : null;
  const label = uid ?? "(no uid)";

  const start = tryDateTime(comp, "DTSTART", feedName, label, warnings);
  const end = tryDateTime(comp, "DTEND", feedName, label, warnings);
  const recurrenceId = tryDateTime(comp, "RECURRENCE-ID", feedName, label, warnings);

  let durationSeconds: number | null = null;
  const durProp = findProperty(comp, "DURATION");
  if (durProp) {
    try {
      durationSeconds = parseDuration(durProp.value);
    } catch (e) {
      warnings.push(`${feedName}: ${label}: ${message(e)}`);
    }
  } else if (start && end) {
    durationSeconds = durationBetween(start, end);
  }

  let rrule: RRule | null = null;
  let rruleRaw: string | null = null;
  const rruleProp = findProperty(comp, "RRULE");
  if (rruleProp) {
    rruleRaw = rruleProp.value;
    try {
      rrule = parseRRule(rruleProp.value);
    } catch (e) {
      warnings.push(`${feedName}: ${label}: ${message(e)}`);
    }
  }

  const summaryProp = findProperty(comp, "SUMMARY");
  const seqProp = findProperty(comp, "SEQUENCE");
  const lastModProp = findProperty(comp, "LAST-MODIFIED");
  const dtstampProp = findProperty(comp, "DTSTAMP");
  const statusProp = findProperty(comp, "STATUS");

  return {
    uid,
    recurrenceId,
    summary: summaryProp ? unescapeText(summaryProp.value) : "",
    start,
    end,
    durationSeconds,
    rrule,
    rruleRaw,
    exdates: collectDates(comp, "EXDATE", feedName, label, warnings),
    rdates: collectDates(comp, "RDATE", feedName, label, warnings),
    sequence: seqProp ? safeInt(seqProp.value) : 0,
    lastModified: lastModProp ? lastModProp.value.trim() : null,
    dtstamp: dtstampProp ? dtstampProp.value.trim() : null,
    status: statusProp ? statusProp.value.trim().toUpperCase() || null : null,
    component: comp,
    feedIndex,
    feedName,
  };
}

function tryDateTime(
  comp: Component,
  name: string,
  feedName: string,
  label: string,
  warnings: string[]
): DateTime | null {
  const prop = findProperty(comp, name);
  if (!prop) return null;
  try {
    return parseDateTimeProperty(prop);
  } catch (e) {
    warnings.push(`${feedName}: ${label}: ${name}: ${message(e)}`);
    return null;
  }
}

/** EXDATE/RDATE may repeat and each property may hold a comma list. */
function collectDates(
  comp: Component,
  name: string,
  feedName: string,
  label: string,
  warnings: string[]
): DateTime[] {
  const out: DateTime[] = [];
  for (const prop of findProperties(comp, name)) {
    const tzid = paramValue(prop, "TZID");
    const valueType = paramValue(prop, "VALUE");
    for (const piece of prop.value.split(",")) {
      if (piece.trim() === "") continue;
      try {
        out.push(parseDateTimeFromPiece(piece, tzid, valueType));
      } catch (e) {
        warnings.push(`${feedName}: ${label}: ${name}: ${message(e)}`);
      }
    }
  }
  return out;
}

function parseDateTimeFromPiece(
  piece: string,
  tzid: string | null,
  valueType: string | null
): DateTime {
  // RDATE may carry PERIOD values (`start/end`); the start is what matters
  // for occurrence identity.
  const slash = piece.indexOf("/");
  const value = slash >= 0 ? piece.slice(0, slash) : piece;
  return parseDateTimeValue(value.trim(), tzid, valueType);
}

function safeInt(value: string): number {
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function message(e: unknown): string {
  if (e instanceof ParseError) return e.message;
  return e instanceof Error ? e.message : String(e);
}
