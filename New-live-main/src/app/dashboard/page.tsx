'use client'

// ---------------------------------------------------------------------------
// Realtime Dashboard (/dashboard)
// Shows the live data flowing through the socket connection: connection
// status, health stats, presence, active live streams, and a rolling log of
// raw socket events. Connects with the same singleton shim + signed session
// token as the main app, so it reflects exactly what the realtime layer is
// doing right now.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react'
import { connectSocket, disconnectSocket } from '@/lib/socket'
import { getToken } from '@/lib/auth-client'

interface UserInfo { id: string; name: string; email: string }
interface LiveInfo { id: string; hostId: string; host: string; title: string; viewers: number }
interface LogEntry { id: number; time: string; event: string; detail: string }
interface HealthInfo { ok: boolean; users: number; lives: number }

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8787'

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function DashboardPage() {
  const [connected, setConnected] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [users, setUsers] = useState<UserInfo[]>([])
  const [lives, setLives] = useState<LiveInfo[]>([])
  const [chatCount, setChatCount] = useState(0)
  const [messageCount, setMessageCount] = useState(0)
  const [statusCount, setStatusCount] = useState(0)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])

  const logId = useRef(0)
  const pushLog = useCallback((event: string, detail: string) => {
    setLog((l) =>
      [
        { id: ++logId.current, time: new Date().toLocaleTimeString(), event, detail },
        ...l,
      ].slice(0, 60),
    )
  }, [])

  useEffect(() => {
    const s = connectSocket()
    let poll: ReturnType<typeof setInterval> | null = null

    const onConnected = () => {
      setConnected(true)
      pushLog('connect', 'WebSocket connected')
      const token = getToken()
      setHasToken(!!token)
      if (token) s.emit('hello', { token })
      s.emit('health', {})
      if (!poll) poll = setInterval(() => s.emit('health', {}), 5000)
    }

    s.on('connect', onConnected)
    if (s.connected) onConnected()

    s.on('disconnect', () => {
      setConnected(false)
      setAuthed(false)
      pushLog('disconnect', 'WebSocket disconnected — reconnecting…')
    })

    s.on('error', (data: any) => {
      pushLog('error', data?.error ?? JSON.stringify(data).slice(0, 90))
      if (data?.error === 'Authentication required') {
        setAuthed(false)
        pushLog('hello', 'No valid session — login on the main app for full data')
      }
    })

    s.on('health', (data: HealthInfo) => {
      setHealth(data)
      pushLog('health', `${data.users} user${data.users === 1 ? '' : 's'} · ${data.lives} live`)
    })

    s.on('snapshot', (data: any) => {
      setAuthed(true)
      setUsers(data.users ?? [])
      setLives(data.lives ?? [])
      setChatCount((data.chats ?? []).length)
      const msgLists: any[][] = Object.values(data.messages ?? {})
      setMessageCount(msgLists.reduce((n, m) => n + m.length, 0))
      setStatusCount((data.statuses ?? []).length)
      pushLog(
        'snapshot',
        `${(data.users ?? []).length} online · ${(data.lives ?? []).length} live · ${(data.chats ?? []).length} chats`,
      )
    })

    s.on('presence', (data: any) => {
      setUsers(data.users ?? [])
      pushLog('presence', `${(data.users ?? []).length} online`)
    })

    s.on('lives', (data: any) => {
      setLives(data.lives ?? [])
      pushLog('lives', `${(data.lives ?? []).length} active stream${(data.lives ?? []).length === 1 ? '' : 's'}`)
    })

    s.on('live_started', (data: any) => {
      if (data.live) setLives((ls) => [data.live, ...ls.filter((l: LiveInfo) => l.id !== data.live.id)])
      pushLog('live_started', data.live?.title ?? data.live?.id ?? '')
    })

    s.on('live_ended', (data: any) => {
      pushLog('live_ended', data.liveId ?? '')
    })

    s.on('live_state', (data: any) => {
      pushLog('live_state', `${data.live?.host ?? ''} — ${data.live?.viewers ?? 0} watching${data.gift ? ` · gift: ${data.gift.name}` : ''}`)
    })

    s.on('chat_msg', (data: any) => {
      setMessageCount((c) => c + 1)
      pushLog('chat_msg', `${data.message?.from ?? '?'}: ${(data.message?.text ?? '').slice(0, 60)}`)
    })

    return () => {
      if (poll) clearInterval(poll)
      disconnectSocket()
    }
  }, [pushLog])

  const onlineCount = authed ? users.length : health?.users
  const liveCount = authed ? lives.length : health?.lives

  return (
    <main className="ve-app-bg" style={{ minHeight: '100vh', padding: '16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Header */}
        <div className="ve-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="ve-tag" style={{ color: 'var(--ve-rose-2)', letterSpacing: '0.16em', fontSize: 11, textTransform: 'uppercase' }}>
              Valentine Express
            </div>
            <h1 style={{ margin: '4px 0 2px', fontSize: 22 }}>Realtime Dashboard</h1>
            <p style={{ margin: 0, color: 'var(--ve-muted)', fontSize: 12, wordBreak: 'break-all' }}>
              {WS_URL.replace(/^wss?:\/\//, '')}/connect
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="ve-live-dot"
              style={{
                background: connected ? 'var(--ve-ok)' : 'var(--ve-live)',
                boxShadow: connected ? '0 0 0 4px rgba(22,163,74,0.18)' : undefined,
                animation: 'none',
              }}
            />
            <strong style={{ fontSize: 14 }}>{connected ? 'Connected' : 'Connecting…'}</strong>
          </div>
        </div>

        {/* Login hint */}
        {!authed && (
          <div className="ve-panel" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 22 }}>{hasToken ? '⏳' : '🔒'}</span>
            <p style={{ margin: 0, color: 'var(--ve-muted)', fontSize: 13 }}>
              {hasToken
                ? 'Waiting for the realtime session to authenticate…'
                : 'Log in on the main app first — presence, chats and streams need an authenticated session.'}
            </p>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <div className="ve-panel">
            <div style={{ color: 'var(--ve-muted)', fontSize: 12 }}>Online users</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{onlineCount ?? '—'}</div>
          </div>
          <div className="ve-panel">
            <div style={{ color: 'var(--ve-muted)', fontSize: 12 }}>Active live streams</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{liveCount ?? '—'}</div>
          </div>
          <div className="ve-panel">
            <div style={{ color: 'var(--ve-muted)', fontSize: 12 }}>Chat messages</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{authed ? messageCount : '—'}</div>
          </div>
          <div className="ve-panel">
            <div style={{ color: 'var(--ve-muted)', fontSize: 12 }}>Chats / Statuses</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{authed ? `${chatCount} / ${statusCount}` : '—'}</div>
          </div>
        </div>

        {/* Live streams */}
        <div className="ve-panel">
          <h2 style={{ margin: '0 0 10px', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="ve-live-dot" style={{ animation: 'none' }} /> Live now
          </h2>
          {lives.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--ve-muted)', fontSize: 13 }}>
              No active streams. Start one from the app to see it here instantly.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lives.map((l) => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', background: 'var(--ve-surface-2)', borderRadius: 12, padding: '10px 12px' }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{l.title}</strong>
                    <div style={{ color: 'var(--ve-muted)', fontSize: 12 }}>host: {l.host}</div>
                  </div>
                  <span style={{ color: 'var(--ve-live)', fontWeight: 700, fontSize: 13 }}>👀 {l.viewers}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Online users */}
        <div className="ve-panel">
          <h2 style={{ margin: '0 0 10px', fontSize: 15 }}>Online users</h2>
          {users.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--ve-muted)', fontSize: 13 }}>
              {authed ? 'Nobody else is connected right now.' : 'Waiting for an authenticated session…'}
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {users.map((u) => (
                <div key={u.id} style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--ve-surface-2)', borderRadius: 12, padding: '8px 10px' }}>
                  <span className="ve-avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{initials(u.name)}</span>
                  <div>
                    <strong style={{ fontSize: 13, display: 'block' }}>{u.name}</strong>
                    <span style={{ color: 'var(--ve-muted)', fontSize: 11 }}>{u.email}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Socket event log */}
        <div className="ve-panel">
          <h2 style={{ margin: '0 0 10px', fontSize: 15 }}>Socket events</h2>
          {log.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--ve-muted)', fontSize: 13 }}>Waiting for events…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
              {log.map((e) => (
                <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--ve-muted)', flexShrink: 0 }}>{e.time}</span>
                  <strong style={{ color: 'var(--ve-wine)', flexShrink: 0 }}>{e.event}</strong>
                  <span style={{ wordBreak: 'break-word' }}>{e.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', paddingBottom: 16 }}>
          <a className="ve-btn" href="/">← Back to the app</a>
        </div>
      </div>
    </main>
  )
}
