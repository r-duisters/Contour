"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import { asDisplayCurrency } from "@/lib/currencies";
import PageLabel from "../PageLabel";
import Button from "../Button";
import DisplaySettings, { type DisplaySettingsValue } from "../DisplaySettings";
import PriceSourceSettings, { type PriceSourceValue } from "../PriceSourceSettings";
import { useLastPortfolio } from "../useCachedValuation";

/**
 * What this screen edits: the shared display fields plus the privacy switch
 * that no longer travels with them. `DisplaySettings` stopped carrying
 * `privateCoinPrices` when it moved to its own section, and the screen still
 * saves both in one request — so the state stays one object.
 */
type SettingsValue = DisplaySettingsValue & PriceSourceValue & { privateCoinPrices: boolean };
import AboutSection from "../AboutSection";
import NotificationAccess from "../NotificationAccess";
import PrivacySettings from "../PrivacySettings";

/**
 * Settings, for a build with no server behind it.
 *
 * Deliberately a subset rather than a reduced copy of the web screen. Home
 * Assistant, web-push, passkeys, the password and logging out are server
 * mechanisms; an APK has none of them, and offering a control that cannot work
 * is worse than not offering it. What is left is what `DataClient` carries,
 * and it is the setting people actually reach for: the currency everything is
 * shown in.
 */
export default function SettingsScreen() {
  const client = useDataClient();
  const [value, setValue] = useState<SettingsValue>({
    displayCurrency: asDisplayCurrency("USD"),
    equityProvider: "yahoo",
    equityApiKey: "",
    privateCoinPrices: false,
  });
  const [msg, setMsg] = useState<string | null>(null);
  // Which portfolio a backup copy would be of. The device build has one in
  // practice; this is the same id every other screen falls back to.
  const portfolioId = useLastPortfolio();

  useEffect(() => {
    // `null` is a virgin install, not a failure: the fields stay on their
    // first-run defaults rather than showing a saved row that isn't there.
    client.getSettings()
      .then((s) => {
        if (!s) return;
        setValue({
          displayCurrency: asDisplayCurrency(s.displayCurrency),
          equityProvider: s.equityProvider ?? "yahoo",
          equityApiKey: s.equityApiKey ?? "",
          // `?? false` rather than a cast: a settings row written before this
          // column existed answers undefined, and the default is off.
          privateCoinPrices: s.privateCoinPrices ?? false,
        });
      })
      .catch(() => {});
  }, [client]);

  async function save() {
    setMsg(null);
    try {
      // Only these three. `SettingsPatch` is partial, so the fields this build
      // does not show keep whatever they held rather than being cleared.
      await client.saveSettings({
        displayCurrency: value.displayCurrency,
        equityProvider: value.equityProvider,
        equityApiKey: value.equityApiKey || null,
      });
      setMsg("Saved.");
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 max-w-xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <PageLabel icon={SettingsIcon}>Settings</PageLabel>
      </div>

      <section className="space-y-4 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Display</h2>
        <DisplaySettings value={value} onChange={(next) => setValue({ ...value, ...next })} />
      </section>

      {/*
        Where the numbers come from, which is not how they are shown.
        ============================================================

        These sat under Display next to the currency, and the difference
        matters to the person this screen is for: one decides how a figure is
        presented, the others decide who is asked for it. Somebody wondering
        which companies this app talks to was being answered under a heading
        about presentation.
      */}
      <section className="space-y-4 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Price sources
        </h2>
        <PriceSourceSettings value={value} onChange={(next) => setValue({ ...value, ...next })} />
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save}>Save</Button>
        {msg && <span className="text-xs text-neutral-500">{msg}</span>}
      </div>

      {/*
        Privacy, and its own section rather than a line in Display.
        ==========================================================

        Both of these change what leaves the phone and neither changes what is
        shown. "Ask for every coin price" spent one build under Display because
        it sits beside the price fields, which is proximity mistaken for
        meaning. Somebody wondering what this app tells the outside world will
        look under Privacy, and there was nowhere for them to look.
      */}
      <section className="mt-10 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Privacy</h2>
        {/*
          The headline, before the switches.
          =================================

          Both switches below are adjustments to something a person has to be
          told first: this app keeps the portfolio on the phone. There is no
          account, no server of ours, and nothing syncing. Somebody arriving at
          a "Privacy" heading is asking that question, and answering it with
          two toggles about price requests would be answering a smaller one.

          It also sets the size of what follows. Knowing the ledger never
          leaves, an exchange being able to work out which coins are held is a
          proportionate worry rather than an alarming one.

          (Said without quoting the exchange's name after a double quote:
          `import-surfaces.test.ts` greps every screen for a re-typed import
          format label, and Binance is one. The guard is right to be blunt —
          the cost is a sentence rephrased, and the thing it catches is two
          lists of formats drifting apart.)
        */}
        <p className="text-xs text-neutral-500 max-w-prose">
          Your portfolio is stored on this phone and nowhere else. There is no account
          and no cloud — Contour has no server to send it to. What follows is about the
          little that does leave: the price requests it has to make.
        </p>
        <PrivacySettings
          privateCoinPrices={value.privateCoinPrices}
          onPrivateCoinPrices={(next) => setValue({ ...value, privateCoinPrices: next })}
          portfolioId={portfolioId}
        />
      </section>

      {/*
        Said rather than hidden. Someone who set alerts up on the desktop will
        look for them here, and finding no section reads as a missing feature
        rather than a deliberate one.

        What this section is *not* is what changed. It held the schedule, the
        permission and the "tell me about big moves" switch — and that switch
        writes an alert row, which belongs with the alerts. What a settings
        screen should answer about notifications is whether they can reach you,
        and that is now all it answers.

        No Security section: the device lock is the lock, and there is no
        password to change or session to end. A capability a platform cannot
        have is absent, not disabled.
      */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
          Notifications
        </h2>
        <NotificationAccess />
        {/*
          No naming of what this build does not have.
          =========================================

          This said that Home Assistant, web-push and passkeys "live on the
          desktop app". Every word was true and none of it belonged: this app
          has no server, so a person reading it can neither use those things
          nor act on being told about them — it is a list of features that
          exist somewhere else, on a screen about this phone. Worse, it points
          at a system most people reading it have never heard of, and invites
          the question "should I be setting that up?" when the answer is that
          there is nothing to set up.

          What is left is the sentence that helps: where the rest of the
          answer lives.
        */}
        <p className="text-xs text-neutral-500 mt-3 max-w-prose">
          What you are alerted about lives under Alerts.
        </p>
      </section>

      <section className="mt-10">
        <AboutSection />
      </section>
    </main>
  );
}
