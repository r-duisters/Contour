import type { IconDeps } from "./icon-cache";

/**
 * The device's half of the logo cache: native HTTP in, filesystem out.
 *
 * Separated from `icon-cache.ts` so the store's behaviour — what is asked for,
 * how often, and what a failure does — can be tested without a phone. This
 * file is the part that only runs on one.
 *
 * **`CapacitorHttp`, not `fetch`, for the same reason `CapacitorNet` uses it.**
 * A WebView's `fetch` is subject to CORS and jsDelivr, CoinGecko and parqet
 * send nothing permissive to a `capacitor://localhost` origin. The native
 * layer has no origin to check. `responseType: "blob"` hands back base64,
 * which is exactly what `Filesystem.writeFile` wants — so the bytes are never
 * decoded in JavaScript.
 */

const DIR = "icons";

/** Matches `CapacitorNet`: honest about what the client is, not disguised. */
const UA = "Contour/1.0 (+self-hosted portfolio tracker)";

async function capacitor() {
  const [core, fs] = await Promise.all([
    import("@capacitor/core"),
    import("@capacitor/filesystem"),
  ]);
  return { ...core, ...fs };
}

export const DEVICE_ICON_DEPS: IconDeps = {
  async fetchBase64(url) {
    const { CapacitorHttp } = await capacitor();
    const res = await CapacitorHttp.request({
      url, method: "GET", responseType: "blob", headers: { "User-Agent": UA },
    } as never) as unknown as { status: number; data: unknown };
    // Anything that is not a 2xx is a logo we do not have, not an error worth
    // surfacing: the row draws initials and nobody needs telling.
    if (res.status < 200 || res.status >= 300) return null;
    return typeof res.data === "string" && res.data.length > 0 ? res.data : null;
  },

  async write(name, base64) {
    const { Filesystem, Directory } = await capacitor();
    await Filesystem.mkdir({ path: DIR, directory: Directory.Cache, recursive: true })
      .catch(() => { /* already there */ });
    await Filesystem.writeFile({
      path: `${DIR}/${name}`, data: base64, directory: Directory.Cache,
    });
  },

  async srcFor(name) {
    const { Filesystem, Directory, Capacitor } = await capacitor();
    const { uri } = await Filesystem.getUri({ path: `${DIR}/${name}`, directory: Directory.Cache });
    // A `file://` path is not loadable from the WebView; this is the bridge's
    // own scheme for reaching one.
    return Capacitor.convertFileSrc(uri);
  },

  async list() {
    const { Filesystem, Directory } = await capacitor();
    const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Cache });
    return files.map((f) => (typeof f === "string" ? f : f.name));
  },
};
