// ---------------------------------------------------------------------------
// Valentine Express — local Node realtime service
//
// Faithful port of mini-services/cloudflare-ws/src/AppRoom.ts (the protocol
// the frontend shim in src/lib/socket.ts speaks): raw WebSocket at /connect,
// `{ event, data }` JSON envelope, identical events and payloads. Runs
// against the same Postgres database via plain `pg`, so the realtime layer
// (chat / live / gifts / WebRTC signaling) works outside Cloudflare.
//
// Env:
//   DATABASE_URL       — same Postgres as the Next.js app
//   BETTER_AUTH_SECRET — must match the Next.js app's exact value
//   PORT               — default 3001
//   FRONTEND_URL       — optional comma-separated origin allowlist
//   PLATFORM_FEE_RATE  — default 0.30
// ---------------------------------------------------------------------------

import { createServer, type IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifySessionToken } from './session';
import { getGiftById, coinsToDiamonds } from './gifts';
import { createDb, type Db, type DbChat, type DbMessage } from './db';
import { notifySubscribersOfLive } from './email';

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10);
const DATABASE_URL = process.env.DATABASE_URL;
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

if (!DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET === 'change-me-to-a-long-random-string') {
  throw new Error('BETTER_AUTH_SECRET must be the same real value the Next.js app uses.');
}

const db: Db = createDb(DATABASE_URL);
const platformFeeRate = parseFloat(process.env.PLATFORM_FEE_RATE ?? '0.30');

// Restrict to the frontend's origin in production via FRONTEND_URL
// (comma-separated list supported). Falls back to allowing all for
// local/dev convenience — same behavior as AppRoom.
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim())
  : null;

// ─── Types ──────────────────────────────────────────────────────────────────
interface ClientUser {
  id: string;
  name: string;
  email: string;
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
/** socket → user info */
const sessions = new Map<WebSocket, ClientUser>();
/** userId → { user, ws } (latest socket) */
const usersById = new Map<string, { user: ClientUser; ws: WebSocket }>();
/** liveId → in-memory live room */
const lives = new Map<string, InMemoryLive>();

// ─── Helpers ────────────────────────────────────────────────────────────────
function nowStr(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeStr(d: Date): string {
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function publicUser(u: ClientUser) {
  return { id: u.id, name: u.name, email: u.email };
}

function livePublic(l: InMemoryLive) {
  return { id: l.id, hostId: l.hostId, host: l.hostName, title: l.title, viewers: l.viewers.size };
}

function dmId(a: string, b: string): string {
  return ['dm', ...[a, b].sort()].join(':');
}

// ─── low-level send helpers ────────────────────────────────────────────────
function send(ws: WebSocket, event: string, data: unknown) {
  try {
    ws.send(JSON.stringify({ event, data }));
  } catch {
    /* socket likely closed mid-send — ignore */
  }
}

function broadcastAll(event: string, data: unknown) {
  for (const ws of sessions.keys()) send(ws, event, data);
}

function sendToUser(userId: string, event: string, data: unknown) {
  const entry = usersById.get(userId);
  if (entry) send(entry.ws, event, data);
}

// ─── dispatch ───────────────────────────────────────────────────────────────
async function handleMessage(ws: WebSocket, raw: string) {
  let msg: { event?: string; data?: any };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const event = msg.event;
  const data = msg.data ?? {};
  if (!event) return;

  switch (event) {
    case 'hello': return onHello(ws, data);
    case 'health': return send(ws, 'health', { ok: true, users: usersById.size, lives: lives.size });
    case 'dm_open': return onDmOpen(ws, data);
    case 'chat_send': return onChatSend(ws, data);
    case 'live_start': return onLiveStart(ws, data);
    case 'live_join': return onLiveJoin(ws, data);
    case 'live_leave': return onLiveLeave(ws, data);
    case 'live_end': return onLiveEnd(ws, data);
    case 'live_comment': return onLiveComment(ws, data);
    case 'live_gift': return onLiveGift(ws, data);
    case 'rtc_offer': return onRtcRelay(ws, 'rtc_offer', data);
    case 'rtc_answer': return onRtcRelay(ws, 'rtc_answer', data);
    case 'rtc_ice': return onRtcRelay(ws, 'rtc_ice', data);
    default:
      return;
  }
}

async function handleClose(ws: WebSocket) {
  const me = sessions.get(ws);
  if (!me) return;

  sessions.delete(ws);
  const entry = usersById.get(me.id);
  if (entry && entry.ws === ws) usersById.delete(me.id);

  for (const [id, live] of lives) {
    if (live.hostId === me.id) {
      lives.delete(id);
      broadcastAll('live_ended', { liveId: id });
      db.endLiveStream(id).catch(() => {});
    } else {
      live.viewers.delete(me.id);
    }
  }

  broadcastAll('lives', { lives: [...lives.values()].map(livePublic) });
  broadcastAll('presence', { users: [...usersById.values()].map((e) => publicUser(e.user)) });
}

// ─── hello ──────────────────────────────────────────────────────────────────
async function onHello(ws: WebSocket, data: { token?: string }) {
  try {
    const userId = data?.token ? await verifySessionToken(data.token, BETTER_AUTH_SECRET!) : null;
    if (!userId) {
      send(ws, 'error', { error: 'Authentication required' });
      ws.close();
      return;
    }

    const dbUser = await db.getUserById(userId);
    if (!dbUser) {
      send(ws, 'error', { error: 'User not found' });
      ws.close();
      return;
    }

    const user: ClientUser = { id: dbUser.id, name: dbUser.name, email: dbUser.email };

    // If this userId already has a different open socket, close the old one.
    const existing = usersById.get(user.id);
    if (existing && existing.ws !== ws) {
      sessions.delete(existing.ws);
      try { existing.ws.close(); } catch { /* ignore */ }
    }

    sessions.set(ws, user);
    usersById.set(user.id, { user, ws });

    await db.ensureLobbyChat();
    const isLobbyMember = await db.findChatMember('lobby', user.id);
    if (!isLobbyMember) await db.addChatMember('lobby', user.id);

    const snap = await snapshotFor(user);
    send(ws, 'snapshot', snap);

    broadcastAll('presence', { users: [...usersById.values()].map((e) => publicUser(e.user)) });
  } catch (err) {
    console.error('[ws] hello error:', err);
    send(ws, 'error', { error: 'Internal server error' });
  }
}

// ─── snapshot ───────────────────────────────────────────────────────────────
async function snapshotFor(user: ClientUser) {
  const chatIds = await db.getChatIdsForUser(user.id);

  const chatData: Array<{ chat: DbChat; memberIds: string[]; msgs: DbMessage[] }> = [];
  const senderIds = new Set<string>();

  for (const chatId of chatIds) {
    const chat = await db.findChat(chatId);
    if (!chat) continue;
    const memberIds = await db.getChatMemberIds(chatId);
    const msgs = await db.getRecentMessages(chatId, 100);
    for (const m of msgs) if (m.senderId !== 'system') senderIds.add(m.senderId);
    chatData.push({ chat, memberIds, msgs });
  }

  const senderMap = new Map<string, string>();
  for (const uid of senderIds) {
    const entry = usersById.get(uid);
    if (entry) senderMap.set(uid, entry.user.name);
  }
  const remaining = [...senderIds].filter((id) => !senderMap.has(id));
  if (remaining.length > 0) {
    const dbUsers = await db.getUsersByIds(remaining);
    for (const u of dbUsers) senderMap.set(u.id, u.name);
  }

  const chats: Array<{ id: string; name: string; group: boolean; last: string; time: string; memberIds: string[] }> = [];
  const messages: Record<string, Array<{ id: string; fromId: string; from: string; text: string; at: string }>> = {};

  for (const { chat, memberIds, msgs } of chatData) {
    const mapped = msgs.map((m) => ({
      id: m.id,
      fromId: m.senderId,
      from: m.senderId === 'system' ? 'Express' : senderMap.get(m.senderId) || 'Unknown',
      text: m.text,
      at: timeStr(m.createdAt),
    }));
    const last = mapped[mapped.length - 1];
    chats.push({
      id: chat.id,
      name: chat.name,
      group: chat.isGroup,
      last: last?.text ?? '',
      time: last?.at ?? '',
      memberIds,
    });
    messages[chat.id] = mapped;
  }

  const lobbyMsgs = messages['lobby'];
  if (!lobbyMsgs || lobbyMsgs.length === 0) {
    messages['lobby'] = [{
      id: 'm_welcome',
      fromId: 'system',
      from: 'Express',
      text: 'Welcome to Valentine Express. Chat here, then Go Live.',
      at: nowStr(),
    }];
  }

  const livesList = [...lives.values()].map(livePublic);
  const comments: Record<string, Array<{ user: string; text: string }>> = {};
  for (const l of lives.values()) comments[l.id] = l.comments;

  const statuses = await db.getRecentStatuses(50);

  return {
    me: publicUser(user),
    users: [...usersById.values()].map((e) => publicUser(e.user)),
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

// ─── dm_open ────────────────────────────────────────────────────────────────
async function onDmOpen(ws: WebSocket, data: { peerId?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.peerId) return;
  const peerEntry = usersById.get(data.peerId);
  if (!peerEntry) return;
  const peer = peerEntry.user;

  try {
    const chatId = dmId(me.id, peer.id);
    const existing = await db.findChat(chatId);
    if (!existing) {
      await db.createDmChat(chatId, `${me.name} × ${peer.name}`, me.id, peer.id);
    }

    const mySnap = await snapshotFor(me);
    send(ws, 'snapshot', mySnap);

    const peerSnap = await snapshotFor(peer);
    send(peerEntry.ws, 'snapshot', peerSnap);

    send(ws, 'open_chat', { chatId });
  } catch (err) {
    console.error('[ws] dm_open error:', err);
  }
}

// ─── chat_send ──────────────────────────────────────────────────────────────
async function onChatSend(ws: WebSocket, data: { chatId?: string; text?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.chatId) return;
  const text = String(data.text || '').slice(0, 2000);
  if (!text) return;

  try {
    const chat = await db.findChat(data.chatId);
    if (!chat) return;
    const memberIds = await db.getChatMemberIds(chat.id);
    if (!chat.isGroup && !memberIds.includes(me.id)) return;

    const msg = await db.createMessage(chat.id, me.id, text);

    const msgPayload = { id: msg.id, fromId: me.id, from: me.name, text: msg.text, at: timeStr(msg.createdAt) };
    const chatPayload = {
      id: chat.id, name: chat.name, group: chat.isGroup,
      last: msgPayload.text, time: msgPayload.at, memberIds,
    };
    const eventData = { chatId: chat.id, message: msgPayload, chat: chatPayload };

    if (chat.isGroup) {
      broadcastAll('chat_msg', eventData);
    } else {
      for (const memberId of memberIds) sendToUser(memberId, 'chat_msg', eventData);
    }
  } catch (err) {
    console.error('[ws] chat_send error:', err);
  }
}

// ─── live_start ─────────────────────────────────────────────────────────────
async function onLiveStart(ws: WebSocket, data: { title?: string }) {
  const me = sessions.get(ws);
  if (!me) return;

  for (const [id, l] of lives) {
    if (l.hostId === me.id) {
      lives.delete(id);
      db.endLiveStream(id).catch(() => {});
    }
  }

  const liveId = `live_${Math.random().toString(36).slice(2, 10)}`;
  const title = String(data.title || `${me.name} live`).slice(0, 80);

  const live: InMemoryLive = {
    id: liveId, hostId: me.id, hostName: me.name, title,
    viewers: new Set([me.id]), comments: [],
  };
  lives.set(liveId, live);

  db.createLiveStream(liveId, me.id, title).catch((err) => console.error('[ws] live_start db error:', err));

  // Fire-and-forget email alert to subscribers — never blocks the broadcast.
  notifySubscribersOfLive(db, me.name, title).catch((err) => console.error('[ws] live_start email error:', err));

  broadcastAll('lives', { lives: [...lives.values()].map(livePublic) });
  send(ws, 'live_started', { live: livePublic(live) });
}

// ─── live_join ──────────────────────────────────────────────────────────────
async function onLiveJoin(ws: WebSocket, data: { liveId?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.liveId) return;

  const live = lives.get(data.liveId);
  if (!live) {
    send(ws, 'error', { error: 'Live ended' });
    return;
  }

  live.viewers.add(me.id);
  live.comments.push({ user: me.name, text: 'joined' });

  broadcastAll('live_state', { live: livePublic(live), comments: live.comments.slice(-40) });

  if (live.hostId !== me.id) {
    sendToUser(live.hostId, 'rtc_need_offer', { liveId: live.id, viewerId: me.id, viewerName: me.name });
  }
}

// ─── live_leave ─────────────────────────────────────────────────────────────
async function onLiveLeave(ws: WebSocket, data: { liveId?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.liveId) return;
  const live = lives.get(data.liveId);
  if (!live) return;

  live.viewers.delete(me.id);
  broadcastAll('live_state', { live: livePublic(live), comments: live.comments.slice(-40) });
  sendToUser(live.hostId, 'rtc_viewer_left', { liveId: live.id, viewerId: me.id });
}

// ─── live_end ───────────────────────────────────────────────────────────────
async function onLiveEnd(ws: WebSocket, data: { liveId?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.liveId) return;
  const live = lives.get(data.liveId);
  if (!live || live.hostId !== me.id) return;

  lives.delete(data.liveId);
  try { await db.endLiveStream(data.liveId); } catch (err) { console.error('[ws] live_end db error:', err); }

  broadcastAll('live_ended', { liveId: data.liveId });
  broadcastAll('lives', { lives: [...lives.values()].map(livePublic) });
}

// ─── live_comment ───────────────────────────────────────────────────────────
async function onLiveComment(ws: WebSocket, data: { liveId?: string; text?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.liveId) return;
  const live = lives.get(data.liveId);
  if (!live) return;

  const text = String(data.text || '').slice(0, 240);
  if (!text) return;

  live.comments.push({ user: me.name, text });
  db.createLiveComment(data.liveId, me.id, me.name, text).catch((err) => console.error('[ws] live_comment db error:', err));

  broadcastAll('live_state', { live: livePublic(live), comments: live.comments.slice(-40) });
}

// ─── live_gift ──────────────────────────────────────────────────────────────
async function onLiveGift(ws: WebSocket, data: { liveId?: string; giftId?: string }) {
  const me = sessions.get(ws);
  if (!me || !data.liveId) return;
  const live = lives.get(data.liveId);
  if (!live) return;

  const gift = data.giftId ? getGiftById(data.giftId) : undefined;
  if (!gift) {
    send(ws, 'error', { error: 'Unknown gift' });
    return;
  }
  const coins = gift.coins;
  const diamonds = coinsToDiamonds(coins, platformFeeRate);

  if (live.hostId === me.id) {
    send(ws, 'error', { error: 'Cannot send a gift to your own stream' });
    return;
  }

  try {
    const senderWallet = await db.findWallet(me.id);
    if (!senderWallet || senderWallet.coins < coins) {
      send(ws, 'error', { error: 'Insufficient coins' });
      return;
    }

    await db.decrementWalletCoins(me.id, coins);
    await db.addDiamondsToWallet(live.hostId, diamonds);
    await db.createLiveGift(data.liveId, me.id, me.name, gift.name, coins, diamonds);

    live.comments.push({ user: me.name, text: `sent ${gift.name}` });
    broadcastAll('live_state', {
      live: livePublic(live),
      comments: live.comments.slice(-40),
      gift: { from: me.name, name: gift.name },
    });
  } catch (err) {
    console.error('[ws] live_gift error:', err);
    send(ws, 'error', { error: 'Gift failed' });
  }
}

// ─── RTC signaling relay ───────────────────────────────────────────────────
function onRtcRelay(ws: WebSocket, event: string, data: { to?: string; [k: string]: unknown }) {
  const me = sessions.get(ws);
  if (!me || !data.to) return;
  sendToUser(data.to, event, { ...data, from: me.id });
}

// ─── HTTP + WebSocket server ────────────────────────────────────────────────
const httpServer = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (pathname === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  res.writeHead(404).end('Not found');
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (pathname !== '/connect') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  if (allowedOrigins) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on('message', (data) => {
      handleMessage(ws, data.toString()).catch((err) => {
        console.error('[ws] message error:', err);
      });
    });
    ws.on('close', () => {
      handleClose(ws).catch((err) => console.error('[ws] close error:', err));
    });
    ws.on('error', () => {
      handleClose(ws).catch(() => {});
    });
  });
});

// Protocol-level heartbeat: keeps proxied connections alive and reaps dead ones.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
    else ws.terminate();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[ws] realtime service listening on 0.0.0.0:${PORT}`);
});
