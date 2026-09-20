import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole, RtmTokenBuilder } from "agora-token";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// Agora token minting
// ---------------------------------------------------------------------------
// The browser talks to Agora's cloud directly: RTM (Signaling) for chat /
// presence and RTC for live video. Both need per-user tokens signed with the
// App Certificate — media and messages never flow through this Next.js app,
// which is what makes the whole stack work on serverless (Vercel).
// Requires AGORA_APP_ID + AGORA_APP_CERTIFICATE from the Agora console
// (https://console.agora.io). Returns 503 until they are set.
// ---------------------------------------------------------------------------

// Login/RTC tokens are valid for 8h; the client re-fetches a fresh token on
// RTM's tokenPrivilegeWillExpire and renews the session transparently.
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

export async function POST(request: NextRequest) {
  const auth = await requireUser(request);
  if (isNextResponse(auth)) return auth;

  const appId = process.env.AGORA_APP_ID;
  const appCertificate = process.env.AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) {
    return NextResponse.json(
      {
        error:
          "Realtime is not configured. Set AGORA_APP_ID and AGORA_APP_CERTIFICATE.",
      },
      { status: 503 },
    );
  }

  let body: { channel?: string; isHost?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — RTM login only.
  }

  const rtmToken = RtmTokenBuilder.buildToken(
    appId,
    appCertificate,
    auth.userId,
    TOKEN_TTL_SECONDS,
  );

  if (!body.channel) {
    return NextResponse.json({ appId, rtmToken });
  }

  // RTC token: uid 0 = not bound to a specific uid (the SDK picks one on
  // join), and the role decides publish vs subscribe rights.
  const rtcToken = RtcTokenBuilder.buildTokenWithUid(
    appId,
    appCertificate,
    body.channel,
    0,
    body.isHost ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
  );

  return NextResponse.json({ appId, rtmToken, rtcToken });
}
