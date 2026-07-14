# Contributing to calknit

Issues, discussions and pull requests are all welcome — this project
aims to stay small, zero-dependency at runtime, and predictable: same
feeds in, same bytes out.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/calknit.git
cd calknit
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 89 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/feeds
```

`scripts/smoke.sh` exercises the real CLI (the three-feed merge with its
exact identity accounting, EXDATE union, field fill, determinism and
idempotence via `cmp`, `explain`, both `--json` reports, `--match uid`,
`--strict`, and every error path) and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (the parser, recurrence engine, fingerprints and serializer
   all take strings and plain data, never file handles).
5. Anything that changes identity decisions (fingerprint components,
   noise prefixes, TZID aliases, absorption rules) must update
   docs/matching.md and the captured outputs in the README.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- No network calls, ever — the tool reads .ics files and writes an .ics
  file.
- On-disk and on-pipe formats are stable API: the canonical output
  rules (docs/canonical-format.md), the `--json` report shapes and the
  CLI exit codes (0/1/2) must not change meaning within a major version.
- Keep output deterministic: same feeds, options and
  `SOURCE_DATE_EPOCH` must produce byte-identical calendars (the suite
  asserts this).
- Matching must stay conservative: prefer leaving two events unmerged
  over merging two that are different. New heuristics need negative
  tests proving they do not over-match.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `calknit --version` output, the exact command line, the
`calknit explain` output for the affected group, and the smallest pair
of feeds (or trimmed VEVENT snippets) that reproduces the problem. For
wrong-merge reports, the two events that should not have matched are
the most useful thing you can share; for missed-merge reports, the two
that should have.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
