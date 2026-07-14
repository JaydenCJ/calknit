// The knitFeeds pipeline as a library: report contents, warning
// propagation, tolerance for imperfect events, and option plumbing.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { knitFeeds } from "../dist/index.js";
import { calendar } from "./helpers.mjs";

const feed = (name, text) => ({ name, text });

test("the report accounts for every input event, including intra-feed dupes", () => {
  const { report } = knitFeeds([
    feed("a.ics", calendar(
      "UID:1@example.test\nDTSTART:20260712T090000Z\nSUMMARY:One",
      "UID:2@example.test\nDTSTART:20260713T090000Z\nSUMMARY:Two"
    )),
    feed("b.ics", calendar("UID:3@example.test\nDTSTART:20260714T090000Z\nSUMMARY:Three")),
  ]);
  assert.deepEqual(report.feeds, [
    { name: "a.ics", events: 2 },
    { name: "b.ics", events: 1 },
  ]);
  assert.equal(report.inputEvents, 3);
  assert.equal(report.outputEvents, 3);
  assert.deepEqual(report.stats, { uid: 0, fingerprint: 0, absorbed: 0 });
  // Duplicates inside a single feed are folded too, not just cross-feed.
  const intra = knitFeeds([
    feed("a.ics", calendar(
      "UID:a@example.test\nDTSTART:20260712T090000Z\nDTEND:20260712T100000Z\nSUMMARY:Twice",
      "UID:b@example.test\nDTSTART:20260712T090000Z\nDTEND:20260712T100000Z\nSUMMARY:Twice"
    )),
  ]).report;
  assert.equal(intra.outputEvents, 1);
  assert.equal(intra.stats.fingerprint, 1);
});

test("imperfect events degrade to warnings, never crashes", () => {
  // Unreadable DTSTART: the event survives, minus fingerprint matching.
  const badStart = knitFeeds([
    feed("a.ics", calendar("UID:odd@example.test\nDTSTART:not-a-date\nSUMMARY:Odd one")),
  ]);
  assert.equal(badStart.report.outputEvents, 1);
  assert.equal(badStart.report.warnings.length, 1);
  assert.match(badStart.report.warnings[0], /odd@example\.test.*unrecognized/);
  assert.ok(badStart.ics.includes("SUMMARY:Odd one"));
  // Unparseable RRULE: degraded to exact-raw-rule matching, still merges.
  const badRule = knitFeeds([
    feed("a.ics", calendar("UID:a@example.test\nDTSTART:20260706T090000Z\nRRULE:FREQ=DAILY;INTERVAL=zero\nSUMMARY:S")),
    feed("b.ics", calendar("UID:b@example.test\nDTSTART:20260706T090000Z\nRRULE:FREQ=DAILY;INTERVAL=zero\nSUMMARY:S")),
  ]);
  assert.equal(badRule.report.outputEvents, 1);
  assert.equal(badRule.report.warnings.length, 2);
});

test("events with no start still merge by UID and land in the output", () => {
  const { report, ics } = knitFeeds([
    feed("a.ics", calendar("UID:x@example.test\nSUMMARY:No start")),
    feed("b.ics", calendar("UID:x@example.test\nSUMMARY:No start")),
  ]);
  assert.equal(report.outputEvents, 1);
  assert.equal(report.stats.uid, 1);
  assert.ok(ics.includes("SUMMARY:No start"));
});

test("filled and conflicts aggregate across all merged groups", () => {
  const { report } = knitFeeds([
    feed("a.ics", calendar(
      "UID:x@example.test\nSEQUENCE:2\nDTSTART:20260712T090000Z\nSUMMARY:A\nLOCATION:Room 1",
      "UID:y@example.test\nSEQUENCE:2\nDTSTART:20260713T090000Z\nSUMMARY:B"
    )),
    feed("b.ics", calendar(
      "UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:A\nLOCATION:Room 2",
      "UID:y@example.test\nDTSTART:20260713T090000Z\nSUMMARY:B\nDESCRIPTION:notes"
    )),
  ]);
  assert.deepEqual(report.filled, ["DESCRIPTION<b.ics"]);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].prop, "LOCATION");
});

test("match level plumbs through: uid-only keeps fingerprint twins", () => {
  const twins = [
    feed("a.ics", calendar("UID:a@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Twin")),
    feed("b.ics", calendar("UID:b@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Twin")),
  ];
  assert.equal(knitFeeds(twins).report.outputEvents, 1);
  assert.equal(knitFeeds(twins, { match: "uid" }).report.outputEvents, 2);
});

test("absorption details name the instance, its series and the occurrence", () => {
  const { report } = knitFeeds([
    feed("a.ics", calendar("UID:s@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Sync")),
    feed("b.ics", calendar("UID:i@example.test\nDTSTART:20260713T093000Z\nDTEND:20260713T100000Z\nSUMMARY:Sync")),
  ]);
  assert.equal(report.absorbed.length, 1);
  assert.equal(report.absorbed[0].instance.uid, "i@example.test");
  assert.equal(report.absorbed[0].seriesUid, "s@example.test");
  assert.equal(report.absorbed[0].occurrence, "utc:20260713T093000");
});
