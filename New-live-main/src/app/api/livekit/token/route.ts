import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// LiveKit access token minting
// ---------------------------------------------------------------------------
// The browser joins the live-stream room directly through LiveKit (Cloud or a
// self-hosted SFU) — media never flows through this Next.js app, which is what
// makes this pairing work on Vercel/serverless. LiveKit access tokens are
// plain HS256 JWTs with a `video` grant; LiveKit's own server SDK does the
// same thing, but jose is already a dependency and runs fine on the serverless
// runtime. Requires LIVEKIT_URL + LIVEKIT_API_KEY + LIVEKIT_API_SECRET env
// vars (see .env.example) — until they're set this route returns 503 and the
// client shows a "not configured" message.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isNextResponse(auth)) return auth;

  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return NextResponse.json(
      {
        error:
          "Live streaming is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.",
      },
      { status: 503 },
    );
  }

  let body: { room?: string; isHost?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const room = body.room?.trim();
  if (!room) {
    return NextResponse.json({ error: "Missing room" }, { status: 400 });
  }

  const token = await new SignJWT({
    video: {
      roomJoin: true,
      room,
      canPublish: !!body.isHost,
      canSubscribe: true,
      canPublishData: true,
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(apiKey)
    .setSubject(auth.userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(apiSecret));

  return NextResponse.json({ url, token });
}
