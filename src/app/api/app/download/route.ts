import { NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { Readable } from "stream";
import path from "path";

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

  const stamp = built.toISOString().slice(0, 10);
  const stream = Readable.toWeb(createReadStream(APK)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="contour-${stamp}.apk"`,
      "Cache-Control": "no-store",
    },
  });
}
