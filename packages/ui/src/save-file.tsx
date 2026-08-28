"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ExportedFile } from "@/data/client/data-client";

/**
 * What happens to bytes once a client has produced them.
 *
 * `exportFile` is on `DataClient` because both platforms can make the file.
 * Saving it is where they diverge completely — a browser downloads, a device
 * has no download folder a person can reach — so the screen asks for this
 * rather than branching on which app it is in.
 */
export type SaveFile = (file: ExportedFile) => Promise<void>;

/**
 * A blob, an object URL, one programmatic click, and then revoke it. The
 * revoke is not tidiness: the blob is held in memory until it happens, and a
 * portfolio backup is not small.
 */
export const WEB_SAVE_FILE: SaveFile = async ({ body, filename }) => {
  const url = URL.createObjectURL(new Blob([body], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const SaveFileContext = createContext<SaveFile>(WEB_SAVE_FILE);

export function SaveFileProvider({ save, children }: { save: SaveFile; children: ReactNode }) {
  return <SaveFileContext.Provider value={save}>{children}</SaveFileContext.Provider>;
}

export function useSaveFile(): SaveFile {
  return useContext(SaveFileContext);
}
