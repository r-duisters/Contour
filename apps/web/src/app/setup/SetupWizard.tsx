"use client";

import { useRouter } from "next/navigation";
import SetupScreen from "@/components/screens/SetupScreen";

/**
 * The same four steps the phone gets: currency, a portfolio, your data, alerts.
 *
 * A client boundary and nothing else. `SetupScreen` reaches for a `DataClient`
 * from context and for the device capabilities that a browser does not have,
 * and each of those already answers "not here" rather than throwing — which is
 * why the screen can be shared at all instead of written twice.
 *
 * `onDone` goes to the portfolio, matching `apps/mobile/src/app/setup/page.tsx`.
 * Ending somewhere other than the thing you have just set up would be a strange
 * place to leave somebody.
 */
export default function SetupWizard() {
  const router = useRouter();
  return <SetupScreen onDone={() => router.push("/portfolio")} />;
}
