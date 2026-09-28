import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, isNextResponse } from "@/lib/session";

// ---------------------------------------------------------------------------
// GET /api/chats — the signed-in user's chat list (DMs + the lobby group).
// Replaces the old WS service snapshot. Also self-heals the "lobby" group
// chat membership for every user (the WS service did this on hello).
// ---------------------------------------------------------------------------

function timeStr(d: Date): string {
  return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (isNextResponse(auth)) return auth;

    // Ensure the shared lobby group chat exists and the caller is a member.
    await db.chat.upsert({
      where: { id: "lobby" },
      update: {},
      create: { id: "lobby", name: "Valentine Lobby", isGroup: true },
    });
    await db.chatMember.upsert({
      where: { chatId_userId: { chatId: "lobby", userId: auth.userId } },
      update: {},
      create: { chatId: "lobby", userId: auth.userId },
    });

    const memberships = await db.chatMember.findMany({
      where: { userId: auth.userId },
      include: {
        chat: {
          include: {
            members: { select: { userId: true } },
            messages: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
    });

    const chats = memberships
      .map((m) => {
        const chat = m.chat;
        const lastMsg = chat.messages[0];
        return {
          id: chat.id,
          name: chat.name,
          group: chat.isGroup,
          last: lastMsg?.text ?? "Direct message",
          time: lastMsg ? timeStr(lastMsg.createdAt) : "",
          memberIds: chat.members.map((x) => x.userId),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    return NextResponse.json(chats);
  } catch (error) {
    console.error("List chats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
