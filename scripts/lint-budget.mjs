#!/usr/bin/env node
/**
 * `npm run lint` exits non-zero on purpose, so CI cannot just run it.
 *
 * Twenty-one errors predate the workspace restructuring — 7 in `packages/ui`,
 * 14 in `apps/web` — and were deliberately left rather than fixed as a
 * drive-by. A CI step that demanded zero would have to either fix them under
 * time pressure or be switched off, and a switched-off lint is how the count
 * got to twenty-one.
 *
 * So the budget is the invariant instead: the count may not rise, and it may
 * not quietly fall either. A fall is good news that has to be recorded here,
 * or the number stops meaning anything and the next rise hides inside it.
 */
import { spawnSync } from "node:child_process";

const BUDGET = 21;

const run = spawnSync("npm", ["run", "lint"], { encoding: "utf8", shell: false });
const output = `${run.stdout}${run.stderr}`;

// eslint's stylish reporter: "  12:34  error  ...". Counting the lines rather
// than trusting a summary, which is printed once per workspace.
const count = (output.match(/^\s+\d+:\d+\s+error\s/gm) ?? []).length;

if (count === BUDGET) {
  console.log(`Lint: ${count} known errors, as expected.`);
  process.exit(0);
}

console.error(output);
console.error(
  count > BUDGET
    ? `\nLint: ${count} errors, ${count - BUDGET} more than the ${BUDGET} this repository ` +
      `carries knowingly. Fix what you added, or state why the budget must rise.`
    : `\nLint: ${count} errors, down from ${BUDGET}. Good — lower the budget in ` +
      `scripts/lint-budget.mjs to ${count} so the number keeps meaning something.`,
);
process.exit(1);
