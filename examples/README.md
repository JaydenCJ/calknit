# calknit examples

## feeds/

Three small but realistic feeds that together exercise every identity
pass. The same real-world calendar sprawl they model — a provider feed,
a mail-client calendar and an app export — is what calknit is for:

| File | Contains | Demonstrates |
|---|---|---|
| `work.ics` | weekly "Team sync" series (with an `EXDATE`), "Quarterly planning" (`SEQUENCE:2`), a biweekly 1:1, "Design review", an all-day offsite | the surviving masters and the freshest copies |
| `personal.ics` | the same series and planning meeting under Outlook-style UIDs and `TZID=W. Europe Standard Time`, plus a dentist visit, a yoga class and an offsite duplicate | fingerprint matching across UID and timezone spellings, `EXDATE` union, `DESCRIPTION` fill |
| `team-export.ics` | three standalone "Team sync" copies (a flattened recurrence), "Design review" re-exported under the *same* UID with `SEQUENCE:1` and a moved room, and a sprint retro | recurrence absorption and UID-based merge where the export wins |

Try it (from the repository root, after `npm install && npm run build`):

```bash
node dist/cli.js inspect examples/feeds/*.ics
node dist/cli.js explain examples/feeds/work.ics examples/feeds/personal.ics examples/feeds/team-export.ics
node dist/cli.js merge examples/feeds/work.ics examples/feeds/personal.ics examples/feeds/team-export.ics -o all.ics
```

Expected accounting: 15 events in, 8 out — 1 UID duplicate, 3
fingerprint duplicates and 3 absorbed instances, with both feeds'
`EXDATE`s unioned onto the surviving series. Run `merge` twice: the
output is byte-identical, and re-merging `all.ics` changes nothing.
