"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [haUrl, setHaUrl] = useState("");
  const [haWebhookId, setHaWebhookId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"unsupported" | "off" | "on" | "busy">("busy");

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      if (d.settings) {
        setHaUrl(d.settings.haUrl ?? "");
        setHaWebhookId(d.settings.haWebhookId ?? "");
      }
    });
  }, []);

  useEffect(() => {
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
      body: JSON.stringify({ haUrl: haUrl || null, haWebhookId: haWebhookId || null }),
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
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
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
          <button onClick={save} className="bg-blue-600 text-white rounded px-3 py-1 text-sm">Save</button>
          <button onClick={test} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm">Send test</button>
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
            className="bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-1 text-sm"
          >
            {pushState === "on" ? "Disable notifications" : "Enable notifications"}
          </button>
        )}
        <p className="text-xs text-neutral-500">“Send test” above exercises both Home Assistant and Web Push.</p>
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
          <button onClick={changePassword} className="bg-blue-600 text-white rounded px-3 py-1 text-sm">Change password</button>
          <button onClick={logout} className="bg-neutral-700 text-white rounded px-3 py-1 text-sm">Log out</button>
        </div>
        {pwMsg && <p className="text-sm text-neutral-400">{pwMsg}</p>}
      </section>
    </main>
  );
}
