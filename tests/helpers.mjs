// Shared test helpers: tiny .ics builders, an extraction shortcut through
// the real parse pipeline, and a runner for the compiled CLI. Everything
// is offline and deterministic — no wall clock, no network, no host
// timezone involvement.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractEvents, parseFeed } from "../dist/index.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = join(ROOT, "dist", "cli.js");

/** A fixed epoch (2026-07-12T00:00:00Z) for synthesized DTSTAMPs. */
export const EPOCH = "1783814400";

/** Wrap VEVENT bodies into a complete VCALENDAR text (CRLF, as on the wire). */
export function calendar(...events) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//test//EN"];
  for (const body of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(...body.trim().split("\n"));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** Parse + extract events from a calendar text through the real pipeline. */
export function eventsFrom(text, feedIndex = 0, feedName = "test.ics") {
  const parsed = parseFeed(text, feedName);
  return extractEvents(parsed.calendars, feedIndex, feedName).events;
}

/** First event of a single-event calendar built from `body`. */
export function eventOf(body, feedIndex = 0, feedName = "test.ics") {
  return eventsFrom(calendar(body), feedIndex, feedName)[0];
}

/** Create a temp dir with .ics files; returns paths and a cleanup fn. */
export function makeFeedDir(files) {
  const dir = mkdtempSync(join(tmpdir(), "calknit-test-"));
  const paths = {};
  for (const [name, text] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, text);
    paths[name] = p;
  }
  return {
    dir,
    paths,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Run the compiled CLI; never throws — returns { code, stdout, stderr }. */
export function runCli(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, SOURCE_DATE_EPOCH: EPOCH, ...(opts.env ?? {}) },
    cwd: opts.cwd,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
