import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// POST /api/live/start — go live (replaces the WS service live_start).
// Ends any previous active stream of this host, creates a new LiveStream row
// and returns it. The client then broadcasts the live over Agora RTM
// (lobby channel) and joins the stream's RTC channel as host.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const body = await request.json().catch(() => ({}));

    await db.liveStream.updateMany({
      where: { hostId: auth.userId, status: "active" },
      data: { status: "ended", endedAt: new Date() },
    });

    const me = await db.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    });

    const title = String(body.title ?? "").slice(0, 80) || `${me?.name ?? "Someone"} live`;

    const live = await db.liveStream.create({
      data: { hostId: auth.userId, title, status: "active" },
    });

    return NextResponse.json({
      live: {
        id: live.id,
        hostId: auth.userId,
        host: me?.name ?? "Unknown",
        title,
        viewers: 1,
      },
    });
  } catch (error) {
    console.error("Start live error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
