/**
 * Core data model shared by every calknit module: the raw iCalendar
 * component tree, the typed event view over it, and the error types the
 * CLI maps onto exit codes (UsageError -> 2, ParseError -> 2).
 */

/** One unfolded iCalendar content line, e.g. `DTSTART;TZID=X:20260712T090000`. */
export interface Property {
  /** Property name, upper-cased (`DTSTART`). */
  name: string;
  /** Parameters, keys upper-cased; each parameter may carry multiple values. */
  params: Record<string, string[]>;
  /** Raw property value, still in wire encoding (TEXT stays escaped). */
  value: string;
}

/** A BEGIN:...END:... block: VCALENDAR, VEVENT, VTIMEZONE, VALARM, ... */
export interface Component {
  name: string;
  properties: Property[];
  components: Component[];
}

/** A calendar date or date-time as written in the feed — never a JS Date. */
export type DateTime =
  | { kind: "date"; y: number; m: number; d: number }
  | {
      kind: "datetime";
      y: number;
      m: number;
      d: number;
      h: number;
      mi: number;
      s: number;
      /** True for `...Z` values. */
      utc: boolean;
      /** TZID parameter as written (null for UTC and floating times). */
      tzid: string | null;
    };

/** A parsed, expandable recurrence rule (see rrule.ts for semantics). */
export interface RRule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: DateTime | null;
  /** BYDAY entries; day 0=MO..6=SU, ord 0 = every such weekday. */
  byDay: { ord: number; day: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  /** Week start, 0=MO..6=SU. */
  wkst: number;
  /** Rule parts calknit recognizes but does not expand (BYHOUR, BYWEEKNO, ...). */
  unsupported: string[];
}

/** The typed view of one VEVENT, carrying its original component for output. */
export interface CalEvent {
  uid: string | null;
  recurrenceId: DateTime | null;
  /** SUMMARY with TEXT escapes resolved; "" when absent. */
  summary: string;
  start: DateTime | null;
  end: DateTime | null;
  /** Resolved from DTEND or DURATION; null when neither is usable. */
  durationSeconds: number | null;
  rrule: RRule | null;
  rruleRaw: string | null;
  exdates: DateTime[];
  rdates: DateTime[];
  sequence: number;
  /** LAST-MODIFIED raw value, used only for ordering merge candidates. */
  lastModified: string | null;
  dtstamp: string | null;
  status: string | null;
  /** The original VEVENT component (serialization source of truth). */
  component: Component;
  /** Which input feed this event came from (0-based CLI argument order). */
  feedIndex: number;
  feedName: string;
}

/** Why a group of events was considered the same event. */
export type MatchReason = "uid" | "fingerprint" | "unique";

/** A set of events (>=1) judged to be the same real-world event. */
export interface MatchGroup {
  events: CalEvent[];
  reason: MatchReason;
  /** The identity key the group was formed under (stable, reportable). */
  key: string;
}

/** A standalone instance swallowed by a recurring series it duplicates. */
export interface Absorption {
  instance: CalEvent;
  /** Identity key of the covering series group. */
  seriesKey: string;
  seriesUid: string | null;
  /** The matched occurrence's start key. */
  occurrence: string;
}

/** A field where a discarded duplicate disagreed with the surviving copy. */
export interface FieldConflict {
  prop: string;
  kept: string;
  dropped: string;
  droppedFeed: string;
}

/** Bad command line: unknown flag, missing operand. CLI exit code 2. */
export class UsageError extends Error {}

/** Structurally broken input that cannot be recovered from. CLI exit code 2. */
export class ParseError extends Error {}
