/**
 * A placeholder, and only that.
 *
 * Task 1 proves the toolchain: that a second Next app builds to static files
 * against the shared packages and the shared stylesheet. The screens arrive in
 * Task 5, from `packages/ui`, so that there is exactly one copy of each.
 */
export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contour</h1>
        <p className="mt-2 text-sm text-neutral-500">
          The device build. Screens arrive with Task 5.
        </p>
      </div>
    </main>
  );
}
