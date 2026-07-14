/**
 * Cross-feed identity resolution — the heart of calknit. Three passes,
 * strongest evidence first:
 *
 *   1. UID          — identical (UID, RECURRENCE-ID) across feeds is the
 *                     same event, per RFC 5545 semantics.
 *   2. Fingerprint  — different UIDs, same normalized title + start +
 *                     duration (masters also require the same canonical
 *                     RRULE) — the export/import duplicate case.
 *   3. Absorption   — a standalone copy of one occurrence of a surviving
 *                     recurring series (same title + duration, start
 *                     falls on a computed occurrence, not EXDATEd) is
 *                     swallowed by the series — the "exporter flattened
 *                     the recurrence" case.
 *
 * Every decision is recorded so `calknit explain` can show its work.
 */

import { dateTimeKey, naiveSeconds } from "./datetime.js";
import { eventFingerprint, identityFingerprint, normalizeSummary } from "./fingerprint.js";
import { expandOccurrences, isExpandable } from "./rrule.js";
import { Absorption, CalEvent, MatchGroup } from "./types.js";

export type MatchLevel = "uid" | "fingerprint" | "full";

export interface MatchOptions {
  /** How aggressive identity matching is; default "full". */
  level: MatchLevel;
  /** How far past a series start absorption will look, in days. */
  horizonDays: number;
  /** Hard cap on expanded occurrences per series. */
  maxOccurrences: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  level: "full",
  horizonDays: 1096, // three years
  maxOccurrences: 3660,
};

export interface MatchOutcome {
  /** Surviving groups, in first-seen input order; each becomes one output event. */
  groups: MatchGroup[];
  absorbed: Absorption[];
  /** Count of duplicate events folded in by each pass. */
  stats: { uid: number; fingerprint: number; absorbed: number };
}

/** Resolve identity across every event of every feed. */
export function matchEvents(
  events: CalEvent[],
  options?: Partial<MatchOptions>
): MatchOutcome {
  const opts: MatchOptions = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const stats = { uid: 0, fingerprint: 0, absorbed: 0 };

  // Pass 1 — UID identity. Events without a UID can never match here.
  const byKey = new Map<string, MatchGroup>();
  const groups: MatchGroup[] = [];
  let anon = 0;
  for (const ev of events) {
    const key =
      ev.uid !== null
        ? `uid:${ev.uid}|rid:${ev.recurrenceId ? dateTimeKey(ev.recurrenceId) : "-"}`
        : `anon:${anon++}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.events.push(ev);
      existing.reason = "uid";
      stats.uid++;
    } else {
      const group: MatchGroup = { events: [ev], reason: "unique", key };
      byKey.set(key, group);
      groups.push(group);
    }
  }

  // Pass 2 — fingerprint identity between groups that UID kept apart.
  let merged: MatchGroup[] = groups;
  if (opts.level !== "uid") {
    const byFp = new Map<string, MatchGroup>();
    merged = [];
    for (const group of groups) {
      const fp = groupIdentity(group);
      if (fp === null) {
        merged.push(group);
        continue;
      }
      const existing = byFp.get(fp);
      if (existing) {
        stats.fingerprint += group.events.length;
        existing.events.push(...group.events);
        existing.reason = "fingerprint";
        existing.key = fp;
      } else {
        byFp.set(fp, group);
        merged.push(group);
      }
    }
  }

  // Pass 3 — recurrence absorption of flattened instances.
  const absorbed: Absorption[] = [];
  if (opts.level === "full") {
    const seriesIndex = buildSeriesIndex(merged, opts);
    const survivors: MatchGroup[] = [];
    for (const group of merged) {
      const hit = absorbCandidate(group, seriesIndex);
      if (hit) {
        for (const ev of group.events) {
          absorbed.push({
            instance: ev,
            seriesKey: hit.group.key,
            seriesUid: hit.group.events[0]!.uid,
            occurrence: hit.occurrence,
          });
          stats.absorbed++;
        }
      } else {
        survivors.push(group);
      }
    }
    merged = survivors;
  }

  return { groups: merged, absorbed, stats };
}

/** The identity fingerprint of a group: first member that yields one. */
function groupIdentity(group: MatchGroup): string | null {
  for (const ev of group.events) {
    const fp = identityFingerprint(ev);
    if (fp !== null) return fp;
  }
  return null;
}

interface SeriesEntry {
  group: MatchGroup;
  /** dateTimeKeys of every computed occurrence (EXDATEs removed, RDATEs added). */
  occurrences: Set<string>;
  /** Occurrence *days* (YYYYMMDD) with a DATE-typed EXDATE, for cross-type exclusion. */
  excludedDays: Set<string>;
}

/** Index surviving recurring series by (normalized title, duration). */
function buildSeriesIndex(
  groups: MatchGroup[],
  opts: MatchOptions
): Map<string, SeriesEntry[]> {
  // Absorption only needs occurrences up to the latest standalone start.
  let latestCandidate = -Infinity;
  for (const g of groups) {
    const rep = g.events[0]!;
    if (rep.rrule === null && rep.rruleRaw === null && rep.recurrenceId === null && rep.start) {
      latestCandidate = Math.max(latestCandidate, naiveSeconds(rep.start));
    }
  }

  const index = new Map<string, SeriesEntry[]>();
  if (latestCandidate === -Infinity) return index;

  for (const group of groups) {
    const master = group.events.find((ev) => ev.rrule !== null && ev.start !== null);
    if (!master || !isExpandable(master.rrule!)) continue;
    const title = normalizeSummary(master.summary);
    if (title === "") continue;

    const horizon = Math.min(
      latestCandidate,
      naiveSeconds(master.start!) + opts.horizonDays * 86400
    );
    const occs = expandOccurrences(master.start!, master.rrule!, {
      untilNaive: horizon,
      maxOccurrences: opts.maxOccurrences,
    });
    if (occs === null) continue;

    const occurrences = new Set<string>(occs.map(dateTimeKey));
    const excludedDays = new Set<string>();
    for (const ev of group.events) {
      for (const rdate of ev.rdates) occurrences.add(dateTimeKey(rdate));
      for (const ex of ev.exdates) {
        occurrences.delete(dateTimeKey(ex));
        if (ex.kind === "date") {
          excludedDays.add(dateTimeKey(ex).slice("date:".length));
        }
      }
    }

    const durKey = master.durationSeconds === null ? "-" : String(master.durationSeconds);
    const key = `${title}|${durKey}`;
    const list = index.get(key) ?? [];
    list.push({ group, occurrences, excludedDays });
    index.set(key, list);
  }
  return index;
}

/** If `group` is a flattened instance of an indexed series, say which. */
function absorbCandidate(
  group: MatchGroup,
  index: Map<string, SeriesEntry[]>
): { group: MatchGroup; occurrence: string } | null {
  const rep = group.events[0]!;
  // Only plain single events are candidates: masters, overrides and
  // unparseable-rule events are never absorbed.
  if (rep.rrule !== null || rep.rruleRaw !== null || rep.recurrenceId !== null) return null;
  if (rep.start === null) return null;
  if (eventFingerprint(rep) === null) return null;

  const title = normalizeSummary(rep.summary);
  const durKey = rep.durationSeconds === null ? "-" : String(rep.durationSeconds);
  const entries = index.get(`${title}|${durKey}`);
  if (!entries) return null;

  const startKey = dateTimeKey(rep.start);
  const dayKey = startKey.includes("T")
    ? startKey.slice(startKey.indexOf(":") + 1, startKey.indexOf("T"))
    : startKey.slice("date:".length);
  for (const entry of entries) {
    if (entry.excludedDays.has(dayKey)) continue;
    if (entry.occurrences.has(startKey)) {
      return { group: entry.group, occurrence: startKey };
    }
  }
  return null;
}
