// Group merging: winner selection order, field donation from losers,
// conflict records, EXDATE/RDATE union — and that inputs are never
// mutated in the process.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { findProperties, findProperty, matchEvents, mergeGroup, orderCandidates } from "../dist/index.js";
import { calendar, eventsFrom } from "./helpers.mjs";

const groupOf = (events) => {
  const { groups } = matchEvents(events);
  assert.equal(groups.length, 1, "fixture should collapse to one group");
  return groups[0];
};

test("the highest SEQUENCE wins regardless of feed order", () => {
  const events = [
    ...eventsFrom(calendar("UID:x@example.test\nSEQUENCE:1\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nSEQUENCE:3\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 1, "b.ics"),
  ];
  const merged = mergeGroup(groupOf(events));
  assert.equal(merged.winner.feedName, "b.ics");
  assert.equal(findProperty(merged.component, "SEQUENCE").value, "3");
});

test("equal SEQUENCE falls back to LAST-MODIFIED; a stamp beats no stamp", () => {
  const events = [
    ...eventsFrom(calendar("UID:x@example.test\nLAST-MODIFIED:20260701T000000Z\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nLAST-MODIFIED:20260705T000000Z\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 1, "b.ics"),
  ];
  assert.equal(mergeGroup(groupOf(events)).winner.feedName, "b.ics");
  const stampedVsNot = [
    ...eventsFrom(calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:R"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nLAST-MODIFIED:20260701T000000Z\nDTSTART:20260712T090000Z\nSUMMARY:R"), 1, "b.ics"),
  ];
  assert.equal(orderCandidates(stampedVsNot)[0].feedName, "b.ics");
});

test("all stamps equal: the earlier feed on the command line wins", () => {
  const events = [
    ...eventsFrom(calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 1, "b.ics"),
  ];
  assert.equal(mergeGroup(groupOf(events)).winner.feedName, "a.ics");
});

test("losers donate LOCATION and DESCRIPTION the winner lacks", () => {
  const events = [
    ...eventsFrom(calendar("UID:x@example.test\nSEQUENCE:2\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review\nLOCATION:Room 4\nDESCRIPTION:Bring the numbers"), 1, "b.ics"),
  ];
  const merged = mergeGroup(groupOf(events));
  assert.equal(findProperty(merged.component, "LOCATION").value, "Room 4");
  assert.equal(findProperty(merged.component, "DESCRIPTION").value, "Bring the numbers");
  assert.deepEqual(merged.filled.sort(), ["DESCRIPTION<b.ics", "LOCATION<b.ics"]);
});

test("the winner's populated fields are never overwritten; the clash is recorded", () => {
  const events = [
    ...eventsFrom(calendar("UID:x@example.test\nSEQUENCE:2\nDTSTART:20260712T090000Z\nSUMMARY:Review\nLOCATION:Room 9"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review\nLOCATION:Room 4"), 1, "b.ics"),
  ];
  const merged = mergeGroup(groupOf(events));
  assert.equal(findProperty(merged.component, "LOCATION").value, "Room 9");
  assert.equal(merged.filled.length, 0);
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(merged.conflicts[0], {
    prop: "LOCATION",
    kept: "Room 9",
    dropped: "Room 4",
    droppedFeed: "b.ics",
  });
});

test("EXDATEs union across copies of a series, deduplicated and sorted", () => {
  const events = [
    ...eventsFrom(calendar("UID:a@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE:20260810T093000Z,20260713T093000Z\nSUMMARY:Sync"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:b@example.test\nDTSTART:20260706T093000Z\nDTEND:20260706T100000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE:20260824T093000Z\nEXDATE:20260713T093000Z\nSUMMARY:Sync"), 1, "b.ics"),
  ];
  const merged = mergeGroup(groupOf(events));
  const exdates = findProperties(merged.component, "EXDATE").map((p) => p.value);
  assert.deepEqual(exdates, ["20260713T093000Z", "20260810T093000Z", "20260824T093000Z"]);
});

test("EXDATEs under different TZID parameters stay distinct in the union", () => {
  const events = [
    ...eventsFrom(calendar("UID:a@example.test\nDTSTART;TZID=Europe/Berlin:20260706T093000\nDTEND;TZID=Europe/Berlin:20260706T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE;TZID=Europe/Berlin:20260810T093000\nSUMMARY:Sync"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:b@example.test\nDTSTART;TZID=W. Europe Standard Time:20260706T093000\nDTEND;TZID=W. Europe Standard Time:20260706T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO\nEXDATE;TZID=W. Europe Standard Time:20260824T093000\nSUMMARY:Sync"), 1, "b.ics"),
  ];
  assert.equal(findProperties(mergeGroup(groupOf(events)).component, "EXDATE").length, 2);
});

test("merging clones — originals stay untouched; a solo group merges to itself", () => {
  const events = [
    ...eventsFrom(calendar("UID:x@example.test\nSEQUENCE:2\nDTSTART:20260712T090000Z\nSUMMARY:Review"), 0, "a.ics"),
    ...eventsFrom(calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Review\nLOCATION:Room 4"), 1, "b.ics"),
  ];
  const before = events[0].component.properties.length;
  mergeGroup(groupOf(events));
  assert.equal(events[0].component.properties.length, before);
  assert.equal(findProperty(events[0].component, "LOCATION"), null);

  const solo = eventsFrom(calendar("UID:s@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Solo"), 0, "a.ics");
  const merged = mergeGroup(groupOf(solo));
  assert.equal(merged.filled.length, 0);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(findProperty(merged.component, "SUMMARY").value, "Solo");
});
