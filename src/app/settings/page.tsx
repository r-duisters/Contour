"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [haUrl, setHaUrl] = useState("");
  const [haWebhookId, setHaWebhookId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => {
      if (d.settings) {
        setHaUrl(d.settings.haUrl ?? "");
        setHaWebhookId(d.settings.haWebhookId ?? "");
      }
    });
  }, []);

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
