// Cross-feed identity resolution: the UID pass, the fingerprint pass and
// recurrence absorption, plus the guards that keep distinct events apart.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { matchEvents } from "../dist/index.js";
import { calendar, eventsFrom } from "./helpers.mjs";

const feedA = (...bodies) => eventsFrom(calendar(...bodies), 0, "a.ics");
const feedB = (...bodies) => eventsFrom(calendar(...bodies), 1, "b.ics");

test("UID identity: same UID collapses; a different RECURRENCE-ID keeps apart", () => {
  const events = [
    ...feedA("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"),
    ...feedB("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"),
  ];
  const { groups, stats } = matchEvents(events);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, "uid");
  assert.equal(stats.uid, 1);
  // Master vs detached override under one UID must never merge.
  const masterAndOverride = feedA(
    "UID:x@example.test\nDTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY\nSUMMARY:Sync",
    "UID:x@example.test\nRECURRENCE-ID:20260713T090000Z\nDTSTART:20260713T100000Z\nSUMMARY:Sync"
  );
  assert.equal(matchEvents(masterAndOverride).groups.length, 2);
});

test("different UIDs with the same title+start+duration merge by fingerprint", () => {
  const events = [
    ...feedA("UID:a@example.test\nDTSTART:20260712T090000Z\nDTEND:20260712T100000Z\nSUMMARY:Review"),
    ...feedB("UID:b@example.test\nDTSTART:20260712T090000Z\nDTEND:20260712T100000Z\nSUMMARY:Invitation: Review"),
  ];
  const { groups, stats } = matchEvents(events);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].reason, "fingerprint");
  assert.equal(stats.fingerprint, 1);
});

test("guards: different time, different duration or no title never merge", () => {
  const differentTime = [
    ...feedA("UID:a@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"),
    ...feedB("UID:b@example.test\nDTSTART:20260713T090000Z\nSUMMARY:Review"),
  ];
  assert.equal(matchEvents(differentTime).groups.length, 2);
  const differentDuration = [
    ...feedA("UID:a@example.test\nDTSTART:20260712T090000Z\nDTEND:20260712T100000Z\nSUMMARY:Review"),
    ...feedB("UID:b@example.test\nDTSTART:20260712T090000Z\nDTEND:20260712T110000Z\nSUMMARY:Review"),
  ];
  assert.equal(matchEvents(differentDuration).groups.length, 2);
  const untitled = [
    ...feedA("UID:a@example.test\nDTSTART:20260712T090000Z"),
    ...feedB("UID:b@example.test\nDTSTART:20260712T090000Z"),
  ];
  assert.equal(matchEvents(untitled).groups.length, 2);
});

test("series merge requires the same canonical RRULE", () => {
  const same = [
    ...feedA("UID:a@example.test\nDTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Sync"),
    ...feedB("UID:b@example.test\nDTSTART:20260706T090000Z\nRRULE:BYDAY=MO;FREQ=WEEKLY;WKST=MO\nSUMMARY:Sync"),
  ];
  assert.equal(matchEvents(same).groups.length, 1);
  const different = [
    ...feedA("UID:a@example.test\nDTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Sync"),
    ...feedB("UID:b@example.test\nDTSTART:20260706T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=2\nSUMMARY:Sync"),
  ];
  assert.equal(matchEvents(different).groups.length, 2);
});

test("a flattened instance is absorbed by the series that covers it", () => {
  const events = [
    ...feedA("UID:series@example.test\nDTSTART;TZID=Europe/Berlin:20260706T093000\nDTEND;TZID=Europe/Berlin:20260706T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Team sync"),
    ...feedB("UID:inst@example.test\nDTSTART;TZID=Europe/Berlin:20260720T093000\nDTEND;TZID=Europe/Berlin:20260720T100000\nSUMMARY:Team sync"),
  ];
  const { groups, absorbed, stats } = matchEvents(events);
  assert.equal(groups.length, 1);
  assert.equal(absorbed.length, 1);
  assert.equal(absorbed[0].instance.uid, "inst@example.test");
  assert.equal(absorbed[0].seriesUid, "series@example.test");
  assert.equal(absorbed[0].occurrence, "local:20260720T093000@europe/berlin");
  assert.equal(stats.absorbed, 1);
});

test("an instance off the pattern or with another duration survives", () => {
  const offPattern = [
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Team sync"),
    // A Tuesday — the Monday series never covers it.
    ...feedB("UID:inst@example.test\nDTSTART:20260721T093000Z\nDTEND:20260721T100000Z\nSUMMARY:Team sync"),
  ];
  assert.equal(matchEvents(offPattern).absorbed.length, 0);
  assert.equal(matchEvents(offPattern).groups.length, 2);
  const longerInstance = [
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Team sync"),
    ...feedB("UID:inst@example.test\nDTSTART:20260720T093000Z\nDTEND:20260720T113000Z\nSUMMARY:Team sync"),
  ];
  assert.equal(matchEvents(longerInstance).absorbed.length, 0);
});

test("exception dates steer absorption: EXDATE blocks it, RDATE enables it", () => {
  const exdated = [
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE:20260720T093000Z\nSUMMARY:Team sync"),
    ...feedB("UID:inst@example.test\nDTSTART:20260720T093000Z\nDTEND:20260720T100000Z\nSUMMARY:Team sync"),
  ];
  // The series says 07-20 did NOT happen; the standalone copy is kept.
  assert.equal(matchEvents(exdated).absorbed.length, 0);
  assert.equal(matchEvents(exdated).groups.length, 2);
  const rdated = [
    // Friday RDATE bolted onto a Monday series.
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nRDATE:20260710T093000Z\nSUMMARY:Team sync"),
    ...feedB("UID:inst@example.test\nDTSTART:20260710T093000Z\nDTEND:20260710T100000Z\nSUMMARY:Team sync"),
  ];
  const { absorbed } = matchEvents(rdated);
  assert.equal(absorbed.length, 1);
  assert.equal(absorbed[0].occurrence, "utc:20260710T093000");
});

test("detached overrides are never absorbed by their own series", () => {
  const events = [
    ...feedA(
      "UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Team sync",
      "UID:series@example.test\nRECURRENCE-ID:20260713T093000Z\nDTSTART:20260713T093000Z\nDTEND:20260713T100000Z\nSUMMARY:Team sync"
    ),
  ];
  const { groups, absorbed } = matchEvents(events);
  assert.equal(absorbed.length, 0);
  assert.equal(groups.length, 2);
});

test("match levels: 'uid' disables fingerprints, 'fingerprint' disables absorption", () => {
  const twins = [
    ...feedA("UID:a@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"),
    ...feedB("UID:b@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"),
  ];
  assert.equal(matchEvents(twins, { level: "uid" }).groups.length, 2);
  const flattened = [
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Team sync"),
    ...feedB("UID:inst@example.test\nDTSTART:20260720T093000Z\nDTEND:20260720T100000Z\nSUMMARY:Team sync"),
  ];
  const outcome = matchEvents(flattened, { level: "fingerprint" });
  assert.equal(outcome.groups.length, 2);
  assert.equal(outcome.absorbed.length, 0);
});

test("horizonDays bounds absorption look-ahead from the series start", () => {
  const events = [
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nSUMMARY:Team sync"),
    // ~1 year out; a 30-day horizon must not reach it.
    ...feedB("UID:inst@example.test\nDTSTART:20270705T093000Z\nDTEND:20270705T100000Z\nSUMMARY:Team sync"),
  ];
  assert.equal(matchEvents(events, { horizonDays: 30 }).absorbed.length, 0);
  assert.equal(matchEvents(events, { horizonDays: 400 }).absorbed.length, 1);
});

test("events with unexpandable rules are never absorbed into and never expand", () => {
  const events = [
    ...feedA("UID:series@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=DAILY;BYHOUR=9\nSUMMARY:Team sync"),
    ...feedB("UID:inst@example.test\nDTSTART:20260707T093000Z\nDTEND:20260707T100000Z\nSUMMARY:Team sync"),
  ];
  const { groups, absorbed } = matchEvents(events);
  assert.equal(absorbed.length, 0);
  assert.equal(groups.length, 2);
});
