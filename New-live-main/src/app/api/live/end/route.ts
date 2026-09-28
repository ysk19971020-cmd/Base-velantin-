import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// POST /api/live/end — host ends their live stream. The client broadcasts
// the end over Agora RTM (lobby channel) so every open tab drops it.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const body = await request.json().catch(() => ({}));
    const liveId = String(body.liveId ?? "");
    if (!liveId) {
      return NextResponse.json({ error: "Missing liveId" }, { status: 400 });
    }

    const live = await db.liveStream.findFirst({
      where: { id: liveId, hostId: auth.userId, status: "active" },
    });
    if (!live) {
      return NextResponse.json({ error: "Live not found" }, { status: 404 });
    }

    await db.liveStream.update({
      where: { id: live.id },
      data: { status: "ended", endedAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("End live error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
