import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// POST /api/chat/open — open (or create) a direct-message chat with a peer.
// Replaces the WS service's dm_open. The chat id is deterministic
// (dm:<a>:<b>, ids sorted) so both users always land in the same chat with
// shared history. Unlike the old WS version, the peer does NOT have to be
// online — the chat is created and the peer sees it on next login.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const body = await request.json().catch(() => ({}));
    const peerId = String(body.peerId ?? "");
    if (!peerId || peerId === auth.userId) {
      return NextResponse.json({ error: "Missing peer" }, { status: 400 });
    }

    const [me, peer] = await Promise.all([
      db.user.findUnique({ where: { id: auth.userId } }),
      db.user.findUnique({ where: { id: peerId } }),
    ]);
    if (!peer) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const chatId = ["dm", ...[auth.userId, peerId].sort()].join(":");

    await db.chat.upsert({
      where: { id: chatId },
      update: {},
      create: { id: chatId, name: `${me?.name ?? "User"} × ${peer.name}`, isGroup: false },
    });
    await db.chatMember.upsert({
      where: { chatId_userId: { chatId, userId: auth.userId } },
      update: {},
      create: { chatId, userId: auth.userId },
    });
    await db.chatMember.upsert({
      where: { chatId_userId: { chatId, userId: peerId } },
      update: {},
      create: { chatId, userId: peerId },
    });

    return NextResponse.json({
      chat: {
        id: chatId,
        name: `${me?.name ?? "User"} × ${peer.name}`,
        group: false,
        last: "Direct message",
        time: "",
        memberIds: [auth.userId, peerId],
      },
    });
  } catch (error) {
    console.error("Open chat error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
