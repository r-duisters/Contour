"use client";

import { useEffect, useState } from "react";
import { useDataClient } from "@/data/client/context";
import { KEYS } from "@/lib/storage-keys";
import { needsSetup } from "@/components/setup-steps";
import SetupScreen from "@/components/screens/SetupScreen";

/**
 * Shows the first-run flow instead of the app, once, on an empty device.
 *
 * A gate rather than a redirect. A static export has no middleware and every
 * route is prerendered, so a redirect would mean each screen deciding for
 * itself whether it is allowed to draw — five copies of one rule, and a flash
 * of the empty portfolio before the wizard replaced it. Wrapping the tree
 * decides once.
 *
 * It wraps the navigation as well as the page, so setup has the screen to
 * itself. A tab bar under a wizard invites leaving it half-done, and the
 * "Skip" button is the honest way out.
 */
export default function FirstRun({ children }: { children: React.ReactNode }) {
  const client = useDataClient();
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const dismissed = (() => {
      try {
        return localStorage.getItem(KEYS.setupDone) !== null;
      } catch {
        return false;
      }
    })();

    client.listPortfolios()
      .then((ps) => { if (!cancelled) setShow(needsSetup({ portfolioCount: ps.length, dismissed })); })
      // A database that answers nothing is a problem the providers already
      // report. Showing the app rather than the wizard is the safer guess:
      // the wizard would offer to import into a store that cannot be read.
      .catch(() => { if (!cancelled) setShow(false); });

    return () => { cancelled = true; };
  }, [client]);

  // Nothing until the answer is known. The alternative is drawing the app and
  // replacing it a beat later, which is the flash this gate exists to avoid.
  if (show === null) return null;
  if (show) return <SetupScreen onDone={() => setShow(false)} />;
  return <>{children}</>;
}
