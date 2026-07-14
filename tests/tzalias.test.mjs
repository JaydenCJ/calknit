// TZID normalization: Windows display names, globally-unique-ID paths
// and quoting all collapse to one comparable zone name.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeTzid } from "../dist/index.js";

test("Windows names, GUID paths, quotes and case collapse to one zone", () => {
  assert.equal(normalizeTzid("Eastern Standard Time"), "america/new_york");
  assert.equal(normalizeTzid("W. Europe Standard Time"), "europe/berlin");
  assert.equal(normalizeTzid("Tokyo Standard Time"), "asia/tokyo");
  assert.equal(normalizeTzid("/example.test/20260101_1/Europe/Berlin"), "europe/berlin");
  assert.equal(normalizeTzid("/tz-registry/America/New_York"), "america/new_york");
  assert.equal(normalizeTzid('"Europe/Berlin"'), "europe/berlin");
  assert.equal(normalizeTzid("EUROPE/BERLIN"), normalizeTzid("Europe/Berlin"));
});

test("unknown zone names pass through — they only match themselves", () => {
  assert.equal(normalizeTzid("Custom/Private_Zone"), "custom/private_zone");
  assert.notEqual(normalizeTzid("Custom/Zone_A"), normalizeTzid("Custom/Zone_B"));
});
