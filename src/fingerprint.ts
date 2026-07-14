/**
 * Event identity beyond UID. When two feeds carry the same real-world
 * event under different UIDs (a Google export next to the Outlook invite,
 * an app's re-export, a forwarded invitation), the UID is useless — but
 * the *shape* of the event is not. The fingerprint is a conservative
 * identity: normalized title + exact start (on its own clock) + exact
 * duration. All three must agree; calknit never merges on title alone.
 */

import { dateTimeKey } from "./datetime.js";
import { canonicalRRule } from "./rrule.js";
import { CalEvent } from "./types.js";

/**
 * Title prefixes that mail clients and "add to calendar" flows bolt onto
 * the same event. Stripped repeatedly, so "FW: Invitation: Standup"
 * normalizes to "standup". Deliberately NOT stripped: "Canceled:" and
 * "Declined:" — those change what the event *is*.
 */
const NOISE_PREFIXES = [
  "re:",
  "fw:",
  "fwd:",
  "invitation:",
  "updated invitation:",
  "invite:",
  "copy of ",
];

const NOISE_SUFFIXES = [" (copy)"];

/** Normalize a SUMMARY for identity comparison (see docs/matching.md). */
export function normalizeSummary(summary: string): string {
  let s = summary.toLowerCase().replace(/\s+/g, " ").trim();
  for (;;) {
    let changed = false;
    for (const prefix of NOISE_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length).trim();
        changed = true;
      }
    }
    for (const suffix of NOISE_SUFFIXES) {
      if (s.endsWith(suffix)) {
        s = s.slice(0, -suffix.length).trim();
        changed = true;
      }
    }
    if (!changed) return s;
  }
}

/**
 * The cross-feed identity fingerprint, or null when the event cannot be
 * fingerprinted (no start, or an empty title after normalization —
 * merging untitled events on time alone would be reckless).
 */
export function eventFingerprint(ev: CalEvent): string | null {
  if (ev.start === null) return null;
  const title = normalizeSummary(ev.summary);
  if (title === "") return null;
  const dur = ev.durationSeconds === null ? "-" : String(ev.durationSeconds);
  return `${title}|${dateTimeKey(ev.start)}|${dur}`;
}

/**
 * The identity key used for cross-feed grouping. Recurring masters embed
 * their canonical RRULE (two series only merge when the rule is the
 * same); detached overrides embed their RECURRENCE-ID; plain events use
 * the bare fingerprint.
 */
export function identityFingerprint(ev: CalEvent): string | null {
  const fp = eventFingerprint(ev);
  if (fp === null) return null;
  if (ev.rrule !== null) return `series|${fp}|${canonicalRRule(ev.rrule)}`;
  if (ev.rruleRaw !== null) return `series|${fp}|raw:${normalizeRawRule(ev.rruleRaw)}`;
  if (ev.recurrenceId !== null) return `override|${fp}|${dateTimeKey(ev.recurrenceId)}`;
  return `single|${fp}`;
}

/** Fallback canonicalization for rules that failed to parse: sorted parts. */
function normalizeRawRule(raw: string): string {
  return raw
    .split(";")
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p !== "" && p !== "INTERVAL=1" && p !== "WKST=MO")
    .sort()
    .join(";");
}
