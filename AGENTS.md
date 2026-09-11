# Base44 Dev Environment — Valentine Express Live Stream

## Stack
- **Next.js 16** (Turbopack) + React 19 + Tailwind 4 + shadcn/ui
- **Bun** as package manager / runtime (bun.lock)
- **Prisma 6** with **PostgreSQL** (provider is `postgresql` in `prisma/schema.prisma` — SQLite will NOT work)
- **JWT sessions** signed with `BETTER_AUTH_SECRET` (jose) — email/password auth, no external auth provider required to boot
- Socket.IO shim over native WebSocket (`src/lib/socket.ts`) — connects to an external WS service via `NEXT_PUBLIC_WS_URL` (left blank in preview; live chat/streaming features are inactive but the app renders fine)

## Project layout
- App source is in `New-live-main/` (not the repo root)
- Single-page client app: `src/app/page.tsx` is the entire UI
- API routes under `src/app/api/` (auth, wallet, payments, kyc, statuses, admin, etc.)
- Mini-services (`mini-services/ws-service`, `mini-services/cloudflare-ws`) are the original realtime deployments (Socket.IO / Cloudflare Worker) — NOT run in the preview
- `mini-services/node-ws` is a faithful Node port of AppRoom (raw WebSocket, `{event, data}` envelope, same events/SQL via `pg`) — this is what runs locally on port 3001
- `NEXT_PUBLIC_WS_URL` is set to `https://3001-${BASE44_PUBLIC_HOST_SUFFIX}` in the web service env; the public proxy supports WebSocket upgrade (verified: hello → snapshot handshake works)

## How it boots (docker-compose.base44.yml)
1. `db` — postgres:16-alpine with healthcheck
2. `web` — oven/bun:1.2, bind-mounts `./New-live-main:/app`, runs:
   `bun install && bunx prisma db push --accept-data-loss && bunx next dev -p 3000 -H 0.0.0.0`
3. `node_modules` is a named volume (`app_node_modules`) so container installs don't pollute the host

## Key fixes applied for this environment
- **`@prisma/client` added to `serverExternalPackages`** in `next.config.ts` — without it, Turbopack fails to resolve the Prisma generated client (`@prisma/client-<hash>`) and all API routes 500
- **`allowedDevOrigins`** set to `3000-${BASE44_PUBLIC_HOST_SUFFIX}` so Next.js accepts the preview origin's HMR/asset requests
- **`BETTER_AUTH_SECRET`** set to a real value in `.env.base44-defaults` (session.ts throws if it's the default placeholder)

## External secrets (all optional — app boots without them)
Google OAuth, Cloudinary, PayPal, Firebase, Dialog Genie, HilltopAds, TURN server.
Email/password auth works without any of these. Image uploads, payments, push notifications, and live streaming need the respective credentials.

## Verify it works
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → 200
- `curl -s http://localhost:3000/api/statuses` → 200 (JSON array)
- Register a user: `POST /api/auth/register` with `{name, email, password}` → 200 + session token
