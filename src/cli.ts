#!/usr/bin/env node
/**
 * The calknit command line. Exit codes are stable API:
 *   0  success
 *   1  --strict rejected warnings or field conflicts
 *   2  usage, parse or IO error
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inspectFeed } from "./inspect.js";
import { knitFeeds, FeedInput } from "./knit.js";
import { MatchLevel } from "./match.js";
import {
  inspectJson,
  mergeReportJson,
  renderExplain,
  renderInspect,
  renderMergeSummary,
} from "./report.js";
import { ParseError, UsageError } from "./types.js";
import { VERSION } from "./version.js";

const HELP = `calknit ${VERSION} — merge .ics feeds into one deduplicated canonical calendar

Usage: calknit <command> [options] <feed.ics...>

Commands:
  merge <feed.ics...>     knit feeds into one calendar (stdout, or -o FILE)
  explain <feed.ics...>   show every identity decision; writes nothing
  inspect <feed.ics...>   per-feed statistics

Options:
  -o, --output <file>     merge: write the calendar here instead of stdout
  --calname <name>        merge: set X-WR-CALNAME on the output
  --match <level>         uid | fingerprint | full        (default: full)
                            uid          same UID only
                            fingerprint  + title/start/duration identity
                            full         + recurrence-aware absorption
  --horizon <days>        absorption look-ahead per series (default: 1096)
  --json                  machine-readable output (report on stderr for merge)
  --quiet                 merge: suppress the stderr report
  --strict                exit 1 on input warnings or field conflicts
  -V, --version           print the calknit version
  -h, --help              show this help

Exit codes: 0 ok, 1 strict violations, 2 usage/parse/IO error.`;

interface ParsedArgs {
  command: string | null;
  files: string[];
  output: string | null;
  calname: string | null;
  match: MatchLevel;
  horizonDays: number;
  json: boolean;
  quiet: boolean;
  strict: boolean;
  help: boolean;
  version: boolean;
}

/** Parse process.argv (after node + script). Unknown flags are fatal. */
export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: null,
    files: [],
    output: null,
    calname: null,
    match: "full",
    horizonDays: 1096,
    json: false,
    quiet: false,
    strict: false,
    help: false,
    version: false,
  };

  const takeValue = (flag: string, i: number): string => {
    const v = argv[i + 1];
    if (v === undefined) throw new UsageError(`${flag} requires a value`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-V":
      case "--version":
        args.version = true;
        break;
      case "-o":
      case "--output":
        args.output = takeValue(arg, i);
        i++;
        break;
      case "--calname":
        args.calname = takeValue(arg, i);
        i++;
        break;
      case "--match": {
        const v = takeValue(arg, i);
        i++;
        if (v !== "uid" && v !== "fingerprint" && v !== "full") {
          throw new UsageError(`--match must be uid, fingerprint or full (got: ${v})`);
        }
        args.match = v;
        break;
      }
      case "--horizon": {
        const v = takeValue(arg, i);
        i++;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) {
          throw new UsageError(`--horizon must be a positive integer of days (got: ${v})`);
        }
        args.horizonDays = n;
        break;
      }
      case "--json":
        args.json = true;
        break;
      case "--quiet":
        args.quiet = true;
        break;
      case "--strict":
        args.strict = true;
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option: ${arg}`);
        if (args.command === null) args.command = arg;
        else args.files.push(arg);
        break;
    }
  }
  return args;
}

function readFeeds(files: string[]): FeedInput[] {
  if (files.length === 0) throw new UsageError("no input feeds given");
  return files.map((file) => {
    if (!existsSync(file)) throw new UsageError(`no such file: ${file}`);
    return { name: baseName(file), text: readFileSync(file, "utf8") };
  });
}

function baseName(file: string): string {
  const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return cut >= 0 ? file.slice(cut + 1) : file;
}

function sourceDateEpoch(): number | null {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function run(argv: string[]): number {
  const args = parseArgs(argv);
  if (args.version) {
    console.log(VERSION);
    return 0;
  }
  if (args.help || args.command === null) {
    console.log(HELP);
    return args.help ? 0 : 2;
  }

  switch (args.command) {
    case "merge": {
      const result = knitFeeds(readFeeds(args.files), {
        match: args.match,
        horizonDays: args.horizonDays,
        calname: args.calname,
        sourceDateEpoch: sourceDateEpoch(),
      });
      if (args.output !== null) {
        writeFileSync(args.output, result.ics);
      } else {
        process.stdout.write(result.ics);
      }
      if (!args.quiet) {
        const report = args.json
          ? JSON.stringify(mergeReportJson(result.report), null, 2)
          : renderMergeSummary(result.report);
        process.stderr.write(report + "\n");
      }
      if (args.strict && (result.report.warnings.length > 0 || result.report.conflicts.length > 0)) {
        return 1;
      }
      return 0;
    }
    case "explain": {
      const result = knitFeeds(readFeeds(args.files), {
        match: args.match,
        horizonDays: args.horizonDays,
        calname: args.calname,
        sourceDateEpoch: sourceDateEpoch(),
      });
      const out = args.json
        ? JSON.stringify(mergeReportJson(result.report), null, 2)
        : renderExplain(result.report);
      console.log(out);
      if (args.strict && (result.report.warnings.length > 0 || result.report.conflicts.length > 0)) {
        return 1;
      }
      return 0;
    }
    case "inspect": {
      const feeds = readFeeds(args.files);
      const stats = feeds.map((f) => inspectFeed(f.name, f.text));
      const out = args.json ? JSON.stringify(inspectJson(stats), null, 2) : renderInspect(stats);
      console.log(out);
      if (args.strict && stats.some((s) => s.warnings.length > 0)) return 1;
      return 0;
    }
    default:
      throw new UsageError(`unknown command: ${args.command}`);
  }
}

function main(): void {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError || e instanceof ParseError) {
      console.error(`calknit: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }
}

main();
