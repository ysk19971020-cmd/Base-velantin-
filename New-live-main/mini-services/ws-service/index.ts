/**
 * Valentine Express — WebSocket Mini-Service
 * Chat + live rooms + WebRTC signaling via socket.io
 * Persists messages, gifts, comments to SQLite via Prisma
 */
import { createServer } from "http";
import { Server } from "socket.io";
import { jwtVerify } from "jose";
import { db } from "./lib/db";
import { getGiftById, coinsToDiamonds } from "./lib/gifts";

// ─── Session verification ──────────────────────────────────────────────────
// Same signed-JWT scheme as the Next.js API routes (src/lib/session.ts).
// The ws-service must verify the token itself rather than trusting a
// client-declared userId — otherwise anyone who has seen another user's id
// anywhere in the app (chat, live gifts, host ids) could connect as them.
function getSecretKey(): Uint8Array {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret === "change-me-to-a-long-random-string") {
    throw new Error(
      "BETTER_AUTH_SECRET is not set to a real value. Set the same secret used by the Next.js app.",
    );
  }
  return new TextEncoder().encode(secret);
}

async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── Types ──────────────────────────────────────────────────────────────────
interface ClientUser {
  id: string;
  name: string;
  email: string;
  socketId: string;
}

interface InMemoryLive {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  viewers: Set<string>;
  comments: Array<{ user: string; text: string }>;
}

// ─── In-Memory State ────────────────────────────────────────────────────────
/** socket.id → user info */
const connectedSockets = new Map<string, ClientUser>();
/** userId → user info (latest socket) */
const connectedUsers = new Map<string, ClientUser>();
/** liveId → in-memory live room */
const lives = new Map<string, InMemoryLive>();

// ─── Helpers ────────────────────────────────────────────────────────────────
function now(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function publicUser(u: ClientUser) {
  return { id: u.id, name: u.name, email: u.email };
}

function livePublic(l: InMemoryLive) {
  return {
    id: l.id,
    hostId: l.hostId,
    host: l.hostName,
    title: l.title,
    viewers: l.viewers.size,
  };
}

function dmId(a: string, b: string) {
  return ["dm", ...[a, b].sort()].join(":");
}

function broadcast(event: string, data: unknown) {
  io.emit(event, data);
}

// ─── Lobby ──────────────────────────────────────────────────────────────────
async function ensureLobby(): Promise<void> {
  const lobby = await db.chat.findUnique({ where: { id: "lobby" } });
  if (!lobby) {
    await db.chat.create({
      data: {
        id: "lobby",
        name: "Valentine Lobby",
        isGroup: true,
      },
    });
  }
}

// ─── Snapshot ───────────────────────────────────────────────────────────────
async function snapshotFor(user: ClientUser) {
  // 1. Chats the user is member of (from DB)
  const memberships = await db.chatMember.findMany({
    where: { userId: user.id },
    include: {
      chat: {
        include: {
          members: true,
          messages: {
            orderBy: { createdAt: "asc" },
            take: 100,
          },
        },
      },
    },
  });

  // Collect unique sender IDs to batch-resolve names
  const senderIds = new Set<string>();
  for (const m of memberships) {
    for (const msg of m.chat.messages) {
      if (msg.senderId !== "system") senderIds.add(msg.senderId);
    }
  }

  // Batch fetch sender names
  const senderMap = new Map<string, string>();
  if (senderIds.size > 0) {
    // First check connected users
    for (const [uid, cu] of connectedUsers) {
      if (senderIds.has(uid)) senderMap.set(uid, cu.name);
    }
    // Then fetch remaining from DB
    const remaining = [...senderIds].filter((id) => !senderMap.has(id));
    if (remaining.length > 0) {
      const dbUsers = await db.user.findMany({
        where: { id: { in: remaining } },
        select: { id: true, name: true },
      });
      for (const u of dbUsers) senderMap.set(u.id, u.name);
    }
  }

  const chats: Array<{
    id: string;
    name: string;
    group: boolean;
    last: string;
    time: string;
    memberIds: string[];
  }> = [];
  const messages: Record<string, Array<{ id: string; fromId: string; from: string; text: string; at: string }>> = {};

  for (const membership of memberships) {
    const chat = membership.chat;

    const msgs = chat.messages.map((m) => ({
      id: m.id,
      fromId: m.senderId,
      from: m.senderId === "system" ? "Express" : (senderMap.get(m.senderId) || "Unknown"),
      text: m.text,
      at: m.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }));

    const last = msgs[msgs.length - 1];
    chats.push({
      id: chat.id,
      name: chat.name,
      group: chat.isGroup,
      last: last?.text ?? "",
      time: last?.at ?? "",
      memberIds: chat.members.map((cm) => cm.userId),
    });
    messages[chat.id] = msgs;
  }

  // If lobby has no messages, inject the welcome message
  const lobbyMsgs = messages["lobby"];
  if (!lobbyMsgs || lobbyMsgs.length === 0) {
    messages["lobby"] = [
      {
        id: "m_welcome",
        fromId: "system",
        from: "Express",
        text: "Welcome to Valentine Express. Chat here, then Go Live.",
        at: now(),
      },
    ];
  }

  // 2. Active live streams (in-memory)
  const livesList = [...lives.values()].map(livePublic);

  // 3. Comments per live
  const comments: Record<string, Array<{ user: string; text: string }>> = {};
  for (const l of lives.values()) {
    comments[l.id] = l.comments;
  }

  // 4. Status updates (last 50)
  const statuses = await db.status.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    type: "snapshot",
    me: publicUser(user),
    users: [...connectedUsers.values()].map(publicUser),
    chats,
    messages,
    lives: livesList,
    comments,
    statuses: statuses.map((s) => ({
      id: s.id,
      userId: s.userId,
      userName: s.userName,
      text: s.text,
      imageUrl: s.imageUrl,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

// ─── HTTP + Socket.IO Server ───────────────────────────────────────────────
const httpServer = createServer();

// Restrict to the deployed frontend's origin in production via
// FRONTEND_URL (comma-separated list supported). Falls back to "*" for
// local/dev convenience.
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((s) => s.trim())
  : "*";

const io = new Server(httpServer, {
  path: "/socket.io",
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Health check is available via socket.io: client emits "health", server responds with callback

// ─── Connection Handler ─────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[ws] connected: ${socket.id}`);

  // ── health (socket.io-based health check) ──────────────────────────────
  socket.on("health", (cb: (data: { ok: boolean; users: number; lives: number }) => void) => {
    if (typeof cb === "function") {
      cb({ ok: true, users: connectedUsers.size, lives: lives.size });
    }
  });

  // ── hello ───────────────────────────────────────────────────────────────
  socket.on(
    "hello",
    async (payload: { token: string }) => {
      try {
        const userId = payload?.token
          ? await verifySessionToken(payload.token)
          : null;

        if (!userId) {
          socket.emit("error", { error: "Authentication required" });
          socket.disconnect();
          return;
        }

        // Validate user exists in the database
        const dbUser = await db.user.findUnique({ where: { id: userId } });
        if (!dbUser) {
          socket.emit("error", { error: "User not found" });
          socket.disconnect();
          return;
        }

        const user: ClientUser = {
          id: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          socketId: socket.id,
        };

        // If this userId already has a different socket, disconnect the old one
        const existing = connectedUsers.get(user.id);
        if (existing && existing.socketId !== socket.id) {
          const oldSocket = io.sockets.sockets.get(existing.socketId);
          if (oldSocket) oldSocket.disconnect(true);
          connectedSockets.delete(existing.socketId);
        }

        connectedSockets.set(socket.id, user);
        connectedUsers.set(user.id, user);

        // Ensure user is a member of the lobby chat
        const lobbyMember = await db.chatMember.findUnique({
          where: { chatId_userId: { chatId: "lobby", userId: user.id } },
        });
        if (!lobbyMember) {
          await db.chatMember.create({
            data: { chatId: "lobby", userId: user.id },
          });
        }

        // Send the full snapshot
        const snap = await snapshotFor(user);
        socket.emit("snapshot", snap);

        // Broadcast updated presence to everyone
        broadcast("presence", {
          users: [...connectedUsers.values()].map(publicUser),
        });

        console.log(`[ws] hello: ${user.name} (${user.id})`);
      } catch (err) {
        console.error("[ws] hello error:", err);
        socket.emit("error", { error: "Internal server error" });
      }
    },
  );

  // ── dm_open ─────────────────────────────────────────────────────────────
  socket.on("dm_open", async (payload: { peerId: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;
    const peer = connectedUsers.get(payload.peerId);
    if (!peer) return;

    try {
      const chatId = dmId(me.id, peer.id);

      // Ensure DM chat exists in DB
      const existing = await db.chat.findUnique({ where: { id: chatId } });
      if (!existing) {
        await db.chat.create({
          data: {
            id: chatId,
            name: `${me.name} × ${peer.name}`,
            isGroup: false,
            members: {
              create: [
                { userId: me.id },
                { userId: peer.id },
              ],
            },
          },
        });
      }

      // Send updated snapshots to both users
      const mySnap = await snapshotFor(me);
      socket.emit("snapshot", mySnap);

      const peerSnap = await snapshotFor(peer);
      io.to(peer.socketId).emit("snapshot", peerSnap);

      // Tell the requester to open this chat
      socket.emit("open_chat", { chatId });
    } catch (err) {
      console.error("[ws] dm_open error:", err);
    }
  });

  // ── chat_send ───────────────────────────────────────────────────────────
  socket.on(
    "chat_send",
    async (payload: { chatId: string; text: string }) => {
      const me = connectedSockets.get(socket.id);
      if (!me) return;
      const text = String(payload.text || "").slice(0, 2000);
      if (!text) return;

      try {
        // Verify chat exists and user is a member
        const chat = await db.chat.findUnique({
          where: { id: payload.chatId },
          include: { members: true },
        });
        if (!chat) return;
        // Non-group chats: only members can send
        if (!chat.isGroup && !chat.members.some((m) => m.userId === me.id)) return;

        // Persist the message to DB
        const msg = await db.message.create({
          data: {
            chatId: chat.id,
            senderId: me.id,
            text,
          },
        });

        const msgPayload = {
          id: msg.id,
          fromId: me.id,
          from: me.name,
          text: msg.text,
          at: msg.createdAt.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };

        const chatPayload = {
          id: chat.id,
          name: chat.name,
          group: chat.isGroup,
          last: msgPayload.text,
          time: msgPayload.at,
          memberIds: chat.members.map((m) => m.userId),
        };

        const eventData = {
          chatId: chat.id,
          message: msgPayload,
          chat: chatPayload,
        };

        if (chat.isGroup) {
          broadcast("chat_msg", eventData);
        } else {
          // DM: only send to chat members
          for (const member of chat.members) {
            const memberUser = connectedUsers.get(member.userId);
            if (memberUser) {
              io.to(memberUser.socketId).emit("chat_msg", eventData);
            }
          }
        }
      } catch (err) {
        console.error("[ws] chat_send error:", err);
      }
    },
  );

  // ── live_start ──────────────────────────────────────────────────────────
  socket.on("live_start", async (payload: { title?: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;

    // End any existing live by this host
    for (const [id, l] of lives) {
      if (l.hostId === me.id) {
        lives.delete(id);
        try {
          await db.liveStream.update({
            where: { id },
            data: { status: "ended", endedAt: new Date() },
          });
        } catch {
          /* ok */
        }
      }
    }

    const liveId = `live_${Math.random().toString(36).slice(2, 10)}`;
    const title = String(payload.title || `${me.name} live`).slice(0, 80);

    const live: InMemoryLive = {
      id: liveId,
      hostId: me.id,
      hostName: me.name,
      title,
      viewers: new Set([me.id]),
      comments: [],
    };
    lives.set(liveId, live);

    // Persist to DB
    try {
      await db.liveStream.create({
        data: {
          id: liveId,
          hostId: me.id,
          title,
          status: "active",
        },
      });
    } catch (err) {
      console.error("[ws] live_start db error:", err);
    }

    broadcast("lives", { lives: [...lives.values()].map(livePublic) });
    socket.emit("live_started", { live: livePublic(live) });
    console.log(`[ws] live_started: ${liveId} by ${me.name}`);
  });

  // ── live_join ───────────────────────────────────────────────────────────
  socket.on("live_join", async (payload: { liveId: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;

    const live = lives.get(payload.liveId);
    if (!live) {
      socket.emit("error", { error: "Live ended" });
      return;
    }

    live.viewers.add(me.id);
    live.comments.push({ user: me.name, text: "joined" });

    broadcast("live_state", {
      live: livePublic(live),
      comments: live.comments.slice(-40),
    });

    // Notify host to send an RTC offer
    if (live.hostId !== me.id) {
      const host = connectedUsers.get(live.hostId);
      if (host) {
        io.to(host.socketId).emit("rtc_need_offer", {
          liveId: live.id,
          viewerId: me.id,
          viewerName: me.name,
        });
      }
    }
  });

  // ── live_leave ──────────────────────────────────────────────────────────
  socket.on("live_leave", async (payload: { liveId: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;

    const live = lives.get(payload.liveId);
    if (!live) return;

    live.viewers.delete(me.id);

    broadcast("live_state", {
      live: livePublic(live),
      comments: live.comments.slice(-40),
    });

    // Notify host that a viewer left
    const host = connectedUsers.get(live.hostId);
    if (host) {
      io.to(host.socketId).emit("rtc_viewer_left", {
        liveId: live.id,
        viewerId: me.id,
      });
    }
  });

  // ── live_end ────────────────────────────────────────────────────────────
  socket.on("live_end", async (payload: { liveId: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;

    const live = lives.get(payload.liveId);
    if (!live || live.hostId !== me.id) return;

    lives.delete(payload.liveId);

    // Persist end to DB
    try {
      await db.liveStream.update({
        where: { id: payload.liveId },
        data: { status: "ended", endedAt: new Date() },
      });
    } catch (err) {
      console.error("[ws] live_end db error:", err);
    }

    broadcast("live_ended", { liveId: payload.liveId });
    broadcast("lives", { lives: [...lives.values()].map(livePublic) });
    console.log(`[ws] live_ended: ${payload.liveId}`);
  });

  // ── live_comment ────────────────────────────────────────────────────────
  socket.on(
    "live_comment",
    async (payload: { liveId: string; text: string }) => {
      const me = connectedSockets.get(socket.id);
      if (!me) return;

      const live = lives.get(payload.liveId);
      if (!live) return;

      const text = String(payload.text || "").slice(0, 240);
      if (!text) return;

      live.comments.push({ user: me.name, text });

      // Persist to DB
      try {
        await db.liveComment.create({
          data: {
            streamId: payload.liveId,
            userId: me.id,
            userName: me.name,
            text,
          },
        });
      } catch (err) {
        console.error("[ws] live_comment db error:", err);
      }

      broadcast("live_state", {
        live: livePublic(live),
        comments: live.comments.slice(-40),
      });
    },
  );

  // ── live_gift ───────────────────────────────────────────────────────────
  socket.on(
    "live_gift",
    async (payload: { liveId: string; giftId: string }) => {
      const me = connectedSockets.get(socket.id);
      if (!me) return;

      const live = lives.get(payload.liveId);
      if (!live) return;

      // Coin cost and diamond payout come ONLY from the server-side catalog —
      // never from the client payload.
      const gift = getGiftById(payload.giftId);
      if (!gift) {
        socket.emit("error", { error: "Unknown gift" });
        return;
      }
      const giftName = gift.name;
      const coins = gift.coins;
      const diamonds = coinsToDiamonds(coins);

      // A host cannot gift themselves diamonds
      if (live.hostId === me.id) {
        socket.emit("error", { error: "Cannot send a gift to your own stream" });
        return;
      }

      try {
        // Check sender has enough coins
        const senderWallet = await db.wallet.findUnique({
          where: { userId: me.id },
        });
        if (!senderWallet || senderWallet.coins < coins) {
          socket.emit("error", { error: "Insufficient coins" });
          return;
        }

        // Deduct coins from sender
        await db.wallet.update({
          where: { userId: me.id },
          data: { coins: { decrement: coins } },
        });

        // Add diamonds to the host's wallet
        await db.wallet.upsert({
          where: { userId: live.hostId },
          create: {
            userId: live.hostId,
            diamonds,
            lifetimeEarned: diamonds,
          },
          update: {
            diamonds: { increment: diamonds },
            lifetimeEarned: { increment: diamonds },
          },
        });

        // Persist the gift record
        await db.liveGift.create({
          data: {
            streamId: payload.liveId,
            senderId: me.id,
            senderName: me.name,
            giftName,
            coins,
            diamonds,
          },
        });

        // Broadcast gift (same format as original server)
        live.comments.push({ user: me.name, text: `sent ${giftName}` });
        broadcast("live_state", {
          live: livePublic(live),
          comments: live.comments.slice(-40),
          gift: { from: me.name, name: giftName },
        });
      } catch (err) {
        console.error("[ws] live_gift error:", err);
        socket.emit("error", { error: "Gift failed" });
      }
    },
  );

  // ── RTC signaling (forward to target user) ─────────────────────────────
  socket.on("rtc_offer", (data: { to: string; sdp?: unknown; liveId?: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;
    const target = connectedUsers.get(data.to);
    if (target) {
      io.to(target.socketId).emit("rtc_offer", { ...data, from: me.id });
    }
  });

  socket.on("rtc_answer", (data: { to: string; sdp?: unknown; liveId?: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;
    const target = connectedUsers.get(data.to);
    if (target) {
      io.to(target.socketId).emit("rtc_answer", { ...data, from: me.id });
    }
  });

  socket.on("rtc_ice", (data: { to: string; candidate?: unknown; liveId?: string }) => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;
    const target = connectedUsers.get(data.to);
    if (target) {
      io.to(target.socketId).emit("rtc_ice", { ...data, from: me.id });
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const me = connectedSockets.get(socket.id);
    if (!me) return;

    connectedSockets.delete(socket.id);
    connectedUsers.delete(me.id);

    // Clean up any lives hosted by this user
    for (const [id, live] of lives) {
      if (live.hostId === me.id) {
        lives.delete(id);
        broadcast("live_ended", { liveId: id });
        // Mark as ended in DB (fire-and-forget)
        db.liveStream
          .update({
            where: { id },
            data: { status: "ended", endedAt: new Date() },
          })
          .catch(() => {});
      } else {
        live.viewers.delete(me.id);
      }
    }

    broadcast("lives", { lives: [...lives.values()].map(livePublic) });
    broadcast("presence", {
      users: [...connectedUsers.values()].map(publicUser),
    });

    console.log(`[ws] disconnected: ${socket.id} (${me.name})`);
  });

  socket.on("error", (err) => {
    console.error(`[ws] socket error (${socket.id}):`, err);
  });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function main() {
  await ensureLobby();

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[ws] Valentine Express WS service on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("[ws] fatal:", err);
  process.exit(1);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
function shutdown(signal: string) {
  console.log(`[ws] received ${signal}, shutting down…`);
  // End all active lives in DB
  for (const [id] of lives) {
    db.liveStream
      .update({
        where: { id },
        data: { status: "ended", endedAt: new Date() },
      })
      .catch(() => {});
  }
  httpServer.close(() => {
    console.log("[ws] server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
