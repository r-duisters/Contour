"use client";

/**
 * Routing only. The screen lives in `packages/ui/src/screens` so the device
 * build renders the same one.
 */
import LedgerScreen from "@/ui/screens/LedgerScreen";

export default function Page() {
  return <LedgerScreen />;
}
