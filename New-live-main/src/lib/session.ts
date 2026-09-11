// ---------------------------------------------------------------------------
// Signed session tokens
// ---------------------------------------------------------------------------
// Replaces the old scheme of using the raw user.id as a bearer "token".
// That scheme let anyone who saw a user's id anywhere in the app (chat
// sender ids, live gift sender ids, stream host ids, etc.) authenticate as
// that user. Every session token here is a signed, expiring JWT instead —
// it can't be forged or reused without BETTER_AUTH_SECRET, and it expires.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecretKey(): Uint8Array {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret === "change-me-to-a-long-random-string") {
    throw new Error(
      "BETTER_AUTH_SECRET is not set to a real value. Set a long random string in .env before starting the server.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

/**
 * Extracts and verifies the session token from a request.
 * Returns the authenticated userId, or null if missing/invalid/expired.
 * Accepts the token via `Authorization: Bearer <token>` header (preferred)
 * or a `session` cookie (for browser navigation / non-fetch requests).
 */
export async function getSessionUserId(
  request: NextRequest,
): Promise<string | null> {
  let token: string | null = null;

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }
  if (!token) {
    token = request.cookies.get("session")?.value ?? null;
  }
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Require a valid session. Returns { userId } on success, or a
 * NextResponse (401) to return immediately on failure.
 */
export async function requireUser(
  request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  const userId = await getSessionUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  return { userId };
}

/**
 * Require a valid session belonging to an admin user (role === "admin").
 * Returns { userId } on success, or a NextResponse (401/403) on failure.
 */
export async function requireAdmin(
  request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  const auth = await requireUser(request);
  if (auth instanceof NextResponse) return auth;

  const user = await db.user.findUnique({ where: { id: auth.userId } });
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Unauthorized: admin role required" },
      { status: 403 },
    );
  }
  return { userId: auth.userId };
}

export function isNextResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// Ad-reward tokens
// ---------------------------------------------------------------------------
// Short-lived, single-purpose signed tokens for the "watch an ad, get coins"
// flow. Issued by /api/wallet/ad-reward/start right before the ad is shown,
// and checked by /api/wallet/ad-reward/claim after it reports completion.
//
// Honest limitation: this proves the *server* issued a token recently and
// that this user hasn't already claimed it — it does NOT cryptographically
// prove the ad actually played to completion in the browser, since that
// signal comes from client-side JS. A sufficiently determined user could
// still fake the "ad finished" event. This is a reasonable deterrent against
// casual abuse (combined with the per-user cooldown), not a strong
// anti-fraud guarantee. If HilltopAds' server-to-server postback is ever
// wired up for your specific ad zone, that would close this gap properly.
const AD_REWARD_TOKEN_TTL_SECONDS = 120; // 2 minutes to actually watch the ad

export async function createAdRewardToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, purpose: 'ad_reward' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${AD_REWARD_TOKEN_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifyAdRewardToken(
  token: string,
  expectedUserId: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload.sub === expectedUserId && payload.purpose === 'ad_reward';
  } catch {
    return false;
  }
}
