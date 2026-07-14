# Canonical output format

`calknit merge` always serializes the same merged set to the same bytes.
That makes merged calendars diffable in git, re-runs idempotent
(merging a merged file changes nothing) and downstream caching trivial.

## Calendar envelope

```text
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//calknit//calknit 0.1.0//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:<only with --calname>
<VTIMEZONEs>
<VEVENTs>
END:VCALENDAR
```

## VTIMEZONE selection

Only timezone definitions still referenced by a `TZID=` parameter
anywhere in the output are emitted, deduplicated by literal TZID (first
definition seen wins), sorted by TZID. Definitions themselves pass
through byte-preserved — calknit never rewrites offset rules.

## Event ordering

Events sort by start (wall clock; all-day dates at midnight), then
start key, UID, `RECURRENCE-ID`, summary. Ties cannot reorder between
runs.

## Property ordering inside a VEVENT

Fixed order first, then anything else alphabetically (stable for
repeats such as `EXDATE` lists):

```text
UID, RECURRENCE-ID, SEQUENCE, DTSTAMP, CREATED, LAST-MODIFIED,
DTSTART, DTEND, DURATION, RRULE, RDATE, EXDATE,
SUMMARY, LOCATION, GEO, DESCRIPTION, STATUS, TRANSP, CLASS, PRIORITY,
URL, CATEGORIES, ORGANIZER, ATTENDEE
```

Property values are byte-preserved from the winning copy; parameters are
re-rendered sorted by name, quoted only when the value contains `:`,
`;` or `,`. Nested components (`VALARM`) keep their original property
order.

## Line discipline

- CRLF line endings throughout, trailing newline at EOF.
- RFC 5545 §3.1 folding at 75 octets per physical line, continuation
  lines prefixed with one space; folds never split a UTF-8 sequence.
- Multi-valued `EXDATE`/`RDATE` properties from inputs are split to one
  value per line during union, deduplicated by (parameters, value) and
  sorted by value.

## Timestamps

calknit invents no timestamps. `DTSTAMP` is copied from the winning
event; when an input event lacks one, a `DTSTAMP` is synthesized only if
`SOURCE_DATE_EPOCH` is set (the reproducible-builds convention), and the
output is deterministic either way.
