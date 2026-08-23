"use client";

/**
 * Three of this screen's twelve requests go through `DataClient`: reading the
 * settings row, saving it, and firing the test signal. Everything else here —
 * `/api/logout`, `/api/push/*`, `/api/settings/password`, `/api/webauthn/*` —
 * stays on raw `fetch` on purpose, and the file is not half-converted.
 *
 * Those nine are session auth, passkeys and Web Push: browser-and-server
 * mechanisms that a device build has no counterpart for. Putting them behind
 * the client would widen the interface with methods `LocalClient` could only
 * ever implement by throwing, which is a worse answer than leaving them where
 * the reader can see they are server-shaped.
 *
 * The test signal is the borderline case, and it is the reason
 * `sendTestNotification` is the interface's one *optional* member: it is worth
 * having behind the client where a server is there to run it, and it is
 * structurally impossible where one is not. So this screen feature-detects it
 * and simply does not draw the button on an implementation that lacks it,
 * rather than drawing one that fails when pressed.
 */

import { useEffect, useState } from "react";
import {
  BellOff, BellRing, Fingerprint, KeyRound, LogOut, Save, Send, Settings as SettingsIcon, Trash2,
} from "lucide-react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useDataClient } from "@/data/client/context";

export default function SettingsPage() {
  const client = useDataClient();
  const [haUrl, setHaUrl] = useState("");
  const [haWebhookId, setHaWebhookId] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState<"USD" | "EUR">("USD");
  const [equityProvider, setEquityProvider] = useState("yahoo");
  const [equityApiKey, setEquityApiKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "busy">("busy");
  const [passkeys, setPasskeys] = useState<{ id: string; label: string | null; createdAt: string }[]>([]);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [passkeyMsg, setPasskeyMsg] = useState<string | null>(null);

  async function loadPasskeys() {
    const d = await fetch("/api/webauthn/credentials").then((r) => r.json()).catch(() => null);
    if (d) setPasskeys(d.credentials);
  }

  async function addPasskey() {
    setPasskeyMsg(null);
    try {
      const options = await fetch("/api/webauthn/register/options", { method: "POST" }).then((r) => r.json());
      const attestation = await startRegistration({ optionsJSON: options });
      const label = window.prompt("Name this passkey (e.g. \u201ciPhone\u201d):") ?? undefined;
      const res = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, label }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "verification failed");
      setPasskeyMsg("Passkey added.");
      await loadPasskeys();
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") setPasskeyMsg(`Passkey: ${(e as Error).message}`);
    }
  }

  async function removePasskey(id: string) {
    const label = passkeys.find((k) => k.id === id)?.label ?? "this passkey";
    if (!window.confirm(`Remove ${label}? It will no longer unlock the app.`)) return;
    await fetch("/api/webauthn/credentials", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadPasskeys();
  }

  useEffect(() => {
    // `null` is a virgin install, not a failure: the fields stay on their
    // first-run defaults rather than showing a saved row that isn't there.
    client.getSettings()
      .then((s) => {
        if (!s) return;
        setHaUrl(s.haUrl ?? "");
        setHaWebhookId(s.haWebhookId ?? "");
        setDisplayCurrency(s.displayCurrency === "EUR" ? "EUR" : "USD");
        setEquityProvider(s.equityProvider ?? "yahoo");
        setEquityApiKey(s.equityApiKey ?? "");
      })
      // Unreachable server leaves the defaults standing, as before — the bare
      // fetch had no handler at all, so it did the same thing by rejecting.
      .catch(() => {});
  }, [client]);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn() && window.isSecureContext);
    loadPasskeys();
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setPushState("unsupported"); return; }
      const reg = await navigator.serviceWorker.ready;
      setPushState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(b64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function enablePush() {
    setPushState("busy"); setMsg(null);
    try {
      const { publicKey } = await fetch("/api/push/vapid").then((r) => r.json());
      if (!publicKey) throw new Error("VAPID keys not configured on the server");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("permission denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth } }),
      });
      setPushState("on");
    } catch (e) {
      setMsg(`Push: ${(e as Error).message}`);
      setPushState("off");
    }
  }

  async function disablePush() {
    setPushState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushState("off");
    } catch (e) {
      setMsg(`Push: ${(e as Error).message}`);
      setPushState("on");
    }
  }

  async function save() {
    setMsg(null);
    try {
      await client.saveSettings({
        haUrl: haUrl || null,
        haWebhookId: haWebhookId || null,
        displayCurrency,
        equityProvider,
        equityApiKey: equityApiKey || null,
      });
      setMsg("Saved.");
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }

  // Optional on `DataClient`, and absent on an implementation with no server
  // behind it — see the rule in `data-client.ts`. Reading it once keeps the
  // button and the handler agreeing about whether the capability is there.
  const sendTest = client.sendTestNotification?.bind(client);

  async function test() {
    if (!sendTest) return;
    setMsg(null);
    try {
      await sendTest();
      setMsg("Test signal sent. Check Home Assistant.");
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }

  async function changePassword() {
    setPwMsg(null);
    const r = await fetch("/api/settings/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: curPw, next: newPw }),
    });
    setPwMsg(r.ok ? "Password changed." : `Error: ${(await r.json()).error ?? r.status}`);
    if (r.ok) { setCurPw(""); setNewPw(""); }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen md:min-h-[calc(100vh-3.5rem)] px-4 py-5 md:p-8 max-w-xl mx-auto">
      <h1 className="text-xl md:text-2xl font-semibold mb-4 md:mb-6 flex items-center gap-2"><SettingsIcon size={20} aria-hidden className="text-neutral-400" />Settings</h1>
      <section className="space-y-4 mb-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Display</h2>
        <label className="block text-sm">
          <span className="text-neutral-400">Portfolio currency</span>
          <select className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                  value={displayCurrency}
                  onChange={(e) => setDisplayCurrency(e.target.value as "USD" | "EUR")}>
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
          </select>
          <span className="text-xs text-neutral-500">
            Prices come from Binance in USDT; EUR converts at the live ECB reference rate. Save to apply.
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-neutral-400">Stock / ETF price source</span>
          <select className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                  value={equityProvider} onChange={(e) => setEquityProvider(e.target.value)}>
            <option value="yahoo">Yahoo Finance (no key needed)</option>
            <option value="twelvedata">Twelve Data (free key, 800/day)</option>
            <option value="alphavantage">Alpha Vantage (free key, 25/day)</option>
          </select>
        </label>
        {equityProvider !== "yahoo" && (
          <label className="block text-sm">
            <span className="text-neutral-400">API key</span>
            <input type="password" className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                   value={equityApiKey} onChange={(e) => setEquityApiKey(e.target.value)}
                   placeholder={equityProvider === "twelvedata" ? "twelvedata.com key" : "alphavantage.co key"} />
          </label>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Home Assistant</h2>
        <label className="block text-sm">
          <span className="text-neutral-400">HA URL</span>
          <input className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                 placeholder="http://homeassistant.local:8123"
                 value={haUrl} onChange={(e) => setHaUrl(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-400">Webhook ID</span>
          <input className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                 placeholder="trader_signal"
                 value={haWebhookId} onChange={(e) => setHaWebhookId(e.target.value)} />
          <span className="text-xs text-neutral-500">
            Configured in an HA automation with a webhook trigger.
          </span>
        </label>
        <div className="flex gap-2">
          <button onClick={save} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><Save size={14} aria-hidden />Save</button>
          {sendTest && (
            <button onClick={test} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><Send size={14} aria-hidden />Send test</button>
          )}
        </div>
        {msg && <p className="text-sm text-neutral-400">{msg}</p>}
      </section>
      <section className="space-y-4 mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Notifications on this device</h2>
        {pushState === "unsupported" && (
          <p className="text-sm text-neutral-500">
            Web Push not supported here. On iPhone, install the app to the Home Screen first (Share → Add to Home Screen).
          </p>
        )}
        {pushState !== "unsupported" && (
          <button
            disabled={pushState === "busy"}
            onClick={pushState === "on" ? disablePush : enablePush}
            className="bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"
          >
            {pushState === "on" ? <BellOff size={14} aria-hidden /> : <BellRing size={14} aria-hidden />}
            {pushState === "on" ? "Disable notifications" : "Enable notifications"}
          </button>
        )}
        <p className="text-xs text-neutral-500">“Send test” above exercises both Home Assistant and Web Push.</p>
      </section>
      <section className="space-y-4 mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Passkeys (fingerprint / device PIN)</h2>
        {!passkeySupported && (
          <p className="text-sm text-neutral-500">
            Passkeys need a secure context — available on localhost or once the app runs behind HTTPS.
          </p>
        )}
        {passkeySupported && (
          <button onClick={addPasskey}
                  className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1">
            <Fingerprint size={14} aria-hidden />Add passkey
          </button>
        )}
        <ul className="divide-y divide-neutral-800">
          {passkeys.map((k) => (
            <li key={k.id} className="py-2 flex items-center gap-3 text-sm">
              <Fingerprint size={14} aria-hidden className="text-neutral-500" />
              <span>{k.label ?? "Unnamed passkey"}</span>
              <span className="text-xs text-neutral-500">added {new Date(k.createdAt).toLocaleDateString()}</span>
              <span className="flex-1" />
              <button onClick={() => removePasskey(k.id)}
                      className="text-xs underline text-red-500 inline-flex items-center gap-1">
                <Trash2 size={12} aria-hidden />Remove passkey…
              </button>
            </li>
          ))}
          {passkeys.length === 0 && <li className="text-sm text-neutral-500 py-2">No passkeys yet.</li>}
        </ul>
        {passkeyMsg && <p className="text-sm text-neutral-400">{passkeyMsg}</p>}
      </section>

      <section className="space-y-4 mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Account</h2>
        <label className="block text-sm">
          <span className="text-neutral-400">Current password</span>
          <input type="password" className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                 value={curPw} onChange={(e) => setCurPw(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="text-neutral-400">New password (min 8 chars)</span>
          <input type="password" className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                 value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </label>
        <div className="flex gap-2">
          <button onClick={changePassword} className="bg-blue-600 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><KeyRound size={14} aria-hidden />Change password</button>
          <button onClick={logout} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><LogOut size={14} aria-hidden />Log out</button>
        </div>
        {pwMsg && <p className="text-sm text-neutral-400">{pwMsg}</p>}
      </section>
    </main>
  );
}
