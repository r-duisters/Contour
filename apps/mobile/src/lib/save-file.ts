import type { SaveFile } from "@/components/save-file";

/**
 * Saving a file on Android: write it, then offer it.
 *
 * `Directory.Cache` and the share sheet, not `Documents` — writing to
 * Documents without sharing produces a file the person cannot find, which is
 * indistinguishable from the export having failed. The share sheet is how a
 * file leaves an Android app, and it lets them put it wherever they meant to.
 *
 * Both plugins are imported lazily, for the same reason `BiometricLock`
 * imports Capacitor lazily: this module is reachable from a browser build and
 * must not drag a native plugin into it.
 */
export const DEVICE_SAVE_FILE: SaveFile = async ({ body, filename }) => {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: body,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });

  await Share.share({ title: filename, url: uri });
};
