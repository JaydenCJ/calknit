// Date/date-time parsing, pure-Gregorian arithmetic and the identity
// keys that make "same point on the same clock" a string comparison.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  addDays,
  dateTimeKey,
  dayOfWeek,
  daysInMonth,
  durationBetween,
  epochDays,
  formatDateTimeValue,
  fromEpochDays,
  isLeapYear,
  naiveSeconds,
  parseDateTimeValue,
  parseDuration,
} from "../dist/index.js";

test("parses DATE, floating, UTC and zoned DATE-TIME; formatting round-trips", () => {
  assert.deepEqual(parseDateTimeValue("20260712", null, null), {
    kind: "date", y: 2026, m: 7, d: 12,
  });
  const floating = parseDateTimeValue("20260712T093000", null, null);
  assert.equal(floating.utc, false);
  assert.equal(floating.tzid, null);
  assert.equal(parseDateTimeValue("20260712T093000Z", null, null).utc, true);
  assert.equal(parseDateTimeValue("20260712T093000", "Europe/Berlin", null).tzid, "Europe/Berlin");
  for (const raw of ["20260712", "20260712T093000", "20260712T093000Z"]) {
    assert.equal(formatDateTimeValue(parseDateTimeValue(raw, null, null)), raw);
  }
});

test("VALUE=DATE-TIME forbids treating a bare date as a DATE", () => {
  assert.throws(() => parseDateTimeValue("20260712", null, "DATE-TIME"), /unrecognized/);
});

test("impossible dates and times are rejected; Feb 29 only in leap years", () => {
  assert.throws(() => parseDateTimeValue("20260230", null, null), /invalid calendar date/);
  assert.throws(() => parseDateTimeValue("20261301", null, null), /invalid calendar date/);
  assert.throws(() => parseDateTimeValue("20260712T250000", null, null), /invalid time of day/);
  assert.equal(parseDateTimeValue("20280229", null, null).d, 29);
  assert.throws(() => parseDateTimeValue("20260229", null, null), /invalid calendar date/);
});

test("durations parse per RFC 5545: weeks, days, time parts, sign", () => {
  assert.equal(parseDuration("P2W"), 14 * 86400);
  assert.equal(parseDuration("P1DT12H"), 129600);
  assert.equal(parseDuration("PT1H30M"), 5400);
  assert.equal(parseDuration("-PT15M"), -900);
  assert.throws(() => parseDuration("P"), /duration/);
  assert.throws(() => parseDuration("1H"), /duration/);
});

test("Gregorian core: epoch-day round-trip, weekdays, century leap rules", () => {
  assert.equal(epochDays(1970, 1, 1), 0);
  assert.equal(epochDays(2026, 7, 12), 20646);
  for (const [y, m, d] of [[1999, 12, 31], [2000, 2, 29], [2026, 7, 12], [2100, 3, 1]]) {
    assert.deepEqual(fromEpochDays(epochDays(y, m, d)), { y, m, d });
  }
  assert.equal(dayOfWeek(2026, 7, 12), 6); // Sunday (0=MO..6=SU)
  assert.equal(dayOfWeek(2026, 7, 6), 0); // Monday
  assert.equal(dayOfWeek(1970, 1, 1), 3); // Thursday
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(2100), false);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
});

test("addDays crosses month and year boundaries and keeps kind + zone", () => {
  const zoned = parseDateTimeValue("20261231T230000", "Asia/Tokyo", null);
  const next = addDays(zoned, 1);
  assert.equal(formatDateTimeValue(next), "20270101T230000");
  assert.equal(next.tzid, "Asia/Tokyo");
  assert.equal(formatDateTimeValue(addDays(parseDateTimeValue("20260228", null, null), 1)), "20260301");
});

test("durationBetween computes wall-clock duration for both value types", () => {
  const s = parseDateTimeValue("20260712T093000", "Europe/Berlin", null);
  const e = parseDateTimeValue("20260712T100000", "Europe/Berlin", null);
  assert.equal(durationBetween(s, e), 1800);
  const d1 = parseDateTimeValue("20260904", null, null);
  const d2 = parseDateTimeValue("20260906", null, null);
  assert.equal(durationBetween(d1, d2), 2 * 86400);
});

test("dateTimeKey distinguishes clocks and normalizes the TZID", () => {
  assert.equal(dateTimeKey(parseDateTimeValue("20260712", null, null)), "date:20260712");
  assert.equal(
    dateTimeKey(parseDateTimeValue("20260712T093000Z", null, null)),
    "utc:20260712T093000"
  );
  assert.equal(
    dateTimeKey(parseDateTimeValue("20260712T093000", null, null)),
    "local:20260712T093000@floating"
  );
  // A Windows zone name and its IANA equivalent produce the same key.
  assert.equal(
    dateTimeKey(parseDateTimeValue("20260712T093000", "W. Europe Standard Time", null)),
    dateTimeKey(parseDateTimeValue("20260712T093000", "Europe/Berlin", null))
  );
  // naiveSeconds orders values on the wall clock; dates sort at midnight.
  const date = parseDateTimeValue("20260712", null, null);
  const morning = parseDateTimeValue("20260712T000100", null, null);
  assert.ok(naiveSeconds(date) < naiveSeconds(morning));
});
