// ---------------------------------------------------------------------------
// Agora realtime layer (Signaling / RTM v2)
// ---------------------------------------------------------------------------
// Replaces the old node-ws WebSocket service. Agora RTM carries chat
// messages, live comments, gift flashes, presence (online users, viewer
// counts) and live lifecycle broadcasts — all peer-to-cloud, so nothing here
// needs a persistent server (Vercel-friendly). History and economy actions
// go through Next.js API routes; this module only handles ephemeral realtime.
//
// Requires AGORA_APP_ID + AGORA_APP_CERTIFICATE (see /api/agora/token).
// Until they are set, login() throws and the UI degrades gracefully.
// ---------------------------------------------------------------------------

import AgoraRTM from 'agora-rtm-sdk'

type MessageListener = (channel: string, publisher: string, message: string) => void
type PresenceListener = (channel: string, userIds: string[]) => void

export const LOBBY_CHANNEL = 'lobby'

/** RTM channel for a chat — chat ids may contain ':' (dm:<a>:<b>), which is
 *  not safe in channel names, so sanitize to dashes. Deterministic so both
 *  DM members derive the same channel. */
export function chatChannel(chatId: string): string {
  return `chat-${chatId.replace(/[^a-zA-Z0-9-]/g, '-')}`
}

/** RTM channel for a live stream (comments, gifts, viewer presence). */
export function liveChannel(liveId: string): string {
  return `live-${liveId.replace(/[^a-zA-Z0-9-]/g, '-')}`
}

class AgoraRealtime {
  private rtm: any = null
  private userId = ''
  private fetchCreds: (() => Promise<{ appId: string; token: string }>) | null = null
  private members = new Map<string, Set<string>>()
  private messageListeners = new Set<MessageListener>()
  private presenceListeners = new Set<PresenceListener>()

  get connected(): boolean {
    return !!this.rtm
  }

  async login(userId: string, fetchCreds: () => Promise<{ appId: string; token: string }>): Promise<void> {
    if (this.rtm) return
    this.userId = userId
    this.fetchCreds = fetchCreds

    const { RTM } = AgoraRTM as any
    const creds = await fetchCreds()
    const rtm = new RTM(creds.appId, userId)

    rtm.addEventListener('message', (event: any) => {
      if (!event) return
      const channel = event.channelName
      const publisher = event.publisher
      let message = ''
      if (typeof event.message === 'string') message = event.message
      else if (event.message?.message) message = String(event.message.message)
      this.messageListeners.forEach(fn => fn(channel, publisher, message))
    })

    rtm.addEventListener('presence', (event: any) => {
      if (!event) return
      const channel = event.channelName
      const set = this.members.get(channel) ?? new Set<string>()
      const type = event.eventType ?? event.type
      try {
        if (type === 'SNAPSHOT') {
          const snapshot = Array.isArray(event.snapshot) ? event.snapshot : []
          const ids = snapshot
            .map((u: any) => (typeof u === 'string' ? u : u?.userId))
            .filter(Boolean)
          set.clear()
          ids.forEach((id: string) => set.add(id))
          set.add(this.userId)
        } else if (type === 'JOIN') {
          set.add(event.publisher)
        } else if (type === 'LEAVE' || type === 'TIMEOUT') {
          set.delete(event.publisher)
        } else if (type === 'INTERVAL') {
          const joined: string[] = event.join?.userIds ?? []
          const left: string[] = event.leave?.userIds ?? []
          joined.forEach(id => set.add(id))
          left.forEach(id => set.delete(id))
        }
      } catch { /* unknown payload shape — keep last known member list */ }
      this.members.set(channel, set)
      this.presenceListeners.forEach(fn => fn(channel, Array.from(set)))
    })

    rtm.addEventListener('tokenPrivilegeWillExpire', async () => {
      try {
        const fresh = await this.fetchCreds?.()
        if (fresh?.token) await rtm.renew(fresh.token)
      } catch { /* renewal failure — connection drops and the UI reconnects */ }
    })

    await rtm.login({ token: creds.token })
    this.rtm = rtm
  }

  async subscribe(channel: string, withPresence = true): Promise<void> {
    if (!this.rtm) return
    try {
      await this.rtm.subscribe(channel, {
        withMessage: true,
        withPresence: withPresence,
        withMetadata: false,
        withLock: false,
        withTopic: false,
      })
      if (!this.members.has(channel)) this.members.set(channel, new Set())
    } catch { /* already subscribed / not logged in — ignore */ }
  }

  async unsubscribe(channel: string): Promise<void> {
    this.members.delete(channel)
    try { await this.rtm?.unsubscribe(channel) } catch { /* ignore */ }
  }

  async publish(channel: string, message: string): Promise<void> {
    if (!this.rtm) return
    try { await this.rtm.publish(channel, message) } catch { /* ignore */ }
  }

  /** Members of a channel from the locally tracked presence list, falling
   *  back to an RTM presence query (whoNow) for channels we aren't
   *  subscribed to — used for viewer counts on the lives list. */
  async presentUsers(channel: string): Promise<string[]> {
    const local = this.members.get(channel)
    if (local && local.size > 0) return Array.from(local)
    if (!this.rtm) return []
    try {
      const res = await this.rtm.presence.whoNow(channel, 'MESSAGE')
      const list: any = res?.userIds ?? res ?? []
      return (Array.isArray(list) ? list : [])
        .map((u: any) => (typeof u === 'string' ? u : u?.userId))
        .filter(Boolean)
    } catch {
      return []
    }
  }

  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn)
    return () => { this.messageListeners.delete(fn) }
  }

  onPresence(fn: PresenceListener): () => void {
    this.presenceListeners.add(fn)
    return () => { this.presenceListeners.delete(fn) }
  }

  async logout(): Promise<void> {
    const rtm = this.rtm
    this.rtm = null
    this.members.clear()
    try { await rtm?.logout() } catch { /* ignore */ }
  }
}

// Singleton — one RTM connection per browser tab.
let instance: AgoraRealtime | null = null

export function getRealtime(): AgoraRealtime {
  if (!instance) instance = new AgoraRealtime()
  return instance
}
