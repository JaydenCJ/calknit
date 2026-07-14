/**
 * The knit pipeline: parse every feed, extract events, resolve identity,
 * merge each group, serialize one canonical calendar. This is the
 * programmatic API; the CLI is a thin argument-parsing shell around it.
 */

import { extractEvents } from "./event.js";
import { matchEvents, MatchLevel, DEFAULT_MATCH_OPTIONS } from "./match.js";
import { mergeGroup, MergedEvent } from "./merge.js";
import { parseFeed } from "./parse.js";
import { buildCalendar } from "./serialize.js";
import { Absorption, CalEvent, Component, FieldConflict } from "./types.js";

export interface FeedInput {
  /** Display name used in reports (usually the file name). */
  name: string;
  /** Raw .ics content. */
  text: string;
}

export interface KnitOptions {
  /** Identity-matching aggressiveness. */
  match: MatchLevel;
  /** Absorption look-ahead from each series start, in days. */
  horizonDays: number;
  /** Hard cap on expanded occurrences per series. */
  maxOccurrences: number;
  /** X-WR-CALNAME for the merged calendar. */
  calname: string | null;
  /** Epoch seconds for synthesized DTSTAMPs (missing in the input). */
  sourceDateEpoch: number | null;
}

export const DEFAULT_KNIT_OPTIONS: KnitOptions = {
  match: DEFAULT_MATCH_OPTIONS.level,
  horizonDays: DEFAULT_MATCH_OPTIONS.horizonDays,
  maxOccurrences: DEFAULT_MATCH_OPTIONS.maxOccurrences,
  calname: null,
  sourceDateEpoch: null,
};

export interface KnitReport {
  feeds: { name: string; events: number }[];
  inputEvents: number;
  outputEvents: number;
  stats: { uid: number; fingerprint: number; absorbed: number };
  merged: MergedEvent[];
  absorbed: Absorption[];
  conflicts: FieldConflict[];
  /** `PROP<feed` fill notes, aggregated across groups. */
  filled: string[];
  warnings: string[];
  timezones: number;
}

export interface KnitResult {
  /** The merged calendar, canonical serialization. */
  ics: string;
  report: KnitReport;
}

/** Merge any number of .ics feeds into one deduplicated calendar. */
export function knitFeeds(inputs: FeedInput[], options?: Partial<KnitOptions>): KnitResult {
  const opts: KnitOptions = { ...DEFAULT_KNIT_OPTIONS, ...options };

  const allEvents: CalEvent[] = [];
  const allTimezones: Component[] = [];
  const warnings: string[] = [];
  const feeds: { name: string; events: number }[] = [];

  inputs.forEach((input, feedIndex) => {
    const parsed = parseFeed(input.text, input.name);
    warnings.push(...parsed.warnings);
    const extracted = extractEvents(parsed.calendars, feedIndex, input.name);
    warnings.push(...extracted.warnings);
    allEvents.push(...extracted.events);
    allTimezones.push(...extracted.timezones);
    feeds.push({ name: input.name, events: extracted.events.length });
  });

  const outcome = matchEvents(allEvents, {
    level: opts.match,
    horizonDays: opts.horizonDays,
    maxOccurrences: opts.maxOccurrences,
  });

  const merged = outcome.groups.map(mergeGroup);
  const conflicts: FieldConflict[] = [];
  const filled: string[] = [];
  for (const m of merged) {
    conflicts.push(...m.conflicts);
    filled.push(...m.filled);
  }

  const ics = buildCalendar(merged, allTimezones, {
    calname: opts.calname,
    sourceDateEpoch: opts.sourceDateEpoch,
  });

  // Count VTIMEZONEs actually emitted (cheap: they were selected inside
  // buildCalendar; recount deterministically from the output).
  const timezones = (ics.match(/^BEGIN:VTIMEZONE/gm) ?? []).length;

  return {
    ics,
    report: {
      feeds,
      inputEvents: allEvents.length,
      outputEvents: merged.length,
      stats: outcome.stats,
      merged,
      absorbed: outcome.absorbed,
      conflicts,
      filled,
      warnings,
      timezones,
    },
  };
}
