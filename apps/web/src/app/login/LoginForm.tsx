"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import Button from "@/components/Button";

// Only follow same-origin, relative paths for post-login redirects. Anything
// else (absolute URLs, protocol-relative "//host" paths, backslash variants
// like "/\host" that URL parsing normalizes to "//host") falls back to the
// default destination to prevent an open redirect via ?next=.
function safeNextPath(next: string | null, fallback = "/portfolio"): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  return fallback;
}

export default function LoginForm({ mode }: { mode: "login" | "setup" }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyReady, setPasskeyReady] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  // Offer the passkey button only where WebAuthn can actually run (secure
  // context) and at least one passkey is registered.
  useEffect(() => {
    if (mode !== "login" || !browserSupportsWebAuthn() || !window.isSecureContext) return;
    fetch("/api/webauthn/login/options", { method: "POST" })
      .then((r) => setPasskeyReady(r.ok))
      .catch(() => {});
  }, [mode]);

  async function passkeyLogin() {
    setError(null);
    setBusy(true);
    try {
      const options = await fetch("/api/webauthn/login/options", { method: "POST" }).then((r) => {
        if (!r.ok) throw new Error("no passkeys registered");
        return r.json();
      });
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await fetch("/api/webauthn/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d.error === "string" ? d.error : "passkey verification failed");
      }
      router.replace(safeNextPath(params.get("next")));
      router.refresh();
    } catch (e) {
      // NotAllowedError = user dismissed the prompt; keep quiet about that.
      if ((e as Error).name !== "NotAllowedError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
    /*
      Choosing a password is the first half of setting up, not the whole of
      it. `/api/setup` signs the session in, so sending a first run to
      `/setup` lands on the flow itself — currency, a portfolio, your data,
      alerts — which is what the phone does and what the web previously
      skipped entirely by going straight to an empty portfolio.

      A `?next=` still wins, so following a link into a protected page and
      being asked to set up first still returns you to where you were going.
    */
    router.replace(safeNextPath(params.get("next"), mode === "setup" ? "/setup" : "/portfolio"));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 w-full max-w-xs">
      <label className="block">
        <span className="block text-[13px] text-neutral-400 mb-[5px]">{mode === "setup" ? "Choose a password (min 8 chars)" : "Password"}</span>
        <input type="password" autoFocus placeholder="Password" className="w-full bg-neutral-900 border border-neutral-700 rounded-[9px] px-3 py-2.5 text-sm"
               value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {mode === "setup" && (
        <label className="block">
          <span className="block text-[13px] text-neutral-400 mb-[5px]">Confirm password</span>
          <input type="password" className="w-full bg-neutral-900 border border-neutral-700 rounded-[9px] px-3 py-2.5 text-sm"
                 value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      )}
      {/* The form's submit: implicit here before, which the explicit
          type="button" on the passkey button below depended on. */}
      <Button block type="submit" disabled={busy} className="font-medium" style={{ borderRadius: 9, padding: 11 }}>
        {mode === "setup" ? "Set password" : "Log in"}
      </Button>
      {passkeyReady && (
        <button type="button" disabled={busy} onClick={passkeyLogin}
                className="w-full bg-neutral-800 border border-neutral-700 disabled:opacity-50 text-white rounded px-3 py-2 text-sm inline-flex items-center justify-center gap-2">
          <Fingerprint size={16} aria-hidden />
          Use passkey (fingerprint / PIN)
        </button>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
