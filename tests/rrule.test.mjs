// The recurrence engine. Expansion drives recurrence-aware dedupe, so
// these tests pin the RFC 5545 semantics that matter: COUNT counts
// DTSTART, UNTIL is inclusive, BYDAY ordinals, negative BYMONTHDAY,
// BYSETPOS, WKST — including the RFC's own WKST=MO vs WKST=SU example.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canonicalRRule,
  expandOccurrences,
  formatDateTimeValue,
  isExpandable,
  parseDateTimeValue,
  parseRRule,
} from "../dist/index.js";

const FAR = 4102444800; // naive seconds for 2100-01-01, an "unbounded" horizon
const start = (raw, tzid = null) => parseDateTimeValue(raw, tzid, null);
const days = (occs) => occs.map((o) => formatDateTimeValue(o));
const expand = (dtstart, rule, untilNaive = FAR, maxOccurrences = 1000) =>
  expandOccurrences(start(dtstart), parseRRule(rule), { untilNaive, maxOccurrences });

test("weekly on Mondays: five occurrences carrying the DTSTART clock", () => {
  assert.deepEqual(days(expand("20260706T093000", "FREQ=WEEKLY;BYDAY=MO;COUNT=5")), [
    "20260706T093000",
    "20260713T093000",
    "20260720T093000",
    "20260727T093000",
    "20260803T093000",
  ]);
  // Occurrences inherit the DTSTART time of day and zone.
  const occs = expandOccurrences(
    start("20260706T093000", "Europe/Berlin"),
    parseRRule("FREQ=WEEKLY;COUNT=2"),
    { untilNaive: FAR, maxOccurrences: 10 }
  );
  assert.equal(occs[1].tzid, "Europe/Berlin");
  assert.equal(occs[1].h, 9);
  assert.equal(occs[1].mi, 30);
});

test("DAILY with INTERVAL=3 steps three days at a time", () => {
  assert.deepEqual(days(expand("20260701", "FREQ=DAILY;INTERVAL=3;COUNT=4")), [
    "20260701",
    "20260704",
    "20260707",
    "20260710",
  ]);
});

test("UNTIL is inclusive; a DATE-typed UNTIL covers that whole day", () => {
  const expected = ["20260701T120000", "20260702T120000", "20260703T120000"];
  assert.deepEqual(days(expand("20260701T120000", "FREQ=DAILY;UNTIL=20260703T120000")), expected);
  assert.deepEqual(days(expand("20260701T120000", "FREQ=DAILY;UNTIL=20260703")), expected);
});

test("COUNT counts DTSTART even when it does not match the pattern", () => {
  // DTSTART is a Tuesday; the rule says Mondays. RFC 5545: DTSTART is
  // always the first occurrence and consumes one COUNT.
  assert.deepEqual(days(expand("20260707", "FREQ=WEEKLY;BYDAY=MO;COUNT=3")), [
    "20260707",
    "20260713",
    "20260720",
  ]);
});

test("weekly with several BYDAY values interleaves inside each week", () => {
  assert.deepEqual(days(expand("20260706", "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5")), [
    "20260706",
    "20260708",
    "20260713",
    "20260715",
    "20260720",
  ]);
});

test("RFC 5545 WKST example: INTERVAL=2;BYDAY=TU,SU differs by week start", () => {
  // Straight from the spec (DTSTART 1997-08-05, a Tuesday).
  assert.deepEqual(
    days(expand("19970805T090000", "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=MO")),
    ["19970805T090000", "19970810T090000", "19970819T090000", "19970824T090000"]
  );
  assert.deepEqual(
    days(expand("19970805T090000", "FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=SU")),
    ["19970805T090000", "19970817T090000", "19970819T090000", "19970831T090000"]
  );
});

test("MONTHLY;BYDAY=2TU lands on each month's second Tuesday", () => {
  assert.deepEqual(days(expand("20260714T100000", "FREQ=MONTHLY;BYDAY=2TU;COUNT=3")), [
    "20260714T100000",
    "20260811T100000",
    "20260908T100000",
  ]);
});

test("monthly day-of-month: negative BYMONTHDAY counts from the end, plain day 31 skips short months", () => {
  assert.deepEqual(days(expand("20260731", "FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4")), [
    "20260731",
    "20260831",
    "20260930",
    "20261031",
  ]);
  assert.deepEqual(days(expand("20260131", "FREQ=MONTHLY;COUNT=4")), [
    "20260131",
    "20260331",
    "20260531",
    "20260731",
  ]);
});

test("BYSETPOS=-1 over weekday candidates picks the last weekday", () => {
  assert.deepEqual(
    days(expand("20260731", "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=3")),
    ["20260731", "20260831", "20260930"]
  );
});

test("YEARLY;BYMONTH=11;BYDAY=4TH is the fourth Thursday of November", () => {
  assert.deepEqual(days(expand("20261126", "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=3")), [
    "20261126",
    "20271125",
    "20281123",
  ]);
});

test("the caller's horizon truncates an unbounded rule; maxOccurrences hard-caps", () => {
  const horizon = 20646 * 86400; // naive midnight 2026-07-12
  assert.deepEqual(days(expand("20260709", "FREQ=DAILY", horizon)), [
    "20260709",
    "20260710",
    "20260711",
    "20260712",
  ]);
  assert.equal(expand("20260101", "FREQ=DAILY", FAR, 25).length, 25);
});

test("unexpandable parts parse and canonicalize but refuse to expand", () => {
  const rule = parseRRule("FREQ=DAILY;BYHOUR=9,17");
  assert.equal(isExpandable(rule), false);
  assert.equal(
    expandOccurrences(start("20260701T090000"), rule, { untilNaive: FAR, maxOccurrences: 10 }),
    null
  );
  assert.match(canonicalRRule(rule), /BYHOUR=9,17/);
  // Ordinal BYDAY under WEEKLY is undefined — refused rather than misread.
  assert.equal(isExpandable(parseRRule("FREQ=WEEKLY;BYDAY=2MO")), false);
});

test("canonical form is order- and default-insensitive but rule-faithful", () => {
  const a = canonicalRRule(parseRRule("BYDAY=WE,MO;FREQ=WEEKLY;INTERVAL=1;WKST=MO"));
  const b = canonicalRRule(parseRRule("FREQ=WEEKLY;BYDAY=MO,WE"));
  assert.equal(a, b);
  const c = canonicalRRule(parseRRule("FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2"));
  assert.notEqual(a, c);
});

test("structural garbage in an RRULE is a ParseError", () => {
  assert.throws(() => parseRRule("BYDAY=MO"), /missing FREQ/);
  assert.throws(() => parseRRule("FREQ=FORTNIGHTLY"), /unknown RRULE FREQ/);
  assert.throws(() => parseRRule("FREQ=DAILY;INTERVAL=0"), /out of range/);
  assert.throws(() => parseRRule("FREQ=MONTHLY;BYMONTHDAY=32"), /out of range/);
  assert.throws(() => parseRRule("FREQ=WEEKLY;BYDAY=XX"), /BYDAY token/);
});
