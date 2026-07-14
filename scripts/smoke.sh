#!/usr/bin/env bash
# Smoke test for calknit: exercises the real CLI end to end against the
# bundled example feeds. No network, idempotent, runs from a clean
# checkout (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

export SOURCE_DATE_EPOCH=1783814400 # 2026-07-12T00:00:00Z, reproducible runs

FEEDS="examples/feeds/work.ics examples/feeds/personal.ics examples/feeds/team-export.ics"

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every subcommand.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in merge explain inspect --match --strict --calname --horizon; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Merge the three example feeds; check the identity accounting.
REPORT="$($CLI merge $FEEDS -o "$WORKDIR/merged.ics" 2>&1)"
echo "$REPORT" | grep -q "input:  15 events" || fail "input count wrong: $REPORT"
echo "$REPORT" | grep -q "1 uid duplicate, 3 fingerprint duplicates, 3 flattened instances absorbed" \
  || fail "identity summary wrong: $REPORT"
echo "$REPORT" | grep -q "output: 8 events, 2 timezones" || fail "output count wrong: $REPORT"
[ -f "$WORKDIR/merged.ics" ] || fail "merged.ics not written"
echo "[smoke] merge accounting ok (15 -> 8)"

# 4. The merged calendar is structurally sound and canonical.
grep -q "^BEGIN:VCALENDAR" "$WORKDIR/merged.ics" || fail "missing VCALENDAR"
grep -q "PRODID:-//calknit//calknit $PKG_VERSION//EN" "$WORKDIR/merged.ics" || fail "missing PRODID"
[ "$(grep -c "^BEGIN:VEVENT" "$WORKDIR/merged.ics")" -eq 8 ] || fail "expected 8 VEVENTs"
[ "$(grep -c "^BEGIN:VTIMEZONE" "$WORKDIR/merged.ics")" -eq 2 ] || fail "expected 2 VTIMEZONEs"
echo "[smoke] canonical output ok"

# 5. Cross-feed field fill and EXDATE union survived into the file.
grep -q "DESCRIPTION:Agenda:" "$WORKDIR/merged.ics" || fail "DESCRIPTION not filled from personal.ics"
grep -q "EXDATE;TZID=Europe/Berlin:20260810T093000" "$WORKDIR/merged.ics" || fail "work EXDATE lost"
grep -q "EXDATE;TZID=W. Europe Standard Time:20260824T093000" "$WORKDIR/merged.ics" \
  || fail "personal EXDATE lost in union"
echo "[smoke] field fill + EXDATE union ok"

# 6. Determinism: a second merge is byte-identical.
$CLI merge $FEEDS --quiet > "$WORKDIR/again.ics" || fail "second merge failed"
cmp -s "$WORKDIR/merged.ics" "$WORKDIR/again.ics" || fail "two merges of the same feeds differ"
echo "[smoke] determinism ok"

# 7. Idempotence: merging the merged calendar changes nothing.
$CLI merge "$WORKDIR/merged.ics" --quiet > "$WORKDIR/remerged.ics" || fail "re-merge failed"
[ "$(grep -c "^BEGIN:VEVENT" "$WORKDIR/remerged.ics")" -eq 8 ] || fail "re-merge changed event count"
echo "[smoke] idempotence ok"

# 8. explain shows its work: winner, absorption, unique count.
EXPLAIN="$($CLI explain $FEEDS)"
echo "$EXPLAIN" | grep -q 'merged (uid): "Design review"' || fail "explain missing uid merge"
echo "$EXPLAIN" | grep -q "absorbed by series team-sync-2026@example.test" \
  || fail "explain missing absorption"
echo "$EXPLAIN" | grep -q "4 events unique" || fail "explain missing unique count"
echo "[smoke] explain ok"

# 9. --json reports parse and agree with the human summary.
$CLI merge $FEEDS --json -o "$WORKDIR/j.ics" 2> "$WORKDIR/report.json" || fail "json merge failed"
node -e '
  const j = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (j.input.events !== 15 || j.output.events !== 8) process.exit(1);
  if (j.identity.uid !== 1 || j.identity.fingerprint !== 3 || j.identity.absorbed !== 3) process.exit(1);
' "$WORKDIR/report.json" || fail "merge --json malformed"
$CLI inspect $FEEDS --json | node -e '
  let s = "";
  process.stdin.on("data", (c) => (s += c));
  process.stdin.on("end", () => {
    const j = JSON.parse(s);
    if (j.feeds.length !== 3 || j.feeds[0].events !== 5) process.exit(1);
  });
' || fail "inspect --json malformed"
echo "[smoke] json reports ok"

# 10. --match uid narrows matching (only the shared-UID pair collapses).
UIDONLY="$($CLI merge $FEEDS --match uid --quiet)"
[ "$(echo "$UIDONLY" | grep -c "^BEGIN:VEVENT")" -eq 14 ] || fail "--match uid should keep 14 events"
echo "[smoke] --match uid ok"

# 11. --strict flips the exit code on conflicts but still emits the calendar.
set +e
$CLI merge $FEEDS --strict --quiet > "$WORKDIR/strict.ics" 2>/dev/null
STRICT_CODE=$?
set -e
[ "$STRICT_CODE" -eq 1 ] || fail "--strict should exit 1 on conflicts, got $STRICT_CODE"
grep -q "^BEGIN:VCALENDAR" "$WORKDIR/strict.ics" || fail "--strict suppressed the output"
echo "[smoke] --strict ok (exit 1)"

# 12. Error handling: usage and parse problems exit 2.
set +e
$CLI merge >/dev/null 2>&1;                    [ $? -eq 2 ] || { set -e; fail "no feeds should exit 2"; }
$CLI merge --frobnicate x.ics >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI merge /nonexistent.ics >/dev/null 2>&1;   [ $? -eq 2 ] || { set -e; fail "missing file should exit 2"; }
printf 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n' > "$WORKDIR/broken.ics"
$CLI merge "$WORKDIR/broken.ics" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "broken feed should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

echo "SMOKE OK"
