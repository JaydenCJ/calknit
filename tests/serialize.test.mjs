// Canonical output: folding (UTF-8 aware), parameter rendering, property
// ordering, event ordering, VTIMEZONE selection and byte determinism.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fold, knitFeeds, serializeProperty, unfoldLines } from "../dist/index.js";
import { calendar } from "./helpers.mjs";

test("folding: short lines untouched, 75-octet limit, exact round-trip", () => {
  assert.equal(fold("SUMMARY:short"), "SUMMARY:short");
  const long = "DESCRIPTION:" + "x".repeat(200);
  for (const phys of fold(long).split("\r\n")) {
    assert.ok(Buffer.byteLength(phys, "utf8") <= 75, `line too long: ${phys.length}`);
  }
  for (const len of [74, 75, 76, 150]) {
    const line = "X:" + "a".repeat(len);
    assert.deepEqual(unfoldLines(fold(line)), [line]);
  }
});

test("folding never tears a multi-byte character apart", () => {
  const long = "DESCRIPTION:" + "会議メモ📝".repeat(30);
  const folded = fold(long);
  for (const phys of folded.split("\r\n")) {
    assert.ok(Buffer.byteLength(phys, "utf8") <= 75);
    // A torn UTF-8 sequence would produce replacement chars on re-decode.
    assert.ok(!phys.includes("�"));
  }
  assert.deepEqual(unfoldLines(folded), [long]);
});

test("serializeProperty sorts parameters and quotes unsafe values", () => {
  const line = serializeProperty({
    name: "ATTENDEE",
    params: { ROLE: ["CHAIR"], CN: ["Doe, Jane"] },
    value: "mailto:jane@example.test",
  });
  assert.equal(line, 'ATTENDEE;CN="Doe, Jane";ROLE=CHAIR:mailto:jane@example.test');
});

const knit = (feeds, options) =>
  knitFeeds(
    feeds.map((f, i) => ({ name: `f${i}.ics`, text: f })),
    options
  );

test("VEVENT properties come out in canonical order", () => {
  const { ics } = knit([
    calendar("SUMMARY:Order me\nDTSTART:20260712T090000Z\nSEQUENCE:1\nUID:x@example.test\nLOCATION:Here\nDTSTAMP:20260701T000000Z"),
  ]);
  const body = ics.split("BEGIN:VEVENT\r\n")[1].split("\r\nEND:VEVENT")[0];
  const names = body.split("\r\n").map((l) => l.split(/[;:]/)[0]);
  assert.deepEqual(names, ["UID", "SEQUENCE", "DTSTAMP", "DTSTART", "SUMMARY", "LOCATION"]);
});

test("events sort by start; all-day sorts at midnight before timed", () => {
  const { ics } = knit([
    calendar(
      "UID:late@example.test\nDTSTART:20260714T090000Z\nSUMMARY:Later",
      "UID:allday@example.test\nDTSTART;VALUE=DATE:20260713\nSUMMARY:All day",
      "UID:timed@example.test\nDTSTART:20260713T070000Z\nSUMMARY:Timed"
    ),
  ]);
  const order = [...ics.matchAll(/UID:([a-z]+)@example\.test/g)].map((m) => m[1]);
  assert.deepEqual(order, ["allday", "timed", "late"]);
});

test("only referenced VTIMEZONEs survive, deduplicated by TZID", () => {
  const tz = (tzid) =>
    `BEGIN:VTIMEZONE\r\nTZID:${tzid}\r\nBEGIN:STANDARD\r\nDTSTART:19701025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0100\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n`;
  const feed = (tzids, body) =>
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//t//t//EN\r\n" +
    tzids.map(tz).join("") +
    `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const { ics } = knit([
    feed(["Europe/Berlin", "Europe/Unreferenced"], "UID:a@example.test\r\nDTSTART;TZID=Europe/Berlin:20260712T090000\r\nSUMMARY:A"),
    feed(["Europe/Berlin"], "UID:b@example.test\r\nDTSTART;TZID=Europe/Berlin:20260713T090000\r\nSUMMARY:B"),
  ]);
  assert.equal([...ics.matchAll(/BEGIN:VTIMEZONE/g)].length, 1);
  assert.ok(!ics.includes("Europe/Unreferenced"));
});

test("output is CRLF-only, newline-terminated and byte-deterministic", () => {
  const a = calendar("UID:a@example.test\nDTSTART:20260712T090000Z\nSUMMARY:One");
  const b = calendar("UID:b@example.test\nDTSTART:20260713T090000Z\nSUMMARY:Two");
  const first = knit([a, b]).ics;
  assert.ok(first.endsWith("\r\n"));
  assert.equal(first.replace(/\r\n/g, "").includes("\n"), false);
  assert.equal(first, knit([a, b]).ics);
});

test("options surface in the header: sourceDateEpoch DTSTAMPs, calname", () => {
  const feed = calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:S");
  const pinned = knit([feed], { sourceDateEpoch: 1783814400 }).ics;
  assert.ok(pinned.includes("DTSTAMP:20260712T000000Z"));
  // Without the option no timestamp is invented — output stays honest.
  assert.ok(!knit([feed]).ics.includes("DTSTAMP"));
  assert.ok(knit([feed], { calname: "Everything" }).ics.includes("X-WR-CALNAME:Everything"));
  assert.ok(!knit([feed]).ics.includes("X-WR-CALNAME"));
});

test("nested VALARMs ride along inside their event untouched", () => {
  const { ics } = knit([
    calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:S\nBEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT10M\nEND:VALARM"),
  ]);
  assert.ok(ics.includes("BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM"));
});
