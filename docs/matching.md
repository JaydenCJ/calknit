# The identity rulebook

How calknit decides that two VEVENTs from different feeds are the same
real-world event. Three passes run in order, strongest evidence first;
every decision is visible via `calknit explain` (and `--json`).

## Pass 1 — UID identity

Two events are the same when they share both:

- `UID`
- `RECURRENCE-ID` (or both lack one)

This is RFC 5545's own identity, so it is always on — even under
`--match uid`. A recurring master (`UID` without `RECURRENCE-ID`) and a
detached override (`UID` with `RECURRENCE-ID`) are *different* events and
never merge with each other.

## Pass 2 — fingerprint identity

Feeds routinely carry the same event under different UIDs: a provider
export next to the mail-client invite, an app re-export, a forwarded
invitation. For those, calknit computes a conservative fingerprint; two
events merge only when **all three** components agree:

| Component | Rule |
|---|---|
| Title | `SUMMARY`, lowercased, whitespace collapsed, noise prefixes stripped |
| Start | Same instant *on the same clock* (see below) |
| Duration | From `DTEND` or `DURATION`, exact match in seconds |

Noise prefixes stripped from titles (repeatedly, so stacks resolve):
`re:`, `fw:`, `fwd:`, `invitation:`, `updated invitation:`, `invite:`,
`copy of`, plus a trailing `(copy)`. Semantic prefixes such as
`Canceled:` are **not** stripped — a cancellation notice is not the
event itself. Events with no `DTSTART` or no usable title never
fingerprint; they can still merge by UID.

Starts compare on their own clock, so an all-day date, a UTC instant, a
floating time and a zoned time can never cross-match. Zoned times
compare as (normalized TZID, local time): Windows display names
("W. Europe Standard Time"), globally-unique-ID paths and quoting are
normalized away (see `src/tzalias.ts`), so an Outlook copy matches its
IANA-labelled twin without any offset math. Two clocks that merely
*represent* the same instant in different zones are treated as
different — for duplicate detection that trade favors precision, and
duplicates in practice preserve the zone of their source.

Recurring masters additionally embed their **canonical RRULE** in the
fingerprint: parts are sorted, defaults (`INTERVAL=1`, `WKST=MO`)
dropped, values normalized. `FREQ=WEEKLY;BYDAY=WE,MO` merges with
`BYDAY=MO,WE;FREQ=WEEKLY`, but never with an `INTERVAL=2` variant.
Detached overrides embed their `RECURRENCE-ID` instead.

## Pass 3 — recurrence absorption

Some exporters flatten recurring events into standalone copies of each
occurrence. After passes 1–2, calknit expands every surviving series
(its RRULE plus `RDATE`s, minus the group-wide `EXDATE` union) and drops
each standalone event that:

1. has no RRULE and no `RECURRENCE-ID` of its own,
2. matches a series in normalized title **and** duration, and
3. starts exactly on a computed occurrence.

An instance on an `EXDATE`d slot is deliberately **kept**: the series
says that occurrence did not happen, the standalone copy says it did —
calknit preserves the evidence instead of guessing. Expansion is bounded
by `--horizon` (default 1096 days from each series start) and an
internal occurrence cap; rules calknit cannot expand (`BYHOUR`,
`BYWEEKNO`, ordinal `BYDAY` under `WEEKLY`, ...) parse fine but only
merge by exact-rule equality and never absorb.

## What merging keeps

Within a matched group the freshest copy wins: highest `SEQUENCE`, then
newest `LAST-MODIFIED`, then newest `DTSTAMP`, then the feed listed
first on the command line. Losers donate fields the winner lacks
(`LOCATION`, `DESCRIPTION`, `URL`, `GEO`, `CATEGORIES`, `ORGANIZER`,
`CLASS`, `STATUS`), and `EXDATE`/`RDATE` sets union across all copies of
a series. Any disagreement on a visible field (`SUMMARY`, `LOCATION`,
`DTSTART`, `DTEND`, `STATUS`) is recorded as a conflict in the report;
`--strict` turns conflicts and input warnings into exit code 1.
