// Cross-feed identity fingerprints: title normalization, the
// title+start+duration triple, and the series/override/single key split.
// The failure cases matter most — a fingerprint that matches too eagerly
// merges strangers' meetings.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { eventFingerprint, identityFingerprint, normalizeSummary } from "../dist/index.js";
import { eventOf } from "./helpers.mjs";

test("normalization strips mail-client noise but keeps semantic prefixes", () => {
  assert.equal(normalizeSummary("  Team   Sync "), "team sync");
  assert.equal(normalizeSummary("FW: Invitation: Standup"), "standup");
  assert.equal(normalizeSummary("Updated Invitation: Standup"), "standup");
  assert.equal(normalizeSummary("Copy of Budget review (copy)"), "budget review");
  // A cancellation is not the event itself — "Canceled:" must survive.
  assert.equal(normalizeSummary("Canceled: Standup"), "canceled: standup");
});

test("same title + start + duration => same fingerprint across UIDs", () => {
  const a = eventOf("UID:a@example.test\nDTSTART;TZID=Europe/Berlin:20260712T093000\nDTEND;TZID=Europe/Berlin:20260712T100000\nSUMMARY:Standup");
  const b = eventOf("UID:b@example.test\nDTSTART;TZID=Europe/Berlin:20260712T093000\nDTEND;TZID=Europe/Berlin:20260712T100000\nSUMMARY:Invitation: Standup");
  assert.equal(eventFingerprint(a), eventFingerprint(b));
});

test("a different duration or a different clock splits the fingerprint", () => {
  const base = eventOf("UID:a@example.test\nDTSTART:20260712T093000Z\nDTEND:20260712T100000Z\nSUMMARY:Standup");
  const longer = eventOf("UID:b@example.test\nDTSTART:20260712T093000Z\nDTEND:20260712T103000Z\nSUMMARY:Standup");
  assert.notEqual(eventFingerprint(base), eventFingerprint(longer));
  const utc = eventOf("UID:c@example.test\nDTSTART:20260712T093000Z\nSUMMARY:Standup");
  const floating = eventOf("UID:d@example.test\nDTSTART:20260712T093000\nSUMMARY:Standup");
  assert.notEqual(eventFingerprint(utc), eventFingerprint(floating));
});

test("Windows and IANA spellings of one zone fingerprint identically", () => {
  const outlook = eventOf("UID:a@example.test\nDTSTART;TZID=W. Europe Standard Time:20260712T093000\nSUMMARY:Standup");
  const iana = eventOf("UID:b@example.test\nDTSTART;TZID=Europe/Berlin:20260712T093000\nSUMMARY:Standup");
  assert.equal(eventFingerprint(outlook), eventFingerprint(iana));
});

test("events without a start or without a usable title cannot fingerprint", () => {
  const noStart = eventOf("UID:a@example.test\nSUMMARY:Standup");
  assert.equal(eventFingerprint(noStart), null);
  const untitled = eventOf("UID:b@example.test\nDTSTART:20260712T093000Z");
  assert.equal(eventFingerprint(untitled), null);
  const noiseOnly = eventOf("UID:c@example.test\nDTSTART:20260712T093000Z\nSUMMARY:FW:");
  assert.equal(eventFingerprint(noiseOnly), null);
});

test("identity keys separate singles, series and overrides", () => {
  const single = eventOf("UID:a@example.test\nDTSTART:20260712T093000Z\nSUMMARY:Standup");
  const series = eventOf("UID:b@example.test\nDTSTART:20260712T093000Z\nRRULE:FREQ=DAILY\nSUMMARY:Standup");
  const override = eventOf("UID:c@example.test\nRECURRENCE-ID:20260712T093000Z\nDTSTART:20260712T093000Z\nSUMMARY:Standup");
  assert.match(identityFingerprint(single), /^single\|/);
  assert.match(identityFingerprint(series), /^series\|/);
  assert.match(identityFingerprint(override), /^override\|/);
  assert.notEqual(identityFingerprint(single), identityFingerprint(series));
});

test("series identity embeds the canonical rule: same rule matches, different splits", () => {
  const a = eventOf("UID:a@example.test\nDTSTART:20260706T093000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;WKST=MO\nSUMMARY:Sync");
  const b = eventOf("UID:b@example.test\nDTSTART:20260706T093000Z\nRRULE:BYDAY=MO;FREQ=WEEKLY\nSUMMARY:Sync");
  const c = eventOf("UID:c@example.test\nDTSTART:20260706T093000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;INTERVAL=2\nSUMMARY:Sync");
  assert.equal(identityFingerprint(a), identityFingerprint(b));
  assert.notEqual(identityFingerprint(a), identityFingerprint(c));
});
