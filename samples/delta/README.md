# Delta CSV reference exports

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

**Its licence.** The upstream repository is **Apache-2.0**
(`dickwolff/Export-To-Ghostfolio`, Dick Wolff). The file is reproduced here
unmodified as a test fixture, with attribution, under that licence — which
requires the attribution above to be kept if this file is redistributed.

Note that Contour itself still has no `LICENSE` file, which is recorded as a
blocking decision in `docs/carried-forward.md`. Vendoring an Apache-2.0 fixture
does not change that and does not license this repository.
