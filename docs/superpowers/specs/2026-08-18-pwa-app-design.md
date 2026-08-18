# Trader as an installable app (PWA) — design

**Date:** 2026-08-18
**Status:** Approved design, pending implementation plan
**Related:** Epic #5 (Delta-style portfolio tracker); builds on #1 (portfolio MVP) and #2 (portfolio alerts)

## Goal

Turn the existing single-user Trader web app into an installable, phone-friendly app — a
personal free alternative to Delta by eToro. Product shape decisions, in order:

1. **Personal-first**: built for one user (Roy), but nothing should block a later
   open-source/self-hosted or multi-user direction.
2. **Reachable from anywhere**: served on a public domain behind a reverse proxy with
   Let's Encrypt TLS (HTTPS is also a hard requirement for PWA install and Web Push).
3. **Built-in password login**: single-user auth inside the app, not at the proxy.
4. **Web Push in addition to Home Assistant**: alerts push to the phone directly from the
   PWA *and* keep flowing through the HA webhook fan-out.
5. **Portfolio-first mobile UI**: the app opens on the portfolio dashboard; bottom tab
   bar navigation on phones.

Non-goals (explicitly out of scope): app stores / native wrappers, multi-user accounts,
offline caching of data, Docker packaging, retiring the HA notifier.

## 1. Auth & security

- **First-run setup**: when `Settings.passwordHash` is null, all guarded routes redirect
  to a one-time `/setup` screen that sets the password. Stored as an **scrypt** hash
  (Node `crypto.scrypt`, per-hash random salt) in the existing `Settings` row (new
  nullable `passwordHash` column).
- **Login**: `/login` page POSTs to `/api/login`; on success the server sets a **signed
  HttpOnly Secure cookie** containing a JWT (via `jose`, HS256 with `SESSION_SECRET`
  from env, 30-day expiry, refreshed on use). `/api/logout` clears it.
- **Middleware guard** (`src/middleware.ts`): everything requires a valid session
  except:
  - `/login`, `/setup`, `/api/login`, `/api/setup`
  - static/PWA assets: `/_next/*`, `/manifest.webmanifest`, `/sw.js`, `/icons/*`, `/favicon.ico`
  - `/api/cron/evaluate` — guarded separately by `Authorization: Bearer ${CRON_SECRET}`
    (env var; the route rejects when the header is absent or wrong).
- **Brute-force damping**: in-memory failed-attempt counter with exponential backoff per
  source IP (best effort; resets on restart — acceptable for single-user).
- **Password change** on the Settings page (requires current password).
- HA integration is outbound-only and unaffected.

## 2. PWA & Web Push

- **Manifest** (`/manifest.webmanifest`): name "Trader", `display: standalone`,
  `start_url: /portfolio`, dark theme colors, maskable icons (192/512 px, generated
  once, committed under `public/icons/`).
- **Service worker** (`public/sw.js`): hand-rolled, no Workbox/Serwist. Handlers:
  - `push`: `showNotification(title, { body, data })` from the JSON payload.
  - `notificationclick`: focus/open the URL in `event.notification.data.url`
    (e.g. `/alerts`).
  - No fetch/caching handlers — every screen is live data; offline shows the browser
    default. This is deliberate.
- **Push pipeline**:
  - `web-push` npm package; VAPID keys from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
    env vars (generated once via `npx web-push generate-vapid-keys`).
  - New Prisma model `PushSubscription { id, endpoint @unique, p256dh, auth, createdAt }`.
  - Settings page: "Enable notifications on this device" → asks Notification
    permission, subscribes via `pushManager.subscribe`, POSTs to
    `/api/push/subscribe`. Unsubscribe button removes it. `GET /api/push/vapid` serves
    the public key.
  - New `WebPushNotifier implements Notifier` (`src/lib/notifier/web-push.ts`): sends
    the standard `NotifierPayload` JSON to every stored subscription; a 404/410
    response deletes that subscription (expired device).
  - The cron evaluator composes notifiers: `[HomeAssistantNotifier?, WebPushNotifier?]`
    — each alert event is dispatched to all of them; a failure in one does not block
    the other. `AlertEvent.delivered` means "at least one notifier succeeded".
  - "Send test" on Settings exercises both notifiers.
- **iOS caveat** (documented in README): Web Push requires the PWA to be installed to
  the Home Screen (iOS 16.4+).

## 3. Mobile UI (portfolio-first)

- **App shell** in the root layout: on viewports `< md`, a fixed **bottom tab bar** —
  Portfolio · Chart · Alerts · More. "More" opens a sheet/menu linking Settings,
  Backtest, Analyze. On `>= md` the existing pages and home links stay as they are.
- **Portfolio page** (primary mobile screen): stat tiles in a 2-column grid; value
  chart and allocation donut stack vertically; the holdings table becomes cards
  (symbol, qty, value, unrealized P&L) on small screens; transaction form fields wrap.
- **Alerts page**: create form wraps to full-width rows; alert list items stack.
- **Chart page**: full-bleed panes, header condenses (symbol input + risk readout).
- **Backtest / Analyze**: unchanged, desktop-oriented, reachable via More.
- Viewport/theme meta tags (`theme-color`, `apple-mobile-web-app-*`) for a chromeless
  installed feel.

## 4. Deployment

- Same single Next.js server + SQLite; production runs `next build` + `next start`
  behind a reverse proxy.
- **New env vars**: `SESSION_SECRET`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY` (alongside existing `DATABASE_URL`).
- **README deployment section**:
  - Caddyfile example: `trader.example.com { reverse_proxy localhost:3000 }`
    (automatic Let's Encrypt).
  - systemd unit example for the Next server.
  - Cron example: `*/5 * * * * curl -H "Authorization: Bearer $CRON_SECRET" https://trader.example.com/api/cron/evaluate`
  - VAPID key generation, first-run setup flow, iOS install steps.

## Testing

- **Vitest**: session-token sign/verify helpers (expiry, tampering), middleware
  public-path matcher, scrypt hash/verify round-trip, WebPushNotifier subscription
  pruning on 404/410 (fetch mocked), cron bearer check.
- **Manual**: Lighthouse PWA installability pass; install + push round-trip on the
  actual phone (the only place iOS push can truly be verified); login/logout/change
  password; cron with and without the bearer token.

## Component boundaries

- `src/lib/auth.ts` — pure-ish auth core: scrypt hash/verify, JWT sign/verify,
  cookie name/options. No Prisma imports; used by middleware, API routes, and tests.
- `src/lib/notifier/web-push.ts` — `WebPushNotifier`, self-contained; storage access
  via injected callbacks or thin Prisma calls, prunable in isolation.
- `src/middleware.ts` — path rules + session check only; no business logic.
- UI shell — one `TabBar` client component in the root layout; pages stay unaware of
  the shell.

## Risks / open items

- iOS storage eviction: an installed-but-unused PWA can have its service worker and
  push subscription evicted by iOS after weeks of disuse; mitigated by HA remaining a
  second delivery path.
- In-memory login backoff resets on restart — accepted for single-user scope.
- If the app is ever opened to other users, auth (sessions table, users table) and
  per-user data scoping become the first refactor; nothing in this design writes
  against that (single `Settings` row and global data are the only single-user
  assumptions, both isolated behind Prisma).
