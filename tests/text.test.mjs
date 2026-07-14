// TEXT escaping at the edges: what \n, \, \; and \\ mean on the wire,
// and that escape/unescape round-trips exactly.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { escapeText, unescapeText } from "../dist/index.js";

test("unescape resolves the four TEXT escapes; a lone backslash survives", () => {
  assert.equal(unescapeText("a\\nb\\Nc"), "a\nb\nc");
  assert.equal(unescapeText("x\\, y\\; z\\\\w"), "x, y; z\\w");
  assert.equal(unescapeText("path\\"), "path\\");
});

test("escape encodes the reserved characters and collapses CRLF to \\n", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(escapeText("one\r\ntwo"), "one\\ntwo");
});

test("escape/unescape round-trips arbitrary prose", () => {
  const prose = 'Notes: 1) bring\\slides, 2) room "B;2", 3) agenda\nitems, done';
  assert.equal(unescapeText(escapeText(prose)), prose);
});
