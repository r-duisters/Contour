"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Only follow same-origin, relative paths for post-login redirects. Anything
// else (absolute URLs, protocol-relative "//host" paths) falls back to the
// default destination to prevent an open redirect via ?next=.
function safeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/portfolio";
}

export default function LoginForm({ mode }: { mode: "login" | "setup" }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "setup" && password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    const res = await fetch(mode === "setup" ? "/api/setup" : "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.status === 409 && mode === "login") { router.replace("/setup"); return; }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "Failed. Try again.");
      return;
    }
    router.replace(safeNextPath(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 w-full max-w-xs">
      <label className="block text-sm">
        <span className="text-neutral-400">{mode === "setup" ? "Choose a password (min 8 chars)" : "Password"}</span>
        <input type="password" autoFocus className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
               value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {mode === "setup" && (
        <label className="block text-sm">
          <span className="text-neutral-400">Confirm password</span>
          <input type="password" className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1"
                 value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      )}
      <button disabled={busy} className="w-full bg-blue-600 disabled:opacity-50 text-white rounded px-3 py-2 text-sm">
        {mode === "setup" ? "Set password" : "Log in"}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
