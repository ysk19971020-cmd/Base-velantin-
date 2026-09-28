import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// /api/chat/messages — DM/group chat history and sending.
// Replaces the WS service's chat_send + snapshot messages. GET returns the
// last 100 messages of a chat; POST persists a message and returns it in the
// same {id, fromId, from, text, at} shape the client state expects. The
// client then broadcasts the returned message over Agora RTM so the other
// member(s) see it in real time.
// ---------------------------------------------------------------------------

function timeStr(d: Date): string {
  return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function assertMember(chatId: string, userId: string) {
  return db.chatMember.findFirst({ where: { chatId, userId } });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const chatId = request.nextUrl.searchParams.get("chatId");
    if (!chatId) {
      return NextResponse.json({ error: "Missing chatId" }, { status: 400 });
    }
    if (!(await assertMember(chatId, auth.userId))) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const messages = await db.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: { sender: { select: { name: true } } },
    });

    return NextResponse.json(
      messages.map((m) => ({
        id: m.id,
        fromId: m.senderId,
        from: m.sender?.name ?? "Unknown",
        text: m.text,
        at: timeStr(m.createdAt),
      })),
    );
  } catch (error) {
    console.error("Get chat messages error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    const body = await request.json().catch(() => ({}));
    const chatId = String(body.chatId ?? "");
    const text = String(body.text ?? "").slice(0, 2000);
    if (!chatId || !text) {
      return NextResponse.json({ error: "Missing chatId or text" }, { status: 400 });
    }

    const chat = await db.chat.findUnique({
      where: { id: chatId },
      include: { members: { select: { userId: true } } },
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    if (!chat.isGroup && !(await assertMember(chatId, auth.userId))) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const [me, msg] = await Promise.all([
      db.user.findUnique({ where: { id: auth.userId }, select: { name: true } }),
      db.message.create({ data: { chatId, senderId: auth.userId, text } }),
    ]);

    const messagePayload = {
      id: msg.id,
      fromId: auth.userId,
      from: me?.name ?? "Unknown",
      text: msg.text,
      at: timeStr(msg.createdAt),
    };

    return NextResponse.json({
      message: messagePayload,
      chat: {
        id: chat.id,
        name: chat.name,
        group: chat.isGroup,
        last: messagePayload.text,
        time: messagePayload.at,
        memberIds: chat.members.map((x) => x.userId),
      },
    });
  } catch (error) {
    console.error("Send chat message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
