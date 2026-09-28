import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// GET /api/lives — active live streams (replaces the WS service lives list).
// Viewer counts are realtime-only (Agora RTM presence), so this returns 0 and
// the client fills counts from presence. Email alerts to subscribers (the
// old WS service sent them) are NOT sent here — no mail provider is wired
// into the Next.js app.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const lives = await db.liveStream.findMany({
      where: { status: "active" },
      include: { host: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      lives.map((l) => ({
        id: l.id,
        hostId: l.hostId,
        host: l.host.name,
        title: l.title,
        viewers: 0,
      })),
    );
  } catch (error) {
    console.error("List lives error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
