import type { NextConfig } from "next";

/**
 * `output: "export"` is what makes an APK possible: the build emits static
 * HTML, JS and CSS that Capacitor serves from the app's own assets, with no
 * Node process anywhere. Everything that needs a server — route handlers,
 * middleware, `force-dynamic` — stays in `apps/web` and cannot be imported
 * here, which is the point of two app directories rather than one with
 * build-time file surgery (spec §6).
 *
 * `images.unoptimized` because the optimiser is a server.
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
