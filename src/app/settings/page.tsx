"use client";

import { useEffect, useState } from "react";
import {
  BellOff, BellRing, Fingerprint, KeyRound, LogOut, Save, Send, Settings as SettingsIcon, Trash2,
} from "lucide-react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";

export default function SettingsPage() {
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
    await fetch("/api/webauthn/credentials", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadPasskeys();
  }

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      if (d.settings) {
        setHaUrl(d.settings.haUrl ?? "");
        setHaWebhookId(d.settings.haWebhookId ?? "");
        setDisplayCurrency(d.settings.displayCurrency === "EUR" ? "EUR" : "USD");
        setEquityProvider(d.settings.equityProvider ?? "yahoo");
        setEquityApiKey(d.settings.equityApiKey ?? "");
      }
    });
  }, []);

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
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ haUrl: haUrl || null, haWebhookId: haWebhookId || null, displayCurrency, equityProvider, equityApiKey: equityApiKey || null }),
    });
    setMsg(r.ok ? "Saved." : `Error: ${await r.text()}`);
  }

  async function test() {
    setMsg(null);
    const r = await fetch("/api/settings", { method: "POST" });
    setMsg(r.ok ? "Test signal sent. Check Home Assistant." : `Error: ${await r.text()}`);
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
    <main className="min-h-screen p-8 max-w-xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6 flex items-center gap-2"><SettingsIcon size={20} aria-hidden className="text-neutral-400" />Settings</h1>
      <section className="space-y-4 mb-10">
        <h2 className="text-sm font-semibold">Display</h2>
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
        <h2 className="text-sm font-semibold">Home Assistant</h2>
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
          <button onClick={test} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm inline-flex items-center gap-1"><Send size={14} aria-hidden />Send test</button>
        </div>
        {msg && <p className="text-sm text-neutral-400">{msg}</p>}
      </section>
      <section className="space-y-4 mt-10">
        <h2 className="text-sm font-semibold">Notifications on this device</h2>
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
        <h2 className="text-sm font-semibold">Passkeys (fingerprint / device PIN)</h2>
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
                <Trash2 size={12} aria-hidden />remove
              </button>
            </li>
          ))}
          {passkeys.length === 0 && <li className="text-sm text-neutral-500 py-2">No passkeys yet.</li>}
        </ul>
        {passkeyMsg && <p className="text-sm text-neutral-400">{passkeyMsg}</p>}
      </section>

      <section className="space-y-4 mt-10">
        <h2 className="text-sm font-semibold">Account</h2>
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
