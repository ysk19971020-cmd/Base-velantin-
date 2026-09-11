# Valentine Express — Realtime backend (Cloudflare Worker)

Alternative to `mini-services/ws-service` (Node.js + Socket.IO). Same
realtime features (chat, live streams, gifts, WebRTC signaling), same
database (Neon Postgres, same tables) — different runtime, because
Cloudflare Workers is genuinely free without a credit card, unlike
Railway/Render/Fly.io's free tiers.

## Why this looks different from `ws-service`

Cloudflare Workers run on V8 isolates, not Node.js — Socket.IO (which needs
a real Node HTTP server to attach to) can't run here at all. This is a
from-scratch port to:
- **Durable Objects** for the persistent, stateful WebSocket room (one
  global `AppRoom` instance holds connected users / active lives in
  memory, same as the old Node process did)
- **Raw WebSocket API** instead of Socket.IO, with a simple
  `{ event, data }` JSON message protocol
- **`@neondatabase/serverless`** (raw SQL over HTTP) instead of Prisma —
  Prisma's Cloudflare Workers driver-adapter support is still preview-stage
  and has had real bugs (queries hanging). Raw SQL is simpler and more
  reliable for this specific combination.

The frontend didn't need to change its event-handling code at all — see
`src/lib/socket.ts`, which wraps a native WebSocket in the same
`.on()`/`.emit()`/`.connected` shape Socket.IO's client used, so every
existing `socket.on('live_gift', ...)`-style call in `src/app/page.tsx`
keeps working unmodified.

## ⚠️ This code has not been run against a live Cloudflare account

It was written and reviewed carefully, matching the old `ws-service`'s
logic event-for-event, but this sandbox has no network access to actually
run `wrangler dev`/`wrangler deploy` or hit a real Neon database. Treat
this as a solid first draft — budget time to debug real deploy/runtime
errors, the way you would for any new service you stand up for the first
time.

## Deploy steps

```bash
cd mini-services/cloudflare-ws
npm install -g wrangler   # if you don't have it
npm install
wrangler login             # opens a browser to authenticate — no card needed
                            # for the free Workers/Durable Objects tier

# Secrets (NOT in wrangler.toml — these are encrypted, set via CLI):
wrangler secret put DATABASE_URL
# paste your Neon connection string when prompted

wrangler secret put BETTER_AUTH_SECRET
# paste the EXACT same value as the Vercel app's BETTER_AUTH_SECRET —
# this Worker verifies the same signed session tokens the Next.js app issues

wrangler secret put FRONTEND_URL
# your Vercel app's URL, e.g. https://valentine-express.vercel.app
# (used for CORS — only this origin can open a WebSocket connection)

wrangler deploy
```

`wrangler deploy` prints the Worker's URL, e.g.
`https://valentine-express-ws.<your-subdomain>.workers.dev`. Put that
(no trailing path) into the main app's `NEXT_PUBLIC_WS_URL` on Vercel, then
redeploy the Vercel app (`NEXT_PUBLIC_*` vars are baked in at build time).

## Local dev

```bash
cd mini-services/cloudflare-ws
cp .dev.vars.example .dev.vars   # fill in the same 3 values as above
wrangler dev
```

This runs the Worker locally (default `http://localhost:8787`) — point the
main app's `.env.local` at `NEXT_PUBLIC_WS_URL=http://localhost:8787` for
local testing.

## Known limitation: no hibernation

This Durable Object stays pinned in memory for as long as any WebSocket is
connected to it, rather than using Cloudflare's newer Hibernation API. That
API would let Cloudflare evict the object from memory during idle stretches
to reduce cost — but our connected-users/live-rooms state lives in plain JS
fields, and hibernation would silently wipe that unless it were rewritten
to persist to `ctx.storage` and reconstruct on wake. For a personal-scale
app, staying pinned while connected should comfortably fit the free tier.
If you outgrow it, that persistence rework is the next step — not
something to take on speculatively now.

## Keeping catalogs in sync

`src/gifts.ts` here is a third copy of the gift catalog (alongside
`src/server/gifts.ts` in the main app and `mini-services/ws-service/lib/gifts.ts`).
If you change gift pricing, update all three or gift costs will disagree
between services.
