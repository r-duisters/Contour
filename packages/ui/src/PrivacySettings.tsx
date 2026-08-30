"use client";

import Switch from "./Switch";
import BackupToggle from "./BackupToggle";

/**
 * What this app tells the outside world, in one place.
 *
 * Both builds show it, and each draws what it can: the coin-price switch is a
 * stored preference either build can honour, while the backup switch is
 * Android's and `BackupToggle` renders nothing in a browser. That is the same
 * rule `sendTestNotification` follows — a capability a platform cannot have is
 * absent rather than disabled.
 *
 * These were not filed together before. The coin-price setting sat under
 * Display, because that is where the price fields are, and the backup question
 * had no home at all. Proximity is not meaning: neither of these changes what
 * is on screen, and both change who learns something.
 */
export default function PrivacySettings({
  privateCoinPrices, onPrivateCoinPrices, portfolioId,
}: {
  privateCoinPrices: boolean;
  onPrivateCoinPrices: (next: boolean) => void;
  /** Which portfolio a backup copy would be of. Null before one exists. */
  portfolioId: string | null;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm">Hide which coins you hold from Binance</div>
          {/*
            Named for the problem, not the mechanism.
            ========================================

            It read "Ask for every coin price", which describes what the switch
            does to a request and leaves the reader to work out why they might
            want it. What it is *for* is that a price request names your coins:
            Binance is asked for exactly the set you hold, every refresh, and
            that set is your portfolio's composition.

            The number stays in the copy. "More private" is a claim; 26 KB is a
            fact somebody on a metered plan can weigh — and half-hourly alert
            checks make it about 1.2 MB a day, which is the part they would
            otherwise discover from a bill.
          */}
          <p className="text-xs text-neutral-500 mt-0.5">
            Prices are normally fetched by name, so Binance sees exactly which coins
            you own. This asks for the whole market instead, and picks yours out here —
            it learns nothing. Costs about 26 KB a refresh rather than a few hundred
            bytes. Shares are unaffected: no provider publishes every one.
          </p>
        </div>
        <Switch
          checked={privateCoinPrices}
          onChange={onPrivateCoinPrices}
          label="Hide which coins you hold from Binance"
        />
      </div>

      <BackupToggle portfolioId={portfolioId} />
    </>
  );
}
