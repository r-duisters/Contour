"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import Button from "@/components/Button";
import { field } from "@/components/field";

// Only follow same-origin, relative paths for post-login redirects. Anything
// else (absolute URLs, protocol-relative "//host" paths, backslash variants
// like "/\host" that URL parsing normalizes to "//host") falls back to the
// default destination to prevent an open redirect via ?next=.
function safeNextPath(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) return next;
  return "/portfolio";
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
    router.replace(safeNextPath(params.get("next")));
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4 w-full max-w-xs">
      <label className="block text-sm">
        <span className="text-neutral-400">{mode === "setup" ? "Choose a password (min 8 chars)" : "Password"}</span>
        <input type="password" autoFocus className={`mt-1 w-full ${field()}`}
               value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {mode === "setup" && (
        <label className="block text-sm">
          <span className="text-neutral-400">Confirm password</span>
          <input type="password" className={`mt-1 w-full ${field()}`}
                 value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
      )}
      {/* The form's submit: implicit here before, which the explicit
          type="button" on the passkey button below depended on. */}
      <Button block type="submit" disabled={busy}>
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
