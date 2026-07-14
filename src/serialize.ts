/**
 * Canonical iCalendar output. The same set of merged events always
 * serializes to the same bytes: properties in a fixed order, parameters
 * sorted, events sorted by start, RFC 5545 line folding at 75 octets
 * (UTF-8 aware), CRLF endings. Deterministic output makes merged
 * calendars diffable and re-runs idempotent.
 */

import { dateTimeKey, fromEpochDays, naiveSeconds } from "./datetime.js";
import { findProperty, paramValue } from "./parse.js";
import { MergedEvent } from "./merge.js";
import { Component, Property } from "./types.js";
import { VERSION } from "./version.js";

/** Fixed VEVENT property order; anything else follows alphabetically. */
const VEVENT_ORDER = [
  "UID",
  "RECURRENCE-ID",
  "SEQUENCE",
  "DTSTAMP",
  "CREATED",
  "LAST-MODIFIED",
  "DTSTART",
  "DTEND",
  "DURATION",
  "RRULE",
  "RDATE",
  "EXDATE",
  "SUMMARY",
  "LOCATION",
  "GEO",
  "DESCRIPTION",
  "STATUS",
  "TRANSP",
  "CLASS",
  "PRIORITY",
  "URL",
  "CATEGORIES",
  "ORGANIZER",
  "ATTENDEE",
] as const;

const VEVENT_RANK = new Map<string, number>(VEVENT_ORDER.map((n, i) => [n, i]));

export interface SerializeOptions {
  /** X-WR-CALNAME for the merged calendar; omitted when null. */
  calname: string | null;
  /** Seconds since epoch for synthesized DTSTAMPs (SOURCE_DATE_EPOCH). */
  sourceDateEpoch: number | null;
}

/** Assemble the final VCALENDAR text from merged events and timezones. */
export function buildCalendar(
  merged: MergedEvent[],
  timezones: Component[],
  opts: SerializeOptions
): string {
  const lines: string[] = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push(`PRODID:-//calknit//calknit ${VERSION}//EN`);
  lines.push("CALSCALE:GREGORIAN");
  if (opts.calname !== null) {
    lines.push(serializeProperty({ name: "X-WR-CALNAME", params: {}, value: opts.calname }));
  }

  for (const tz of selectTimezones(merged, timezones)) {
    serializeComponent(tz, lines, null);
  }

  const events = [...merged].sort(compareMerged);
  for (const ev of events) {
    const comp = ev.component;
    if (opts.sourceDateEpoch !== null && findProperty(comp, "DTSTAMP") === null) {
      comp.properties.push({
        name: "DTSTAMP",
        params: {},
        value: utcStamp(opts.sourceDateEpoch),
      });
    }
    serializeComponent(comp, lines, VEVENT_RANK);
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * Keep exactly the VTIMEZONE definitions the output still references,
 * deduplicated by TZID (first definition wins) and sorted by TZID.
 */
export function selectTimezones(merged: MergedEvent[], timezones: Component[]): Component[] {
  const referenced = new Set<string>();
  for (const ev of merged) collectTzids(ev.component, referenced);

  const byTzid = new Map<string, Component>();
  for (const tz of timezones) {
    const idProp = findProperty(tz, "TZID");
    if (!idProp) continue;
    const id = idProp.value.trim();
    if (referenced.has(id) && !byTzid.has(id)) byTzid.set(id, tz);
  }
  return [...byTzid.keys()].sort().map((id) => byTzid.get(id)!);
}

function collectTzids(comp: Component, out: Set<string>): void {
  for (const prop of comp.properties) {
    const tzid = paramValue(prop, "TZID");
    if (tzid !== null) out.add(tzid);
  }
  for (const child of comp.components) collectTzids(child, out);
}

/** Serialize one component; `rank` orders properties (null = keep order). */
function serializeComponent(
  comp: Component,
  lines: string[],
  rank: Map<string, number> | null
): void {
  lines.push(`BEGIN:${comp.name}`);
  const props = rank === null ? comp.properties : orderProperties(comp.properties, rank);
  for (const prop of props) lines.push(serializeProperty(prop));
  for (const child of comp.components) serializeComponent(child, lines, null);
  lines.push(`END:${comp.name}`);
}

/** Stable sort into the canonical VEVENT order. */
function orderProperties(props: Property[], rank: Map<string, number>): Property[] {
  return props
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ra = rank.get(a.p.name) ?? rank.size;
      const rb = rank.get(b.p.name) ?? rank.size;
      if (ra !== rb) return ra - rb;
      if (a.p.name !== b.p.name) return a.p.name < b.p.name ? -1 : 1;
      return a.i - b.i; // same name: preserve input order (EXDATE lists...)
    })
    .map((x) => x.p);
}

/** Render one content line: NAME;PARAM=v1,v2:value. Parameters sorted. */
export function serializeProperty(prop: Property): string {
  let out = prop.name;
  for (const key of Object.keys(prop.params).sort()) {
    const values = prop.params[key]!.map(quoteParamValue).join(",");
    out += `;${key}=${values}`;
  }
  return `${out}:${prop.value}`;
}

function quoteParamValue(value: string): string {
  return /[:;,]/.test(value) ? `"${value}"` : value;
}

/**
 * RFC 5545 §3.1 folding: physical lines of at most 75 octets, each
 * continuation prefixed with one space. Splits between code points so
 * multi-byte UTF-8 sequences are never torn apart.
 */
export function fold(line: string): string {
  if (utf8Length(line) <= 75) return line;
  const pieces: string[] = [];
  let current = "";
  let budget = 75;
  for (const ch of line) {
    const w = utf8Length(ch);
    if (utf8Length(current) + w > budget) {
      pieces.push(current);
      current = " " + ch;
      budget = 75;
      continue;
    }
    current += ch;
  }
  if (current !== "") pieces.push(current);
  return pieces.join("\r\n");
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return n;
}

/** Deterministic event ordering: start, then identity fields. */
function compareMerged(a: MergedEvent, b: MergedEvent): number {
  const sa = a.winner.start ? naiveSeconds(a.winner.start) : Number.MAX_SAFE_INTEGER;
  const sb = b.winner.start ? naiveSeconds(b.winner.start) : Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  const ka = a.winner.start ? dateTimeKey(a.winner.start) : "";
  const kb = b.winner.start ? dateTimeKey(b.winner.start) : "";
  if (ka !== kb) return ka < kb ? -1 : 1;
  const ua = a.winner.uid ?? "";
  const ub = b.winner.uid ?? "";
  if (ua !== ub) return ua < ub ? -1 : 1;
  const ra = a.winner.recurrenceId ? dateTimeKey(a.winner.recurrenceId) : "";
  const rb = b.winner.recurrenceId ? dateTimeKey(b.winner.recurrenceId) : "";
  if (ra !== rb) return ra < rb ? -1 : 1;
  return a.winner.summary < b.winner.summary ? -1 : a.winner.summary > b.winner.summary ? 1 : 0;
}

/** Format seconds-since-epoch as an iCalendar UTC stamp. */
function utcStamp(epochSeconds: number): string {
  const days = Math.floor(epochSeconds / 86400);
  let rem = epochSeconds - days * 86400;
  const { y, m, d } = fromEpochDays(days);
  const h = Math.floor(rem / 3600);
  rem -= h * 3600;
  const mi = Math.floor(rem / 60);
  const s = rem - mi * 60;
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(y, 4)}${p(m, 2)}${p(d, 2)}T${p(h, 2)}${p(mi, 2)}${p(s, 2)}Z`;
}
