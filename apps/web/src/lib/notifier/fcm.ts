import { createSign } from "node:crypto";
import { prisma } from "../db";
import type { Notifier, NotifierPayload } from "./index";

/**
 * Firebase Cloud Messaging, for the Android build.
 *
 * The APK cannot use Web Push: Android's WebView implements no Push API, and
 * `navigator.serviceWorker` is not even defined inside it. FCM is the only
 * mechanism that reaches a device the operating system has put to sleep — a
 * high-priority message wakes it, grants a short wakelock and brief network
 * access, then lets it fall back to idle. Everything else this project tried
 * was deferred by Doze.
 *
 * Sends a **notification** payload rather than data-only. Android renders that
 * one itself, without waking the app to run any code; a data-only message
 * needs the app to execute, which is the thing Doze prevents and the reason
 * the on-device runner never delivered anything.
 */

export type StoredToken = { id: string; token: string };
export type FcmSendFn = (token: string, message: Record<string, unknown>) => Promise<unknown>;

/** Google's word for "this device is gone" — uninstalled, or the token rotated. */
const GONE = new Set(["UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT"]);

export class FcmNotifier implements Notifier {
  constructor(
    private readonly deps: {
      list: () => Promise<StoredToken[]>;
      remove: (id: string) => Promise<void>;
      sendFn: FcmSendFn;
    },
  ) {}

  async send(payload: NotifierPayload): Promise<void> {
    const tokens = await this.deps.list();
    if (tokens.length === 0) throw new Error("no fcm tokens registered");

    const message = {
      notification: {
        title: payload.text?.title ?? `${payload.symbol} · ${payload.signal}`,
        body: payload.text?.body ?? `price ${payload.price} (${payload.timeframe})`,
      },
      android: {
        // Doze defers anything less. This is the whole point of using FCM.
        priority: "high",
        notification: { channel_id: "alerts", click_action: "OPEN_ALERTS" },
      },
      data: { url: `/portfolio/${encodeURIComponent(payload.symbol)}`, alertId: payload.alertId },
    };

    let delivered = 0;
    for (const t of tokens) {
      try {
        await this.deps.sendFn(t.token, message);
        delivered++;
      } catch (e) {
        const code = (e as { fcmError?: string }).fcmError;
        // Only forget a device Google says is gone. A network blip is not an
        // uninstall, and dropping the token would silently unsubscribe someone
        // because their wifi hiccuped.
        if (code && GONE.has(code)) await this.deps.remove(t.id);
      }
    }
    if (delivered === 0) throw new Error("fcm failed for every registered device");
  }
}

/* ----------------------------------------------------------- access tokens */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let cached: { token: string; expires: number } | null = null;

/**
 * An OAuth2 access token for the FCM HTTP v1 API, minted from the service
 * account and cached until shortly before it expires.
 *
 * Hand-rolled rather than pulling in `google-auth-library`: it is one RS256
 * JWT and one form post, and this file is already the only place in the
 * project that talks to Google. The library would be a large dependency for
 * thirty lines.
 */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const signature = createSign("RSA-SHA256")
    .update(unsigned)
    .sign(sa.private_key.replace(/\\n/g, "\n"), "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`fcm auth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

/**
 * Null when unconfigured, matching `makeWebPushNotifier`: an absent notifier
 * is skipped, never a broken one that throws on every tick.
 */
export function makeFcmNotifier(): FcmNotifier | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) return null;

  return new FcmNotifier({
    list: () => prisma.fcmToken.findMany({ select: { id: true, token: true } }),
    remove: async (id) => {
      await prisma.fcmToken.delete({ where: { id } }).catch(() => {});
    },
    sendFn: async (token, message) => {
      const at = await accessToken(sa);
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
          body: JSON.stringify({ message: { token, ...message } }),
        },
      );
      if (res.ok) return res.json();
      const body = (await res.json().catch(() => ({}))) as {
        error?: { details?: { errorCode?: string }[]; status?: string };
      };
      // The machine-readable reason lives in details[].errorCode; `status` is
      // the coarse HTTP-ish one. Either can carry UNREGISTERED.
      const code =
        body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
      throw Object.assign(new Error(`fcm send failed: ${res.status}`), { fcmError: code });
    },
  });
}
