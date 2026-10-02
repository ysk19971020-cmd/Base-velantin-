# Base44 Dev Environment — Valentine Express Live Stream

## Stack
- **Next.js 16** (Turbopack) + React 19 + Tailwind 4 + shadcn/ui
- **Bun** as package manager / runtime (bun.lock)
- **Prisma 6** with **PostgreSQL** (provider is `postgresql` in `prisma/schema.prisma` — SQLite will NOT work)
- **JWT sessions** signed with `BETTER_AUTH_SECRET` (jose) — email/password auth, no external auth provider required to boot
- **Agora** for realtime (replaces the old socket.io / LiveKit stack):
  - **RTM** (`agora-rtm-sdk`) carries chat, live comments, gifts, and presence — see `src/lib/agora.ts`
  - **RTC** (`agora-rtc-sdk-ng`) handles live video/audio transport — used in `src/app/page.tsx`
  - Token route: `POST /api/agora/token` (needs `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE`; returns 503 until set)
  - Without Agora credentials the app still boots and renders — live features are inactive

## Project layout
- App source is in `New-live-main/` (not the repo root)
- Single-page client app: `src/app/page.tsx` is the entire UI
- API routes under `src/app/api/` (auth, wallet, payments, kyc, statuses, admin, agora, etc.)
- Mini-services (`mini-services/ws-service`, `mini-services/cloudflare-ws`, `mini-services/node-ws`) are the original realtime deployments — NOT run in the preview

## How it boots (docker-compose.base44.yml)
1. `db` — postgres:16-alpine with healthcheck
2. `web` — oven/bun:1.2, bind-mounts `./New-live-main:/app`, runs:
   `bun install && bunx prisma db push --accept-data-loss && bunx next dev -p 3000 -H 0.0.0.0`
3. `node_modules` is a named volume (`app_node_modules`) so container installs don't pollute the host

## Key fixes applied for this environment
- **`@prisma/client` REMOVED from `serverExternalPackages`** in `next.config.ts` — including it caused Turbopack to try resolving a hash-suffixed generated module (`@prisma/client-<hash>`) that doesn't exist as a standalone package, making all API routes 500. Turbopack bundles `@prisma/client` natively without issues. `pg` and `@prisma/adapter-pg` remain external.
- **`agora-rtc-sdk-ng` and `agora-rtm-sdk` are lazy-loaded** — both SDKs reference `window` at module-evaluation time, so a top-level `import` in a `'use client'` component crashes SSR (`ReferenceError: window is not defined`). `page.tsx` uses an async `AgoraRTC()` loader; `agora.ts` dynamically imports `agora-rtm-sdk` inside the `login()` method.
- **`allowedDevOrigins`** set to `3000-${BASE44_PUBLIC_HOST_SUFFIX}` so Next.js accepts the preview origin's HMR/asset requests
- **`BETTER_AUTH_SECRET`** set to a real value in `.env.base44-defaults` (session.ts throws if it's the default placeholder)

## External secrets (all optional — app boots without them)
Google OAuth, Cloudinary, PayPal, Firebase, Dialog Genie, HilltopAds, Agora.
Email/password auth works without any of these. Image uploads, payments, push notifications, and live streaming need the respective credentials.

## Verify it works
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → 200
- `curl -s http://localhost:3000/api/statuses` → 200 (JSON array)
- Register a user: `POST /api/auth/register` with `{name, email, password}` → 201 + session token
