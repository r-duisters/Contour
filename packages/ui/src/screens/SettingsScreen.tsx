"use client";

import { useEffect, useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { useDataClient } from "@/data/client/context";
import { asDisplayCurrency } from "@/lib/currencies";
import PageLabel from "../PageLabel";
import Button from "../Button";
import DisplaySettings, { type DisplaySettingsValue } from "../DisplaySettings";
import AboutSection from "../AboutSection";
import BigMoveSetting from "../BigMoveSetting";

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
  const [value, setValue] = useState<DisplaySettingsValue>({
    displayCurrency: asDisplayCurrency("USD"),
    equityProvider: "yahoo",
    equityApiKey: "",
    privateCoinPrices: false,
  });
  const [msg, setMsg] = useState<string | null>(null);

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
        <DisplaySettings value={value} onChange={setValue} />
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save}>Save</Button>
        {msg && <span className="text-xs text-neutral-500">{msg}</span>}
      </div>

      {/*
        Said rather than hidden. Someone who set alerts up on the desktop will
        look for them here, and finding no section reads as a missing feature
        rather than a deliberate one.

        No Security section: the device lock is the lock, and there is no
        password to change or session to end. A capability a platform cannot
        have is absent, not disabled.
      */}
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 mb-3">
          Notifications
        </h2>
        <p className="text-sm text-neutral-300">
          Alerts are checked on this phone.
        </p>
        <p className="text-xs text-neutral-500 mt-1 max-w-prose">
          Every time you open the app, and every half hour in the background when Android
          allows it — it treats that schedule as a target rather than a promise, and a
          battery-optimised phone may defer it. Set an alert from an asset&rsquo;s page;
          see them under Alerts.
        </p>

        <BigMoveSetting />
        <p className="text-xs text-neutral-500 mt-3 max-w-prose">
          Home Assistant, web-push and passkeys live on the desktop app. Each needs a server,
          and this build has none — the device lock is what keeps this app shut.
        </p>
      </section>

      <section className="mt-10">
        <AboutSection />
      </section>
    </main>
  );
}
