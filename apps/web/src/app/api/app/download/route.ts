import { NextResponse } from "next/server";
import { createReadStream, readdirSync, statSync } from "fs";
import { Readable } from "stream";
import path from "path";

/** The most recent mtime anywhere under these directories, or null. */
function newestMtime(dirs: string[]): number | null {
  let newest: number | null = null;
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
    }
  };
  dirs.forEach(walk);
  return newest;
}

export const dynamic = "force-dynamic";

const APK = path.join(process.cwd(), "android/app/build/outputs/apk/debug/app-debug.apk");

/**
 * Hands the freshly built APK to the phone, so installing a new shell is a tap
 * on a link rather than a cable. Streamed from the build output rather than a
 * copy, so it can never serve a stale version.
 */
export async function GET() {
  let size: number;
  let built: Date;
  try {
    const stat = statSync(APK);
    size = stat.size;
    built = stat.mtime;
  } catch {
    return NextResponse.json(
      { error: "No build yet. Run: npm run android:build" },
      { status: 404 },
    );
  }

  // A same-day rebuild that silently failed still leaves yesterday's date on
  // the file, so compare against the newest source instead of trusting it.
  const newestSource = newestMtime([
    path.join(process.cwd(), "src"),
    path.join(process.cwd(), "public/icons"),
  ]);
  const stale = newestSource !== null && newestSource > built.getTime();
  const stamp = built.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const stream = Readable.toWeb(createReadStream(APK)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="contour-${stale ? "STALE-" : ""}${stamp}.apk"`,
      // Read this before installing: a failed Gradle run leaves the previous
      // APK in place, and nothing else says so.
      "X-Build-Stale": String(stale),
      "Cache-Control": "no-store",
    },
  });
}
