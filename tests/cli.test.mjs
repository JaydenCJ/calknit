// The compiled CLI end to end: real subprocesses, the bundled example
// feeds, temp-dir outputs, exit codes and both report formats.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EPOCH, ROOT, calendar, makeFeedDir, runCli } from "./helpers.mjs";

const FEEDS = ["work.ics", "personal.ics", "team-export.ics"].map((f) =>
  join(ROOT, "examples", "feeds", f)
);

test("self-description: --version matches package.json, --help lists commands", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const version = runCli(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = runCli(["--help"]);
  assert.equal(help.code, 0);
  for (const word of ["merge", "explain", "inspect", "--match", "--strict", "--calname"]) {
    assert.ok(help.stdout.includes(word), `help missing ${word}`);
  }
});

test("merge of the example feeds: calendar on stdout, report on stderr", () => {
  const r = runCli(["merge", ...FEEDS]);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(r.stdout.trimEnd().endsWith("END:VCALENDAR"));
  assert.equal([...r.stdout.matchAll(/BEGIN:VEVENT/g)].length, 8);
  assert.match(r.stderr, /input: {2}15 events/);
  assert.match(r.stderr, /1 uid duplicate, 3 fingerprint duplicates, 3 flattened instances absorbed/);
  assert.match(r.stderr, /output: 8 events, 2 timezones/);
  // The merged series carries the EXDATE union from both feeds.
  assert.ok(r.stdout.includes("EXDATE;TZID=Europe/Berlin:20260810T093000"));
  assert.ok(r.stdout.includes("EXDATE;TZID=W. Europe Standard Time:20260824T093000"));
});

test("-o writes the calendar to a file; stdout stays empty", () => {
  const { dir, cleanup } = makeFeedDir({});
  try {
    const out = join(dir, "merged.ics");
    const r = runCli(["merge", ...FEEDS, "-o", out]);
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "");
    assert.ok(readFileSync(out, "utf8").startsWith("BEGIN:VCALENDAR"));
  } finally {
    cleanup();
  }
});

test("two --quiet runs over the same feeds are silent and byte-identical", () => {
  const a = runCli(["merge", ...FEEDS, "--quiet"]);
  const b = runCli(["merge", ...FEEDS, "--quiet"]);
  assert.equal(a.code, 0);
  assert.equal(a.stderr, "");
  assert.equal(a.stdout, b.stdout);
});

test("flag plumbing: --calname stamps the header, --match uid narrows matching", () => {
  const named = runCli(["merge", ...FEEDS, "--quiet", "--calname", "Everything"]);
  assert.ok(named.stdout.includes("X-WR-CALNAME:Everything"));
  const uidOnly = runCli(["merge", ...FEEDS, "--match", "uid"]);
  assert.equal(uidOnly.code, 0);
  // Only the shared-UID design review collapses; 15 - 1 = 14 events.
  assert.equal([...uidOnly.stdout.matchAll(/BEGIN:VEVENT/g)].length, 14);
});

test("explain names the winner, the dropped copies and each absorption", () => {
  const r = runCli(["explain", ...FEEDS]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /merged \(uid\): "Design review"/);
  assert.match(r.stdout, /kept {4}team-export\.ics/);
  assert.match(r.stdout, /conflict LOCATION: kept "Room Curie \(moved\)"/);
  assert.match(r.stdout, /absorbed by series team-sync-2026@example\.test/);
  assert.match(r.stdout, /4 events unique/);
});

test("merge --json emits the machine report on stderr", () => {
  const r = runCli(["merge", ...FEEDS, "--json"]);
  const report = JSON.parse(r.stderr);
  assert.equal(report.calknit, "0.1.0");
  assert.equal(report.input.events, 15);
  assert.equal(report.output.events, 8);
  assert.deepEqual(report.identity, { uid: 1, fingerprint: 3, absorbed: 3 });
  assert.equal(report.absorbed.length, 3);
  assert.ok(report.groups.every((g) => ["uid", "fingerprint"].includes(g.reason)));
});

test("inspect summarizes each feed; --json parses", () => {
  const human = runCli(["inspect", FEEDS[0]]);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /work\.ics \(Work\)/);
  assert.match(human.stdout, /events: 5 \(3 single, 2 series, 0 overrides\)/);
  const json = JSON.parse(runCli(["inspect", ...FEEDS, "--json"]).stdout);
  assert.equal(json.feeds.length, 3);
  assert.equal(json.feeds[1].calname, "Personal");
});

test("--strict exits 1 when the merge had field conflicts", () => {
  const r = runCli(["merge", ...FEEDS, "--strict", "--quiet"]);
  assert.equal(r.code, 1);
  // The calendar is still produced — strict only changes the exit code.
  assert.ok(r.stdout.startsWith("BEGIN:VCALENDAR"));
});

test("--strict stays 0 on a clean merge; SOURCE_DATE_EPOCH pins DTSTAMP", () => {
  const { paths, cleanup } = makeFeedDir({
    "a.ics": calendar("UID:x@example.test\nDTSTART:20260712T090000Z\nSUMMARY:Solo"),
  });
  try {
    const r = runCli(["merge", paths["a.ics"], "--strict", "--quiet"]);
    assert.equal(r.code, 0);
    // helpers.runCli exports SOURCE_DATE_EPOCH=2026-07-12T00:00:00Z.
    assert.equal(EPOCH, "1783814400");
    assert.ok(r.stdout.includes("DTSTAMP:20260712T000000Z"));
  } finally {
    cleanup();
  }
});

test("usage errors (including no command at all) exit 2 with a message", () => {
  assert.equal(runCli([]).code, 2);
  for (const args of [
    ["merge"],
    ["merge", "--frobnicate"],
    ["merge", "--match", "psychic", FEEDS[0]],
    ["merge", "--horizon", "-3", FEEDS[0]],
    ["frobnicate", FEEDS[0]],
    ["merge", "/nonexistent/feed.ics"],
  ]) {
    const r = runCli(args);
    assert.equal(r.code, 2, `expected exit 2 for: ${args.join(" ")}`);
    assert.match(r.stderr, /^calknit: /);
  }
});

test("a structurally broken feed exits 2 and names the file", () => {
  const { paths, cleanup } = makeFeedDir({
    "broken.ics": "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x@example.test\r\n",
  });
  try {
    const r = runCli(["merge", paths["broken.ics"]]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /broken\.ics: unterminated/);
  } finally {
    cleanup();
  }
});
