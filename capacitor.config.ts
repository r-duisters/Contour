import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The shell loads the running Nabla server rather than bundling a static
 * build: the app is server-rendered and its API routes hold the data. This is
 * the wrapper that answers "does it feel right as a native app" before
 * committing to a local-first rewrite.
 *
 * NABLA_URL overrides the address at build time — set it to the HTTPS domain
 * once the app is deployed, which also lets cleartext be turned off.
 */
const url = process.env.NABLA_URL ?? "http://192.168.2.5:3001";

const config: CapacitorConfig = {
  appId: "app.nabla.local",
  appName: "Nabla",
  webDir: "public",
  server: {
    url,
    // Only needed while the server is plain http on the LAN.
    cleartext: url.startsWith("http://"),
  },
  android: {
    // Match the app's own dark background so launches don't flash white.
    backgroundColor: "#0a0a0a",
  },
};

export default config;
