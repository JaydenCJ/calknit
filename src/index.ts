/**
 * calknit public API. The pipeline entry point is `knitFeeds`; the lower
 * layers (parser, recurrence engine, identity fingerprints, canonical
 * serializer) are exported for programmatic use and for the test suite.
 */

// Pipeline
export { knitFeeds, DEFAULT_KNIT_OPTIONS } from "./knit.js";
export type { FeedInput, KnitOptions, KnitReport, KnitResult } from "./knit.js";

// Parsing
export {
  parseFeed,
  parseContentLine,
  unfoldLines,
  findProperty,
  findProperties,
  paramValue,
} from "./parse.js";
export { escapeText, unescapeText } from "./text.js";

// Dates and recurrence
export {
  parseDateTimeValue,
  parseDuration,
  dateTimeKey,
  naiveSeconds,
  durationBetween,
  formatDateTimeValue,
  describeDateTime,
  epochDays,
  fromEpochDays,
  dayOfWeek,
  daysInMonth,
  isLeapYear,
  addDays,
} from "./datetime.js";
export { parseRRule, canonicalRRule, expandOccurrences, isExpandable } from "./rrule.js";
export type { ExpandOptions } from "./rrule.js";
export { normalizeTzid } from "./tzalias.js";

// Identity
export { normalizeSummary, eventFingerprint, identityFingerprint } from "./fingerprint.js";
export { matchEvents, DEFAULT_MATCH_OPTIONS } from "./match.js";
export type { MatchLevel, MatchOptions, MatchOutcome } from "./match.js";

// Merge and output
export { mergeGroup, orderCandidates } from "./merge.js";
export type { MergedEvent } from "./merge.js";
export { buildCalendar, serializeProperty, selectTimezones, fold } from "./serialize.js";
export type { SerializeOptions } from "./serialize.js";

// Extraction, inspection, reports
export { extractEvents } from "./event.js";
export type { ExtractResult } from "./event.js";
export { inspectFeed } from "./inspect.js";
export type { FeedStats } from "./inspect.js";
export {
  renderMergeSummary,
  renderExplain,
  renderInspect,
  mergeReportJson,
  inspectJson,
} from "./report.js";

// Model
export type {
  Property,
  Component,
  DateTime,
  RRule,
  CalEvent,
  MatchGroup,
  MatchReason,
  Absorption,
  FieldConflict,
} from "./types.js";
export { UsageError, ParseError } from "./types.js";
export { VERSION } from "./version.js";
