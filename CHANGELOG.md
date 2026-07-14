# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-12

### Added

- `calknit merge <feeds...>`: knits any number of .ics feeds into one
  deduplicated canonical calendar, written to stdout or `-o FILE`, with
  a one-screen identity report on stderr (`--quiet` to silence,
  `--json` for the machine-readable twin).
- Three-pass cross-feed identity engine: exact `UID`+`RECURRENCE-ID`
  matching; a conservative fingerprint (normalized title + same start
  on the same clock + exact duration, masters additionally requiring an
  equal canonical RRULE); and recurrence absorption that expands
  surviving series to swallow flattened per-occurrence copies.
- RRULE engine supporting DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL,
  COUNT, UNTIL (inclusive; DATE-typed covers the whole day), BYDAY with
  ordinals, negative BYMONTHDAY, BYMONTH, BYSETPOS and WKST; rules with
  parts it cannot expand (BYHOUR, BYWEEKNO, ...) degrade to exact-rule
  matching instead of guessing.
- Title normalization that strips mail-client noise (`Re:`, `FW:`,
  `Invitation:`, `Copy of`, trailing `(copy)`) while preserving
  semantic prefixes such as `Canceled:`.
- TZID normalization: a Windows→IANA alias table plus
  globally-unique-ID-prefix and quote stripping, so
  `W. Europe Standard Time` fingerprints identically to
  `Europe/Berlin` with no offset math and no tz database.
- Freshest-wins merging (`SEQUENCE`, then `LAST-MODIFIED`, `DTSTAMP`,
  then feed order) with field donation from dropped copies
  (LOCATION, DESCRIPTION, URL, GEO, CATEGORIES, ORGANIZER, CLASS,
  STATUS), EXDATE/RDATE union across series copies, and recorded
  conflicts for every visible-field disagreement.
- Canonical deterministic output: fixed property order, sorted events,
  RFC 5545 75-octet UTF-8-safe folding, CRLF endings, referenced-only
  VTIMEZONE passthrough; byte-identical re-runs and idempotent
  re-merges; `SOURCE_DATE_EPOCH` pins synthesized DTSTAMPs.
- `calknit explain`: every kept/dropped/filled/absorbed decision with
  provenance and conflict details; `calknit inspect`: per-feed
  statistics (events, series, overrides, timezones, date range); both
  with `--json`.
- Tolerant RFC 5545 reader (bare LF, tab folds, blank lines, quoted
  multi-valued parameters, concatenated VCALENDARs) that stays strict
  about structural corruption; recoverable oddities become report
  warnings, and `--strict` turns warnings or conflicts into exit 1.
- A programmatic API (`knitFeeds` plus the parser, recurrence,
  fingerprint, match, merge and serializer layers) with type
  declarations.
- Three runnable example feeds (`examples/feeds/`) reproducing a
  work/personal/app-export sprawl, exercising every identity pass.
- Test suite: 89 node:test tests (parser, TEXT escaping, Gregorian
  date math, RRULE semantics incl. the RFC's WKST example,
  fingerprints, matching guards, merge policy, canonical serialization,
  pipeline reports, CLI integration in fresh temp dirs) and an
  end-to-end `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/calknit/releases/tag/v0.1.0
