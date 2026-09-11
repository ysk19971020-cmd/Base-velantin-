// ---------------------------------------------------------------------------
// AppRoom — the single global Durable Object instance holding all realtime
// state: connected users, active live streams, live comments. This mirrors
// the old ws-service's single-Node-process-holds-everything-in-memory model
// as closely as possible.
//
// Deliberately uses the NON-hibernating WebSocket API (`server.accept()`)
// rather than the Hibernation API. Hibernation would let Cloudflare evict
// this object from memory during idle periods to save cost, but our state
// (connected users, live rooms) lives in plain JS fields — hibernation
// would silently wipe it unless that state were rewritten to persist to
// `ctx.storage` and be reconstructed on wake. For a personal-scale app,
// staying pinned in memory while any WebSocket is open is simpler and
// should comfortably fit inside the free tier. Revisit if traffic grows.
//
// Message protocol: every WebSocket message is `{ event: string, data: any }`
// JSON — matching the shim in src/lib/socket.ts on the frontend, so
// page.tsx's existing `.on(event, cb)` / `.emit(event, data)` calls don't
// need to change at all.
// ---------------------------------------------------------------------------

import { verifySessionToken } from './session';
import { getGiftById, coinsToDiamonds } from './gifts';
import { createDb, type Db, type DbChat, type DbMessage } from './db';

export interface Env {
  APP_ROOM: DurableObjectNamespace;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  FRONTEND_URL?: string;
  PLATFORM_FEE_RATE?: string;
}

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

export class AppRoom implements DurableObject {
  env: Env;
  db: Db;
  platformFeeRate: number;

  sessions = new Map<WebSocket, ClientUser>();
  usersById = new Map<string, { user: ClientUser; ws: WebSocket }>();
  lives = new Map<string, InMemoryLive>();

  constructor(_state: DurableObjectState, env: Env) {
    this.env = env;
    this.db = createDb(env.DATABASE_URL);
    this.platformFeeRate = parseFloat(env.PLATFORM_FEE_RATE ?? '0.30');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    const origin = request.headers.get('Origin');
    const allowed = this.env.FRONTEND_URL
      ? this.env.FRONTEND_URL.split(',').map((s) => s.trim())
      : null;
    if (allowed && origin && !allowed.includes(origin)) {
      return new Response('Origin not allowed', { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    server.addEventListener('message', (event) => {
      this.handleMessage(server, event.data as string).catch((err) => {
        console.error('[AppRoom] message error:', err);
      });
    });
    server.addEventListener('close', () => {
      this.handleClose(server).catch((err) => console.error('[AppRoom] close error:', err));
    });
    server.addEventListener('error', () => {
      this.handleClose(server).catch(() => {});
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── low-level send helpers ────────────────────────────────────────────
  send(ws: WebSocket, event: string, data: unknown) {
    try {
      ws.send(JSON.stringify({ event, data }));
    } catch {
      /* socket likely closed mid-send — ignore */
    }
  }

  broadcastAll(event: string, data: unknown) {
    for (const ws of this.sessions.keys()) this.send(ws, event, data);
  }

  sendToUser(userId: string, event: string, data: unknown) {
    const entry = this.usersById.get(userId);
    if (entry) this.send(entry.ws, event, data);
  }

  // ── dispatch ───────────────────────────────────────────────────────────
  async handleMessage(ws: WebSocket, raw: string) {
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
      case 'hello': return this.onHello(ws, data);
      case 'health': return this.send(ws, 'health', { ok: true, users: this.usersById.size, lives: this.lives.size });
      case 'dm_open': return this.onDmOpen(ws, data);
      case 'chat_send': return this.onChatSend(ws, data);
      case 'live_start': return this.onLiveStart(ws, data);
      case 'live_join': return this.onLiveJoin(ws, data);
      case 'live_leave': return this.onLiveLeave(ws, data);
      case 'live_end': return this.onLiveEnd(ws, data);
      case 'live_comment': return this.onLiveComment(ws, data);
      case 'live_gift': return this.onLiveGift(ws, data);
      case 'rtc_offer': return this.onRtcRelay(ws, 'rtc_offer', data);
      case 'rtc_answer': return this.onRtcRelay(ws, 'rtc_answer', data);
      case 'rtc_ice': return this.onRtcRelay(ws, 'rtc_ice', data);
      default:
        return;
    }
  }

  async handleClose(ws: WebSocket) {
    const me = this.sessions.get(ws);
    if (!me) return;

    this.sessions.delete(ws);
    const entry = this.usersById.get(me.id);
    if (entry && entry.ws === ws) this.usersById.delete(me.id);

    for (const [id, live] of this.lives) {
      if (live.hostId === me.id) {
        this.lives.delete(id);
        this.broadcastAll('live_ended', { liveId: id });
        this.db.endLiveStream(id).catch(() => {});
      } else {
        live.viewers.delete(me.id);
      }
    }

    this.broadcastAll('lives', { lives: [...this.lives.values()].map(livePublic) });
    this.broadcastAll('presence', { users: [...this.usersById.values()].map((e) => publicUser(e.user)) });
  }

  // ── hello ──────────────────────────────────────────────────────────────
  async onHello(ws: WebSocket, data: { token?: string }) {
    try {
      const userId = data?.token ? await verifySessionToken(data.token, this.env.BETTER_AUTH_SECRET) : null;
      if (!userId) {
        this.send(ws, 'error', { error: 'Authentication required' });
        ws.close();
        return;
      }

      const dbUser = await this.db.getUserById(userId);
      if (!dbUser) {
        this.send(ws, 'error', { error: 'User not found' });
        ws.close();
        return;
      }

      const user: ClientUser = { id: dbUser.id, name: dbUser.name, email: dbUser.email };

      // If this userId already has a different open socket, close the old one.
      const existing = this.usersById.get(user.id);
      if (existing && existing.ws !== ws) {
        this.sessions.delete(existing.ws);
        try { existing.ws.close(); } catch { /* ignore */ }
      }

      this.sessions.set(ws, user);
      this.usersById.set(user.id, { user, ws });

      await this.db.ensureLobbyChat();
      const isLobbyMember = await this.db.findChatMember('lobby', user.id);
      if (!isLobbyMember) await this.db.addChatMember('lobby', user.id);

      const snap = await this.snapshotFor(user);
      this.send(ws, 'snapshot', snap);

      this.broadcastAll('presence', { users: [...this.usersById.values()].map((e) => publicUser(e.user)) });
    } catch (err) {
      console.error('[AppRoom] hello error:', err);
      this.send(ws, 'error', { error: 'Internal server error' });
    }
  }

  // ── snapshot ───────────────────────────────────────────────────────────
  async snapshotFor(user: ClientUser) {
    const chatIds = await this.db.getChatIdsForUser(user.id);

    const chatData: Array<{ chat: DbChat; memberIds: string[]; msgs: DbMessage[] }> = [];
    const senderIds = new Set<string>();

    for (const chatId of chatIds) {
      const chat = await this.db.findChat(chatId);
      if (!chat) continue;
      const memberIds = await this.db.getChatMemberIds(chatId);
      const msgs = await this.db.getRecentMessages(chatId, 100);
      for (const m of msgs) if (m.senderId !== 'system') senderIds.add(m.senderId);
      chatData.push({ chat, memberIds, msgs });
    }

    const senderMap = new Map<string, string>();
    for (const uid of senderIds) {
      const entry = this.usersById.get(uid);
      if (entry) senderMap.set(uid, entry.user.name);
    }
    const remaining = [...senderIds].filter((id) => !senderMap.has(id));
    if (remaining.length > 0) {
      const dbUsers = await this.db.getUsersByIds(remaining);
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

    const livesList = [...this.lives.values()].map(livePublic);
    const comments: Record<string, Array<{ user: string; text: string }>> = {};
    for (const l of this.lives.values()) comments[l.id] = l.comments;

    const statuses = await this.db.getRecentStatuses(50);

    return {
      me: publicUser(user),
      users: [...this.usersById.values()].map((e) => publicUser(e.user)),
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

  // ── dm_open ────────────────────────────────────────────────────────────
  async onDmOpen(ws: WebSocket, data: { peerId?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.peerId) return;
    const peerEntry = this.usersById.get(data.peerId);
    if (!peerEntry) return;
    const peer = peerEntry.user;

    try {
      const chatId = dmId(me.id, peer.id);
      const existing = await this.db.findChat(chatId);
      if (!existing) {
        await this.db.createDmChat(chatId, `${me.name} × ${peer.name}`, me.id, peer.id);
      }

      const mySnap = await this.snapshotFor(me);
      this.send(ws, 'snapshot', mySnap);

      const peerSnap = await this.snapshotFor(peer);
      this.send(peerEntry.ws, 'snapshot', peerSnap);

      this.send(ws, 'open_chat', { chatId });
    } catch (err) {
      console.error('[AppRoom] dm_open error:', err);
    }
  }

  // ── chat_send ──────────────────────────────────────────────────────────
  async onChatSend(ws: WebSocket, data: { chatId?: string; text?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.chatId) return;
    const text = String(data.text || '').slice(0, 2000);
    if (!text) return;

    try {
      const chat = await this.db.findChat(data.chatId);
      if (!chat) return;
      const memberIds = await this.db.getChatMemberIds(chat.id);
      if (!chat.isGroup && !memberIds.includes(me.id)) return;

      const msg = await this.db.createMessage(chat.id, me.id, text);

      const msgPayload = { id: msg.id, fromId: me.id, from: me.name, text: msg.text, at: timeStr(msg.createdAt) };
      const chatPayload = {
        id: chat.id, name: chat.name, group: chat.isGroup,
        last: msgPayload.text, time: msgPayload.at, memberIds,
      };
      const eventData = { chatId: chat.id, message: msgPayload, chat: chatPayload };

      if (chat.isGroup) {
        this.broadcastAll('chat_msg', eventData);
      } else {
        for (const memberId of memberIds) this.sendToUser(memberId, 'chat_msg', eventData);
      }
    } catch (err) {
      console.error('[AppRoom] chat_send error:', err);
    }
  }

  // ── live_start ─────────────────────────────────────────────────────────
  async onLiveStart(ws: WebSocket, data: { title?: string }) {
    const me = this.sessions.get(ws);
    if (!me) return;

    for (const [id, l] of this.lives) {
      if (l.hostId === me.id) {
        this.lives.delete(id);
        this.db.endLiveStream(id).catch(() => {});
      }
    }

    const liveId = `live_${Math.random().toString(36).slice(2, 10)}`;
    const title = String(data.title || `${me.name} live`).slice(0, 80);

    const live: InMemoryLive = {
      id: liveId, hostId: me.id, hostName: me.name, title,
      viewers: new Set([me.id]), comments: [],
    };
    this.lives.set(liveId, live);

    this.db.createLiveStream(liveId, me.id, title).catch((err) => console.error('[AppRoom] live_start db error:', err));

    this.broadcastAll('lives', { lives: [...this.lives.values()].map(livePublic) });
    this.send(ws, 'live_started', { live: livePublic(live) });
  }

  // ── live_join ──────────────────────────────────────────────────────────
  async onLiveJoin(ws: WebSocket, data: { liveId?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.liveId) return;

    const live = this.lives.get(data.liveId);
    if (!live) {
      this.send(ws, 'error', { error: 'Live ended' });
      return;
    }

    live.viewers.add(me.id);
    live.comments.push({ user: me.name, text: 'joined' });

    this.broadcastAll('live_state', { live: livePublic(live), comments: live.comments.slice(-40) });

    if (live.hostId !== me.id) {
      this.sendToUser(live.hostId, 'rtc_need_offer', { liveId: live.id, viewerId: me.id, viewerName: me.name });
    }
  }

  // ── live_leave ─────────────────────────────────────────────────────────
  async onLiveLeave(ws: WebSocket, data: { liveId?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.liveId) return;
    const live = this.lives.get(data.liveId);
    if (!live) return;

    live.viewers.delete(me.id);
    this.broadcastAll('live_state', { live: livePublic(live), comments: live.comments.slice(-40) });
    this.sendToUser(live.hostId, 'rtc_viewer_left', { liveId: live.id, viewerId: me.id });
  }

  // ── live_end ───────────────────────────────────────────────────────────
  async onLiveEnd(ws: WebSocket, data: { liveId?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.liveId) return;
    const live = this.lives.get(data.liveId);
    if (!live || live.hostId !== me.id) return;

    this.lives.delete(data.liveId);
    try { await this.db.endLiveStream(data.liveId); } catch (err) { console.error('[AppRoom] live_end db error:', err); }

    this.broadcastAll('live_ended', { liveId: data.liveId });
    this.broadcastAll('lives', { lives: [...this.lives.values()].map(livePublic) });
  }

  // ── live_comment ───────────────────────────────────────────────────────
  async onLiveComment(ws: WebSocket, data: { liveId?: string; text?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.liveId) return;
    const live = this.lives.get(data.liveId);
    if (!live) return;

    const text = String(data.text || '').slice(0, 240);
    if (!text) return;

    live.comments.push({ user: me.name, text });
    this.db.createLiveComment(data.liveId, me.id, me.name, text).catch((err) => console.error('[AppRoom] live_comment db error:', err));

    this.broadcastAll('live_state', { live: livePublic(live), comments: live.comments.slice(-40) });
  }

  // ── live_gift ──────────────────────────────────────────────────────────
  async onLiveGift(ws: WebSocket, data: { liveId?: string; giftId?: string }) {
    const me = this.sessions.get(ws);
    if (!me || !data.liveId) return;
    const live = this.lives.get(data.liveId);
    if (!live) return;

    const gift = data.giftId ? getGiftById(data.giftId) : undefined;
    if (!gift) {
      this.send(ws, 'error', { error: 'Unknown gift' });
      return;
    }
    const coins = gift.coins;
    const diamonds = coinsToDiamonds(coins, this.platformFeeRate);

    if (live.hostId === me.id) {
      this.send(ws, 'error', { error: 'Cannot send a gift to your own stream' });
      return;
    }

    try {
      const senderWallet = await this.db.findWallet(me.id);
      if (!senderWallet || senderWallet.coins < coins) {
        this.send(ws, 'error', { error: 'Insufficient coins' });
        return;
      }

      await this.db.decrementWalletCoins(me.id, coins);
      await this.db.addDiamondsToWallet(live.hostId, diamonds);
      await this.db.createLiveGift(data.liveId, me.id, me.name, gift.name, coins, diamonds);

      live.comments.push({ user: me.name, text: `sent ${gift.name}` });
      this.broadcastAll('live_state', {
        live: livePublic(live),
        comments: live.comments.slice(-40),
        gift: { from: me.name, name: gift.name },
      });
    } catch (err) {
      console.error('[AppRoom] live_gift error:', err);
      this.send(ws, 'error', { error: 'Gift failed' });
    }
  }

  // ── RTC signaling relay ───────────────────────────────────────────────
  onRtcRelay(ws: WebSocket, event: string, data: { to?: string; [k: string]: unknown }) {
    const me = this.sessions.get(ws);
    if (!me || !data.to) return;
    this.sendToUser(data.to, event, { ...data, from: me.id });
  }
}
