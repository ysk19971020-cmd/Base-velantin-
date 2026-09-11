// ---------------------------------------------------------------------------
// Socket.IO-compatible shim over a raw WebSocket
// ---------------------------------------------------------------------------
// The backend moved from a Node.js Socket.IO server (mini-services/ws-service)
// to a Cloudflare Worker + Durable Object (mini-services/cloudflare-ws) —
// Cloudflare Workers can't run Socket.IO (it needs a Node.js HTTP server to
// attach to). Rather than rewrite every `socket.on(...)`/`socket.emit(...)`
// call throughout src/app/page.tsx, this file provides a drop-in shim that
// implements the same small API surface (`.on`, `.emit`, `.connected`,
// `.disconnect()`) on top of the browser's native WebSocket, using a simple
// `{ event, data }` JSON envelope that matches what AppRoom.ts speaks.
// ---------------------------------------------------------------------------

type Handler = (data: any) => void;

class SocketShim {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Handler[]>();
  private url: string;
  private reconnectDelay = 1000;
  private manuallyDisconnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connected = false;

  constructor(url: string) {
    this.url = url;
    this.open();
  }

  private open() {
    if (this.manuallyDisconnected) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.fire('connect', undefined);
    };
    this.ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.fire('disconnect', undefined);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {
      // onclose fires right after — nothing extra to do here.
    };
    this.ws.onmessage = (event) => {
      let msg: { event?: string; data?: any };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.event) this.fire(msg.event, msg.data);
    };
  }

  private scheduleReconnect() {
    if (this.manuallyDisconnected) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
  }

  private fire(event: string, data: any) {
    for (const h of this.handlers.get(event) || []) {
      try { h(data); } catch (err) { console.error(`[socket] handler error for "${event}":`, err); }
    }
  }

  on(event: string, cb: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(cb);
  }

  emit(event: string, data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }));
    }
  }

  disconnect() {
    this.manuallyDisconnected = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

let socket: SocketShim | null = null;

// NEXT_PUBLIC_WS_URL should be the Worker's base URL, e.g.
// https://valentine-express-ws.<subdomain>.workers.dev — this converts it
// to a wss:// WebSocket URL pointed at the /connect route.
function toWsUrl(base: string): string {
  const httpUrl = base.replace(/\/$/, '');
  const wsUrl = httpUrl.replace(/^http/, 'ws');
  return `${wsUrl}/connect`;
}

export const connectSocket = (): any => {
  if (socket?.connected) return socket;
  if (socket) socket.disconnect();

  const base = process.env.NEXT_PUBLIC_WS_URL;
  if (!base) {
    console.error('[socket] NEXT_PUBLIC_WS_URL is not set — realtime features will not connect.');
  }
  const url = base ? toWsUrl(base) : 'ws://localhost:8787/connect';
  socket = new SocketShim(url);
  return socket;
};

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = (): any => {
  return socket;
};
