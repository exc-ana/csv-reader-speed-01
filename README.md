# csv-reader-speed-01

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/exc-ana/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/exc-ana/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in replacement for make.fun's own csv-reader 1.0.0, for the make.fun bounty "Read broken CSV files faster, 21 November 2026". `solve.js` is a dependency-free ES module exporting `run(input)` that returns exactly what csv-reader 1.0.0 returns for `{text, header}`: `{columns, rows, errors}` — same broken-row policy (BOM drop, CRLF/LF, stray CR, quoted fields with `""` escapes and CR→LF inside, quote junk, unterminated quotes re-read as unquoted, short/long row padding/cutting with errors).

## How it works

Never read one character at a time. Fields are cut with `String.indexOf` / `String.slice` (C++ scans); a whole line with no quotes and no stray CR is `split(',')` at once; unquoted fields take a comma-first fast lane; only the rare paths (stray CRs, line breaks inside quotes, unterminated quotes) re-scan character-wise. Semantics ported exactly from the vendored reference.

## Verification

- Practice set (6 cases, 10.2 MB): **6/6 pass** — answers byte-identical to the baseline's output; official kit scorer: `{"passed":1,"cases_passed":6,"cases_total":6}`.
- Fuzz vs the reference: **~25,940 cases, 0 mismatches** (81 hand-crafted edge cases, 461 generated cases through the kit's own generator, 25,000 random tiny strings, 400 mutations of real cases).
- Timing (parse-only, 6 practice cases, local Node 24, shared-CPU VM): mine ~127–135 ms median vs baseline ~514–646 ms — **~4.4× faster**, past the "beat the baseline at 95% confidence" gate if the ratio holds on the scored set.

## Run it

```sh
node main.ts
```

`main.ts` is the kit's baseline driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.
