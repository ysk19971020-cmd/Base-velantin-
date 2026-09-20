import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// POST /api/live/[id]/comment — persist a live comment (replaces the WS
// service live_comment). The client broadcasts the returned comment over the
// stream's Agora RTM channel so every viewer sees it in real time.
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const text = String(body.text ?? "").slice(0, 240);
    if (!text) {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    const live = await db.liveStream.findFirst({
      where: { id, status: "active" },
    });
    if (!live) {
      return NextResponse.json({ error: "Live ended" }, { status: 404 });
    }

    const me = await db.user.findUnique({
      where: { id: auth.userId },
      select: { name: true },
    });
    const userName = me?.name ?? "Unknown";

    await db.liveComment.create({
      data: { streamId: id, userId: auth.userId, userName, text },
    });

    return NextResponse.json({ comment: { user: userName, text } });
  } catch (error) {
    console.error("Live comment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
