"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import { asDisplayCurrency } from "@/lib/currencies";
import PageLabel from "../PageLabel";
import Button from "../Button";
import DisplaySettings, { type DisplaySettingsValue } from "../DisplaySettings";
import { useLastPortfolio } from "../useCachedValuation";

/**
 * What this screen edits: the shared display fields plus the privacy switch
 * that no longer travels with them. `DisplaySettings` stopped carrying
 * `privateCoinPrices` when it moved to its own section, and the screen still
 * saves both in one request — so the state stays one object.
 */
type SettingsValue = DisplaySettingsValue & { privateCoinPrices: boolean };
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
        <p className="text-xs text-neutral-500 mt-3 max-w-prose">
          What you are alerted about lives under Alerts. Home Assistant, web-push and
          passkeys live on the desktop app — each needs a server, and this build has
          none.
        </p>
      </section>

      <section className="mt-10">
        <AboutSection />
      </section>
    </main>
  );
}
