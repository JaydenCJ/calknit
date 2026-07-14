/**
 * Report rendering: the merge summary printed to stderr, the `explain`
 * walkthrough of every identity decision, `inspect` tables, and their
 * `--json` twins. Human output is stable enough to grep; JSON output is
 * the machine contract (shape documented in the README).
 */

import { describeDateTime } from "./datetime.js";
import { FeedStats } from "./inspect.js";
import { KnitReport } from "./knit.js";
import { CalEvent } from "./types.js";
import { VERSION } from "./version.js";

/** The one-screen merge summary (stderr companion of the .ics output). */
export function renderMergeSummary(report: KnitReport): string {
  const lines: string[] = [];
  const feedList = report.feeds.map((f) => `${f.name} ${f.events}`).join(", ");
  lines.push(`calknit ${VERSION} — knitted ${report.feeds.length} feed${plural(report.feeds.length)}`);
  lines.push(`  input:  ${report.inputEvents} event${plural(report.inputEvents)} (${feedList})`);
  lines.push(
    `  identity: ${report.stats.uid} uid duplicate${plural(report.stats.uid)}, ` +
      `${report.stats.fingerprint} fingerprint duplicate${plural(report.stats.fingerprint)}, ` +
      `${report.stats.absorbed} flattened instance${plural(report.stats.absorbed)} absorbed`
  );
  if (report.filled.length > 0) {
    lines.push(`  filled: ${report.filled.join(", ")}`);
  }
  if (report.conflicts.length > 0) {
    lines.push(
      `  conflicts: ${report.conflicts.length} (freshest copy kept; see \`calknit explain\`)`
    );
  }
  for (const w of report.warnings) lines.push(`  warning: ${w}`);
  lines.push(
    `  output: ${report.outputEvents} event${plural(report.outputEvents)}, ${report.timezones} timezone${plural(report.timezones)}`
  );
  return lines.join("\n");
}

/** The full `calknit explain` walkthrough: every group, every decision. */
export function renderExplain(report: KnitReport): string {
  const lines: string[] = [];
  lines.push(
    `calknit ${VERSION} — explain: ${report.feeds.length} feed${plural(report.feeds.length)}, ` +
      `${report.inputEvents} event${plural(report.inputEvents)} in, ${report.outputEvents} out`
  );

  let uniques = 0;
  for (const m of report.merged) {
    if (m.group.reason === "unique") {
      uniques++;
      continue;
    }
    lines.push("");
    lines.push(`= merged (${m.group.reason}): ${describeEvent(m.winner)}`);
    lines.push(`    kept    ${m.winner.feedName}  ${provenance(m.winner)}`);
    for (const ev of m.group.events) {
      if (ev === m.winner) continue;
      lines.push(`    dropped ${ev.feedName}  ${provenance(ev)}`);
    }
    for (const fill of m.filled) lines.push(`    filled  ${fill}`);
    for (const c of m.conflicts) {
      lines.push(`    conflict ${c.prop}: kept "${c.kept}", dropped "${c.dropped}" (${c.droppedFeed})`);
    }
  }

  for (const a of report.absorbed) {
    lines.push("");
    lines.push(
      `= absorbed by series ${a.seriesUid ?? a.seriesKey}: ` +
        `${describeEvent(a.instance)} from ${a.instance.feedName} ` +
        `(occurrence ${a.occurrence})`
    );
  }

  lines.push("");
  lines.push(`${uniques} event${plural(uniques)} unique — kept as-is`);
  for (const w of report.warnings) lines.push(`warning: ${w}`);
  return lines.join("\n");
}

/** Machine-readable twin of the merge report. */
export function mergeReportJson(report: KnitReport): unknown {
  return {
    calknit: VERSION,
    feeds: report.feeds,
    input: { events: report.inputEvents },
    output: { events: report.outputEvents, timezones: report.timezones },
    identity: report.stats,
    groups: report.merged
      .filter((m) => m.group.reason !== "unique")
      .map((m) => ({
        reason: m.group.reason,
        kept: eventJson(m.winner),
        dropped: m.group.events.filter((e) => e !== m.winner).map(eventJson),
        filled: m.filled,
        conflicts: m.conflicts,
      })),
    absorbed: report.absorbed.map((a) => ({
      instance: eventJson(a.instance),
      seriesUid: a.seriesUid,
      occurrence: a.occurrence,
    })),
    warnings: report.warnings,
  };
}

/** Human `inspect` rendering for a list of feeds. */
export function renderInspect(stats: FeedStats[]): string {
  const lines: string[] = [];
  for (const s of stats) {
    lines.push(`${s.name}${s.calname ? ` (${s.calname})` : ""}`);
    lines.push(
      `  events: ${s.events} (${s.singles} single, ${s.series} series, ${s.overrides} override${plural(s.overrides)})`
    );
    if (s.timezones.length > 0) lines.push(`  timezones: ${s.timezones.join(", ")}`);
    if (s.earliest !== null) lines.push(`  range: ${s.earliest} -> ${s.latest}`);
    for (const w of s.warnings) lines.push(`  warning: ${w}`);
  }
  return lines.join("\n");
}

/** Machine-readable twin of `inspect`. */
export function inspectJson(stats: FeedStats[]): unknown {
  return { calknit: VERSION, feeds: stats };
}

function describeEvent(ev: CalEvent): string {
  const title = ev.summary !== "" ? `"${ev.summary}"` : "(untitled)";
  const when = ev.start ? ` ${describeDateTime(ev.start)}` : "";
  return `${title}${when}`;
}

function provenance(ev: CalEvent): string {
  const uid = ev.uid ?? "(no uid)";
  const seq = ev.sequence > 0 ? ` seq ${ev.sequence}` : "";
  return `uid ${uid}${seq}`;
}

function eventJson(ev: CalEvent): unknown {
  return {
    feed: ev.feedName,
    uid: ev.uid,
    summary: ev.summary,
    start: ev.start ? describeDateTime(ev.start) : null,
    sequence: ev.sequence,
  };
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}
