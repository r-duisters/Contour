"use client";

import { useEffect, useState } from "react";
import { amountsHidden, loadPrivacy, onPrivacyChange } from "@/lib/display";

/**
 * Re-render a page when amounts are hidden or shown. Reads the stored
 * preference after mount so the server's HTML and the first client render
 * agree.
 */
export function usePrivacy(): boolean {
  const [hidden, setHidden] = useState(amountsHidden());
  useEffect(() => {
    setHidden(loadPrivacy());
    return onPrivacyChange(() => setHidden(amountsHidden()));
  }, []);
  return hidden;
}
