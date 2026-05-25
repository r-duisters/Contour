import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DIR = resolve(process.cwd(), "samples");

const SAFE_NAME = /^[A-Za-z0-9._-]+\.pine$/;

export async function listScripts(): Promise<{ name: string; bytes: number }[]> {
  const entries = await readdir(DIR, { withFileTypes: true });
  const out: { name: string; bytes: number }[] = [];
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".pine")) {
      const stat = await readFile(join(DIR, e.name)).then((b) => b.byteLength).catch(() => 0);
      out.push({ name: e.name, bytes: stat });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getScript(name: string): Promise<string> {
  if (!SAFE_NAME.test(name)) throw new Error("invalid script name");
  return readFile(join(DIR, name), "utf8");
}

export async function saveScript(name: string, source: string): Promise<{ name: string }> {
  if (!SAFE_NAME.test(name)) throw new Error("invalid script name");
  await writeFile(join(DIR, name), source, "utf8");
  return { name };
}

/** Auto-name a derived version: foo.pine + "fixes" → foo.fixes.pine, foo.fixes.pine + "fixes" → foo.fixes-2.pine, etc. */
export async function suggestDerivedName(base: string, suffix: string): Promise<string> {
  const stem = base.replace(/\.pine$/, "");
  let candidate = `${stem}.${suffix}.pine`;
  const existing = new Set((await listScripts()).map((s) => s.name));
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${stem}.${suffix}-${n}.pine`;
    n++;
  }
  return candidate;
}
