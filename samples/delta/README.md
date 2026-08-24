# Delta CSV reference exports

Two files, from the same upstream repository, and they are **not the same
format** — which is the point of keeping both.

`delta-export-reference.csv` is the documented Delta export sample from
[dickwolff/Export-To-Ghostfolio](https://github.com/dickwolff/Export-To-Ghostfolio)
(`samples/delta-export.csv`), kept here as a fixture for `parseDeltaCsv`.

**Why it is worth having.** Until 2026-08-24 the parser had only ever seen one
person's export — its author's — and this repository held no Delta CSV at all.
That made whole classes of question unanswerable by reading the code: what a
`DIVIDEND` row looks like, whether Delta names the security in the base column
or a separate one, whether `Base amount` is even populated on a cash row. This
file answers all three, and its dividend row immediately falsified an assumption
in the cash-and-income plan (the income branch was placed after a guard that
rejects the row first).

**What it is not.** It is Delta's documented shape, hand-written for
documentation, not a stranger's real export. It does not satisfy Phase 0 of
`docs/strategy/2026-08-22-delta-exit.md`, which asks for five or more real
exports from people who are not the author. It narrows the unknown; it does not
close it.

## `etoro-statement-reference.csv`

eToro's *own* account statement export, which is a different thing from a Delta
export despite Delta being eToro's app. Its header:

```
Date,Type,Details,Amount,Units,Realized Equity Change,Realized Equity,Balance,
Position ID,Asset type,NWA
```

No base/quote columns at all; a dividend is `Dividend,NKE/USD,0.17` with the
ticker buried in a free-text `Details` field.

`parseDeltaCsv` does not support it and is not meant to. It is kept because the
*failure* is worth pinning: the parser rejects the file at its header and
imports **nothing**, rather than half-reading it into a ledger. Someone with an
eToro account is exactly the person likely to grab the wrong export, so "refuses
cleanly" is a property, not an accident.

**Its licence.** The upstream repository is **Apache-2.0**
(`dickwolff/Export-To-Ghostfolio`, Dick Wolff). The file is reproduced here
unmodified as a test fixture, with attribution, under that licence — which
requires the attribution above to be kept if this file is redistributed.

Note that Contour itself still has no `LICENSE` file, which is recorded as a
blocking decision in `docs/carried-forward.md`. Vendoring an Apache-2.0 fixture
does not change that and does not license this repository.
