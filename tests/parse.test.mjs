// The wire-format reader: RFC 5545 unfolding, content-line grammar,
// component-tree assembly, and the tolerance/strictness split that keeps
// sloppy real-world feeds readable without ever corrupting data.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseContentLine, parseFeed, unfoldLines } from "../dist/index.js";
import { calendar } from "./helpers.mjs";

test("unfolding joins continuations (space or tab, CRLF or LF) and skips blanks", () => {
  // The continuation "  world" contributes " world": fold marker eaten, content space kept.
  assert.deepEqual(unfoldLines("SUMMARY:Hello\r\n  world\r\nDTSTART:20260712\r\n"), [
    "SUMMARY:Hello world",
    "DTSTART:20260712",
  ]);
  // Bare LF and tab markers, as emitted by sloppier exporters.
  assert.deepEqual(unfoldLines("DESCRIPTION:part one\n\tpart two\nSUMMARY:x"), [
    "DESCRIPTION:part onepart two",
    "SUMMARY:x",
  ]);
  // Blank separator lines are tolerated as noise.
  assert.deepEqual(unfoldLines("SUMMARY:a\r\n\r\n\r\nLOCATION:b"), ["SUMMARY:a", "LOCATION:b"]);
});

test("content line splits into upper-cased name, params and raw value", () => {
  const p = parseContentLine("dtstart;tzid=Europe/Berlin:20260712T093000");
  assert.equal(p.name, "DTSTART");
  assert.deepEqual(p.params, { TZID: ["Europe/Berlin"] });
  assert.equal(p.value, "20260712T093000");
});

test("quoted parameter values shield delimiters; multi-values split on commas", () => {
  const quoted = parseContentLine('ATTENDEE;CN="Doe, Jane; PhD":mailto:jane@example.test');
  assert.deepEqual(quoted.params.CN, ["Doe, Jane; PhD"]);
  assert.equal(quoted.value, "mailto:jane@example.test");
  const multi = parseContentLine("ATTENDEE;MEMBER=a@example.test,b@example.test:mailto:c@example.test");
  assert.deepEqual(multi.params.MEMBER, ["a@example.test", "b@example.test"]);
});

test("value keeps every colon after the first delimiter", () => {
  assert.equal(parseContentLine("URL:https://example.test/a:b:c").value, "https://example.test/a:b:c");
});

test("a malformed content line is a hard ParseError", () => {
  assert.throws(() => parseContentLine("NO DELIMITER HERE"), /missing ':'/);
  assert.throws(() => parseContentLine(";=:"), /malformed/);
  assert.throws(() => parseContentLine('X;P="unterminated:v'), /unterminated quoted/);
});

test("parseFeed builds a nested component tree", () => {
  const text = calendar("UID:a@example.test\nDTSTART:20260712T090000Z\nBEGIN:VALARM\nACTION:DISPLAY\nEND:VALARM");
  const { calendars } = parseFeed(text, "t.ics");
  assert.equal(calendars.length, 1);
  const event = calendars[0].components[0];
  assert.equal(event.name, "VEVENT");
  assert.equal(event.components[0].name, "VALARM");
  assert.equal(event.components[0].properties[0].value, "DISPLAY");
});

test("multiple concatenated VCALENDARs in one file all parse", () => {
  const text = calendar("UID:a@example.test\nDTSTART:20260712") + calendar("UID:b@example.test\nDTSTART:20260713");
  assert.equal(parseFeed(text, "t.ics").calendars.length, 2);
});

test("structural breakage is fatal: mismatched END, unterminated, no VCALENDAR", () => {
  const mismatched = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VTODO\r\nEND:VCALENDAR\r\n";
  assert.throws(() => parseFeed(mismatched, "bad.ics"), /END:VTODO does not match open VEVENT/);
  assert.throws(() => parseFeed("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n", "bad.ics"), /unterminated VEVENT/);
  assert.throws(() => parseFeed("SUMMARY:floating\r\n", "bad.ics"), /no VCALENDAR/);
});

test("properties outside any component become warnings, not errors", () => {
  const text = "X-STRAY:1\r\n" + calendar("UID:a@example.test\nDTSTART:20260712");
  const { calendars, warnings } = parseFeed(text, "t.ics");
  assert.equal(calendars.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /X-STRAY outside any component/);
});
