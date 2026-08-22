import { readFileSync } from "node:fs";
import { analyzePineScript, summarize } from "../packages/core/src/pinescript/analyze";

const src = readFileSync("samples/risk-metric.pine", "utf8");
const findings = analyzePineScript(src);
console.log(summarize(findings));
console.log();
for (const f of findings) {
  const head = `[${f.severity}] ${f.category}  L${f.line ?? "-"}  (${f.id})`;
  console.log(head);
  console.log("  " + f.message.split("\n")[0]);
  console.log();
}
