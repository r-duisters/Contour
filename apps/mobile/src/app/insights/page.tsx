"use client";

/**
 * Routing only. The screen lives in `packages/ui/src/screens` so the device
 * build renders the same one — two copies of a screen is the drift this
 * architecture exists to prevent.
 */
import InsightsScreen from "@/ui/screens/InsightsScreen";

export default function Page() {
  return <InsightsScreen />;
}
