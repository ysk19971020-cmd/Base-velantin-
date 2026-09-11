'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { connectSocket, disconnectSocket } from '@/lib/socket'
import { authFetch, setToken, clearToken, getToken } from '@/lib/auth-client'
import { uploadImageDirect } from '@/lib/cloudinary-client'
import { requestNotificationPermission, listenForForegroundMessages } from '@/lib/push-notifications'
import {
  Home as LucideHome,
  MessageCircle as LucideMessageCircle,
  Radio as LucideRadio,
  Wallet as LucideWallet,
  ShieldCheck as LucideShieldCheck,
  UserRound as LucideUserRound,
  Shield as LucideShield,
  LogOut as LucideLogOut,
} from 'lucide-react'

// ============ TURN SERVER (from env via NEXT_PUBLIC) ============
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(process.env.NEXT_PUBLIC_TURN_URL
      ? [{
          urls: process.env.NEXT_PUBLIC_TURN_URL,
          username: process.env.NEXT_PUBLIC_TURN_USER || '',
          credential: process.env.NEXT_PUBLIC_TURN_PASS || '',
        }]
      : []),
  ],
}

// ============ CONSTANTS ============

const BRAND = { name: 'Valentine Express Live Stream', short: 'Valentine Express', tagline: 'Live. Gift. Connect.' }

const GIFT_CATALOG = [
  { id: 'rose', name: 'Rose', coins: 10, icon: '🌹' },
  { id: 'heart', name: 'Heart', coins: 25, icon: '💖' },
  { id: 'kiss', name: 'Kiss', coins: 40, icon: '💋' },
  { id: 'letter', name: 'Love Letter', coins: 60, icon: '💌' },
  { id: 'bouquet', name: 'Bouquet', coins: 120, icon: '💐' },
  { id: 'teddy', name: 'Teddy Bear', coins: 180, icon: '🧸' },
  { id: 'chocolate', name: 'Chocolate Box', coins: 220, icon: '🍫' },
  { id: 'spotlight', name: 'Spotlight', coins: 300, icon: '✨' },
  { id: 'fireworks', name: 'Fireworks', coins: 500, icon: '🎆' },
  { id: 'ring', name: 'Diamond Ring', coins: 700, icon: '💍' },
  { id: 'crown', name: 'Crown', coins: 900, icon: '👑' },
]

const COIN_PACKS = [
  { id: 'starter', coins: 100, price: 0.99, priceLabel: '$0.99' },
  { id: 'plus', coins: 500, price: 4.99, priceLabel: '$4.99' },
  { id: 'pro', coins: 1200, price: 9.99, priceLabel: '$9.99' },
]

const DIAMONDS_PER_USD = 200
const PLATFORM_FEE = 0.3
const CASHOUT_MIN = 3000

function coinsToDiamonds(coins: number) {
  return Math.max(0, Math.floor(coins * (1 - PLATFORM_FEE)))
}

function diamondsToUsd(diamonds: number) {
  return Math.floor((diamonds / DIAMONDS_PER_USD) * 100) / 100
}

// ============ TYPES ============

type Page = 'landing' | 'register' | 'home' | 'chats' | 'thread' | 'live' | 'liveStage' | 'status' | 'wallet' | 'verify' | 'admin' | 'profile' | 'publicProfile'

type NetUser = { id: string; name: string; email: string }
type NetChat = { id: string; name: string; group: boolean; last: string; time: string; memberIds?: string[] }
type NetMsg = { id: string; fromId?: string; from: string; text: string; at: string }
type NetLive = { id: string; hostId: string; host: string; title: string; viewers: number }
type NetComment = { user: string; text: string }

// ============ AUTH CONTEXT ============

type AuthUser = {
  id: string; name: string; email: string; role: string
  coins: number; diamonds: number; lifetimeEarned: number
  avatarUrl?: string; paypalEmail?: string
  kycStatus: string
  bio?: string; birthday?: string; city?: string; gender?: string; age?: number
}

// ============ COMPONENTS ============

function LandingPage({ onLogin, onGoRegister, wsConnected, wsError }: {
  onLogin: (email: string, password: string) => void
  onGoRegister: () => void
  wsConnected: boolean
  wsError: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required')
      return
    }
    onLogin(email.trim(), password.trim())
  }

  return (
    <div className="ve-hero">
      <form className="ve-hero-card ve-panel" onSubmit={handleSubmit}>
        <img className="ve-logo" src="/icon.jpg" alt="Valentine Express" />
        <div className="ve-tag">{BRAND.tagline}</div>
        <h1>{BRAND.short}</h1>
        <p>Real-time live streaming with gifts, chat, and creator payouts.</p>
        <input className="ve-field" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="ve-field" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        {error && <p className="ve-err" style={{ marginTop: 8 }}>{error}</p>}
        {wsError && <p className="ve-err" style={{ marginTop: 8 }}>{wsError}</p>}
        <button className="ve-btn ve-btn-primary" style={{ width: '100%', marginTop: 14 }} type="submit" disabled={!wsConnected}>
          {wsConnected ? 'Sign in' : 'Connecting to server…'}
        </button>
        <p className="ve-muted" style={{ marginTop: 14 }}>
          Don&apos;t have an account? <button type="button" className="ve-btn-ghost" style={{ color: 'var(--ve-rose-2)' }} onClick={onGoRegister}>Register</button>
        </p>
      </form>
    </div>
  )
}

function RegisterPage({ onRegister, onGoLogin, wsConnected }: {
  onRegister: (name: string, email: string, password: string) => void
  onGoLogin: () => void
  wsConnected: boolean
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError('All fields are required')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    onRegister(name.trim(), email.trim(), password.trim())
  }

  return (
    <div className="ve-hero">
      <form className="ve-hero-card ve-panel" onSubmit={handleSubmit}>
        <img className="ve-logo" src="/icon.jpg" alt="Valentine Express" />
        <h1>Create Account</h1>
        <p className="ve-muted">Join Valentine Express</p>
        <input className="ve-field" placeholder="Display name" value={name} onChange={e => setName(e.target.value)} />
        <input className="ve-field" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="ve-field" type="password" placeholder="Password (6+ chars)" value={password} onChange={e => setPassword(e.target.value)} />
        <input className="ve-field" type="password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} />
        {error && <p className="ve-err" style={{ marginTop: 8 }}>{error}</p>}
        <button className="ve-btn ve-btn-primary" style={{ width: '100%', marginTop: 14 }} type="submit" disabled={!wsConnected}>
          {wsConnected ? 'Create Account' : 'Connecting…'}
        </button>
        <p className="ve-muted" style={{ marginTop: 14 }}>
          Already have an account? <button type="button" className="ve-btn-ghost" style={{ color: 'var(--ve-rose-2)' }} onClick={onGoLogin}>Sign in</button>
        </p>
      </form>
    </div>
  )
}

function Shell({ page, setPage, threadChatId, setThreadChatId, user, setUser, netState, emit, socket, setStatusMsg, onLogout, goToLive, goToProfile, viewingProfile }: {
  page: Page; setPage: (p: Page) => void
  threadChatId: string | null; setThreadChatId: (id: string | null) => void
  user: AuthUser; setUser: (u: AuthUser) => void; netState: NetState; emit: (msg: Record<string, unknown>) => void
  socket: any; setStatusMsg: (m: string) => void; onLogout: () => void
  goToLive: (liveId: string) => void
  goToProfile: (u: { id: string; name: string; avatarUrl: string | null; city: string | null }) => void
  viewingProfile: { id: string; name: string; avatarUrl: string | null; city: string | null } | null
}) {
  const navItems = [
    { to: 'home' as Page, label: 'Home', Icon: LucideHome },
    { to: 'chats' as Page, label: 'Chats', Icon: LucideMessageCircle },
    { to: 'live' as Page, label: 'Live', Icon: LucideRadio },
    { to: 'wallet' as Page, label: 'Wallet', Icon: LucideWallet },
    { to: 'verify' as Page, label: 'Verify', Icon: LucideShieldCheck },
    { to: 'profile' as Page, label: 'Profile', Icon: LucideUserRound },
  ]

  function navTo(p: Page) {
    setThreadChatId(null)
    setPage(p)
  }

  return (
    <div className="ve-shell">
      {/* Rail */}
      <aside className="ve-rail">
        <img className="ve-brand-mark" src="/icon.jpg" alt="Valentine Express" />
        {navItems.map(i => (
          <button
            key={i.to}
            className={`ve-nav-btn${page === i.to ? ' active' : ''}`}
            title={i.label}
            aria-label={i.label}
            onClick={() => navTo(i.to)}
          >
            <i.Icon size={19} strokeWidth={2} />
          </button>
        ))}
        {user.role === 'admin' && (
          <button
            className={`ve-nav-btn${page === 'admin' ? ' active' : ''}`}
            title="Admin"
            aria-label="Admin"
            onClick={() => navTo('admin')}
          >
            <LucideShield size={19} strokeWidth={2} />
          </button>
        )}
        <div style={{ flex: 1 }} />
        <div className="ve-muted" style={{ fontSize: 10, textAlign: 'center' }}>
          {socket?.connected ? `${netState.users.length} online` : 'offline'}
        </div>
        {/* User avatar in rail */}
        <div
          className="ve-rail-avatar"
          title={user.name}
          style={{ backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : undefined }}
          onClick={() => navTo('profile')}
        >
          {user.avatarUrl ? '' : user.name[0]}
        </div>
        <button className="ve-nav-btn ve-logout-btn" title="Sign out" aria-label="Sign out" onClick={onLogout}>
          <LucideLogOut size={18} strokeWidth={2} />
        </button>
      </aside>

      {/* Sidebar (chats) */}
      {(page === 'chats' || page === 'thread') && (
        <aside className="ve-sidebar">
          <div className="ve-side-head">
            <div>
              <h1>Chats</h1>
              <p>{user.name} · {netState.users.length} online</p>
            </div>
          </div>
          <div className="ve-list ve-scroll">
            {netState.chats.map(c => (
              <button
                key={c.id}
                className={`ve-row${threadChatId === c.id ? ' active' : ''}`}
                onClick={() => { setThreadChatId(c.id); setPage('thread') }}
              >
                <div className="ve-avatar">{c.name[0]}</div>
                <div>
                  <strong>{c.name}</strong>
                  <span>{c.last} · {c.time}</span>
                </div>
              </button>
            ))}
            <div style={{ padding: 12 }} className="ve-muted">Online</div>
            {netState.users.filter(u => u.id !== user.id).map(u => (
              <button key={u.id} className="ve-row" onClick={() => emit({ type: 'dm_open', peerId: u.id })}>
                <div className="ve-avatar">{u.name[0]}</div>
                <div>
                  <strong>{u.name}</strong>
                  <span>Direct message</span>
                </div>
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* Main stage */}
      <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {page === 'home' && <HomePage netState={netState} user={user} emit={emit} goToLive={goToLive} goToProfile={goToProfile} />}
        {page === 'publicProfile' && <PublicProfilePage basicUser={viewingProfile} setPage={setPage} emit={emit} />}
        {page === 'chats' && <ChatsPlaceholder />}
        {page === 'thread' && threadChatId && <ThreadPage chatId={threadChatId} netState={netState} emit={emit} user={user} />}
        {page === 'live' && <LivePage netState={netState} emit={emit} user={user} setPage={setPage} setThreadChatId={setThreadChatId} goToLive={goToLive} />}
        {page === 'liveStage' && <LiveStagePage netState={netState} emit={emit} user={user} setPage={setPage} />}
        {page === 'wallet' && <WalletPage user={user} setUser={setStatusMsg} />}
        {page === 'verify' && <VerifyPage user={user} setUser={setStatusMsg} />}
        {page === 'status' && <StatusPage netState={netState} user={user} emit={emit} />}
        {page === 'admin' && user.role === 'admin' && <AdminPage user={user} />}
        {page === 'profile' && <ProfilePage user={user} setUser={setUser} onLogout={onLogout} />}
      </main>

      {/* Mobile tabs */}
      <nav className="ve-mobile-tabs">
        {navItems.map(i => (
          <button key={i.to} className={`ve-mobile-tab${page === i.to ? ' active' : ''}`} aria-label={i.label} onClick={() => navTo(i.to)}>
            <i.Icon size={22} strokeWidth={2} />
          </button>
        ))}
      </nav>
    </div>
  )
}

function ChatsPlaceholder() {
  return (
    <section className="ve-stage">
      <div className="ve-topbar">
        <strong>Valentine Express</strong>
        <span className="ve-muted">Lobby + DMs are shared live</span>
      </div>
      <div style={{ padding: 28 }} className="ve-muted">
        Open Lobby or tap an online user. Messages go through the server to every connected device.
      </div>
    </section>
  )
}

function ThreadPage({ chatId, netState, emit, user }: {
  chatId: string; netState: NetState; emit: (msg: Record<string, unknown>) => void; user: AuthUser
}) {
  const [text, setText] = useState('')
  const chat = netState.chats.find(c => c.id === chatId)
  const messages = netState.messages[chatId] ?? []
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [messages.length])

  if (!chat) {
    return (
      <section className="ve-stage">
        <div className="ve-topbar">Chat not found</div>
      </section>
    )
  }

  return (
    <section className="ve-stage">
      <div className="ve-topbar">
        <div>
          <strong>{chat.name}</strong>
          <div className="ve-muted">{chat.group ? 'Shared room' : 'Direct'}</div>
        </div>
      </div>
      <div className="ve-chat-log ve-scroll" ref={logRef}>
        {messages.map(m => (
          <div key={m.id} className={`ve-bubble${m.fromId === user.id ? ' ve-bubble-me' : ''}`}>
            {chat.group && m.fromId !== user.id && <div className="ve-muted">{m.from}</div>}
            {m.text}
            <div className="ve-muted">{m.at}</div>
          </div>
        ))}
      </div>
      <form className="ve-composer" onSubmit={e => {
        e.preventDefault()
        if (!text.trim()) return
        emit({ type: 'chat_send', chatId: chat.id, text: text.trim() })
        setText('')
      }}>
        <input className="ve-field" style={{ marginTop: 0 }} value={text} onChange={e => setText(e.target.value)} placeholder="Message" />
        <button className="ve-btn ve-btn-primary" type="submit">Send</button>
      </form>
    </section>
  )
}

function HomePage({ netState, user, emit, goToLive, goToProfile }: {
  netState: NetState; user: AuthUser; emit: (msg: Record<string, unknown>) => void
  goToLive: (liveId: string) => void
  goToProfile: (u: { id: string; name: string; avatarUrl: string | null; city: string | null }) => void
}) {
  const [allUsers, setAllUsers] = useState<Array<{ id: string; name: string; avatarUrl: string | null; city: string | null }>>([])
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    authFetch('/api/users').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setAllUsers(data)
    }).catch(() => {})
  }, [])

  const onlineIds = new Set(netState.users.map(u => u.id))
  const liveByHost = new Map(netState.lives.map(l => [l.hostId, l.id]))

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImageDirect(file, 'status')
      setImageUrl(url)
    } catch { /* ignore */ }
    setUploading(false)
  }

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await authFetch('/api/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), imageUrl }),
    }).catch(() => {})
    setText('')
    setImageUrl(null)
  }

  return (
    <section className="ve-stage">
      <div className="ve-topbar">
        <strong>Valentine Express</strong>
        <span className="ve-muted">{netState.users.length} online</span>
      </div>
      <div style={{ padding: 20, display: 'grid', gap: 20 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>People</h3>
          <div className="ve-user-grid">
            {allUsers.map(u => {
              const online = onlineIds.has(u.id)
              const liveId = liveByHost.get(u.id)
              return (
                <button
                  key={u.id}
                  className="ve-user-card"
                  onClick={() => liveId ? goToLive(liveId) : goToProfile(u)}
                >
                  <div className="ve-user-card-avatar" style={{ backgroundImage: u.avatarUrl ? `url(${u.avatarUrl})` : undefined }}>
                    {!u.avatarUrl && u.name[0]}
                    <span className={`ve-presence-dot${online ? ' online' : ''}`} />
                  </div>
                  <strong>{u.name}</strong>
                  {liveId ? <span className="ve-badge" style={{ marginTop: 4 }}><span className="ve-live-dot" /> LIVE</span> : (u.city && <span className="ve-muted">{u.city}</span>)}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 style={{ marginTop: 0 }}>Status updates</h3>
          <form className="ve-panel" onSubmit={handlePost}>
            <input className="ve-field" style={{ marginTop: 0 }} value={text} onChange={e => setText(e.target.value)} placeholder="Share an update" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <input type="file" accept="image/*" onChange={handleImagePick} disabled={uploading} />
              {uploading && <span className="ve-muted">Uploading…</span>}
              {imageUrl && <span className="ve-ok">✓ Image attached</span>}
            </div>
            <button className="ve-btn ve-btn-primary" style={{ marginTop: 10 }} type="submit" disabled={uploading}>Post</button>
          </form>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {netState.statuses.map(s => (
              <div key={s.id} className="ve-panel">
                <strong>{s.userName}</strong>
                <p>{s.text}</p>
                {s.imageUrl && <img src={s.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />}
                <span className="ve-muted">{s.age}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function PublicProfilePage({ basicUser, setPage, emit }: {
  basicUser: { id: string; name: string; avatarUrl: string | null; city: string | null } | null
  setPage: (p: Page) => void
  emit: (msg: Record<string, unknown>) => void
}) {
  const [extra, setExtra] = useState<{ bio?: string | null; gender?: string | null; age?: number | null } | null>(null)

  useEffect(() => {
    if (!basicUser) return
    authFetch(`/api/profile?userId=${basicUser.id}`).then(r => r.ok ? r.json() : null).then(data => {
      if (data?.profile) setExtra(data.profile)
    }).catch(() => {})
  }, [basicUser?.id])

  if (!basicUser) {
    return (
      <section className="ve-stage">
        <div className="ve-topbar">Profile</div>
        <div style={{ padding: 20 }}><button className="ve-btn" onClick={() => setPage('home')}>Back to Home</button></div>
      </section>
    )
  }

  return (
    <section className="ve-stage">
      <div className="ve-topbar">
        <strong>{basicUser.name}</strong>
        <button className="ve-btn" onClick={() => setPage('home')}>← Back</button>
      </div>
      <div style={{ padding: 20, maxWidth: 480 }}>
        <div className="ve-panel" style={{ textAlign: 'center' }}>
          <div className="ve-user-card-avatar" style={{ margin: '0 auto', width: 88, height: 88, fontSize: 32, backgroundImage: basicUser.avatarUrl ? `url(${basicUser.avatarUrl})` : undefined }}>
            {!basicUser.avatarUrl && basicUser.name[0]}
          </div>
          <h2 style={{ marginBottom: 4 }}>{basicUser.name}</h2>
          {basicUser.city && <p className="ve-muted">{basicUser.city}</p>}
          {extra?.age && <p className="ve-muted">{extra.age} years old</p>}
          {extra?.bio && <p style={{ marginTop: 12 }}>{extra.bio}</p>}
          <button
            className="ve-btn ve-btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => { emit({ type: 'dm_open', peerId: basicUser.id }); setPage('chats') }}
          >
            Message
          </button>
        </div>
      </div>
    </section>
  )
}

function LivePage({ netState, emit, user, setPage, setThreadChatId, goToLive }: {
  netState: NetState; emit: (msg: Record<string, unknown>) => void; user: AuthUser
  setPage: (p: Page) => void; setThreadChatId: (id: string | null) => void
  goToLive: (liveId: string) => void
}) {
  const [title, setTitle] = useState('')
  const mine = netState.lives.find(l => l.hostId === user.id)

  useEffect(() => {
    if (mine) {
      setPage('liveStage')
      setThreadChatId(null)
    }
  }, [mine?.id])

  return (
    <section className="ve-stage">
      <div className="ve-topbar">
        <strong>Valentine Express stage</strong>
        <span className="ve-muted">WebRTC live</span>
      </div>
      <div style={{ padding: 20, display: 'grid', gap: 16 }}>
        <div className="ve-panel">
          <h2 style={{ marginTop: 0 }}>Go live</h2>
          <p className="ve-muted">Your camera is sent to everyone who taps Watch.</p>
          {mine ? (
            <button className="ve-btn ve-btn-primary" onClick={() => { setPage('liveStage'); setThreadChatId(null) }}>Return to my live</button>
          ) : (
            <form onSubmit={e => {
              e.preventDefault()
              emit({ type: 'live_start', title: title || `${user.name} live` })
            }}>
              <input className="ve-field" placeholder="Room title" value={title} onChange={e => setTitle(e.target.value)} />
              <button className="ve-btn ve-btn-primary" style={{ marginTop: 12 }} type="submit">Start live</button>
            </form>
          )}
        </div>
        <div className="ve-grid-2">
          {netState.lives.map(l => (
            <button key={l.id} className="ve-panel" style={{ textAlign: 'left' }} onClick={() => goToLive(l.id)}>
              <div className="ve-badge"><span className="ve-live-dot" /> LIVE · {l.host}</div>
              <h3>{l.title}</h3>
              <p className="ve-muted">{l.viewers} watching</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function LiveStagePage({ netState, emit, user, setPage }: {
  netState: NetState; emit: (msg: Record<string, unknown>) => void; user: AuthUser
  setPage: (p: Page) => void
}) {
  const liveId = netState.currentLiveId
  const live = netState.lives.find(l => l.id === liveId)
  const isHost = live?.hostId === user.id
  const videoRef = useRef<HTMLVideoElement>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const hostPcs = useRef(new Map<string, RTCPeerConnection>())
  const viewerPc = useRef<RTCPeerConnection | null>(null)
  const [text, setText] = useState('')
  const [status, setStatus] = useState('Connecting…')
  const pendingViewers = useRef<{ viewerId: string; liveId: string }[]>([])
  const joined = useRef(false)

  useEffect(() => {
    if (!liveId) return
    emit({ type: 'live_join', liveId })
    joined.current = true
    return () => {
      emit({ type: 'live_leave', liveId })
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      hostPcs.current.forEach(pc => pc.close())
      hostPcs.current.clear()
      viewerPc.current?.close()
      viewerPc.current = null
    }
  }, [liveId])

  const offerTo = useCallback((viewerId: string, lId: string, stream: MediaStream) => {
    const existing = hostPcs.current.get(viewerId)
    existing?.close()
    const pc = new RTCPeerConnection(ICE_CONFIG)
    for (const track of stream.getTracks()) pc.addTrack(track, stream)
    pc.onicecandidate = e => { if (e.candidate) emit({ type: 'rtc_ice', liveId: lId, to: viewerId, candidate: e.candidate }) }
    hostPcs.current.set(viewerId, pc)
    ;(async () => {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      emit({ type: 'rtc_offer', liveId: lId, to: viewerId, sdp: pc.localDescription })
    })()
  }, [emit])

  useEffect(() => {
    if (!isHost || !liveId) return
    let stop = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        })
        if (stop) { stream.getTracks().forEach(t => t.stop()); return }
        localStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.muted = true
          await videoRef.current.play().catch(() => {})
        }
        setStatus('You are live')
        pendingViewers.current.forEach(q => offerTo(q.viewerId, q.liveId, stream))
      } catch {
        setStatus('Camera blocked — studio mode')
        const canvas = document.createElement('canvas')
        canvas.width = 1280; canvas.height = 720
        const ctx = canvas.getContext('2d')!
        const start = performance.now()
        const draw = () => {
          const t = (performance.now() - start) / 1000
          ctx.fillStyle = '#14080c'
          ctx.fillRect(0, 0, 1280, 720)
          const g = ctx.createRadialGradient(640, 280, 40, 640, 360, 520)
          g.addColorStop(0, 'rgba(225,29,72,0.55)')
          g.addColorStop(1, 'rgba(14,6,9,0.2)')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, 1280, 720)
          ctx.fillStyle = '#fde8ee'
          ctx.font = '600 42px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('Valentine Express', 640, 340)
          ctx.font = '28px sans-serif'
          ctx.fillStyle = '#fb7185'
          ctx.fillText('Studio fallback', 640, 390)
          requestAnimationFrame(draw)
        }
        draw()
        const stream = canvas.captureStream(24)
        if (stop) { stream.getTracks().forEach(t => t.stop()); return }
        localStreamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true }
        setStatus('You are live (studio)')
      }
    })()
    return () => { stop = true }
  }, [isHost, liveId])

  useEffect(() => {
    const need = netState.rtcNeedOffer
    if (!need || !isHost || need.liveId !== liveId) return
    if (!localStreamRef.current) {
      pendingViewers.current.push({ viewerId: need.viewerId, liveId: need.liveId })
      return
    }
    offerTo(need.viewerId, need.liveId, localStreamRef.current)
  }, [netState.rtcNeedOffer, isHost, liveId, offerTo])

  useEffect(() => {
    const sig = netState.rtcFromHost
    if (!sig || !liveId || sig.liveId !== liveId) return
    const from = sig.from

    if (isHost) {
      const pc = hostPcs.current.get(from)
      if (!pc) return
      if (sig.type === 'rtc_answer' && sig.sdp) pc.setRemoteDescription(sig.sdp as RTCSessionDescriptionInit).catch(() => {})
      if (sig.type === 'rtc_ice' && sig.candidate) pc.addIceCandidate(sig.candidate as RTCIceCandidateInit).catch(() => {})
      return
    }

    if (sig.type === 'rtc_offer' && sig.sdp) {
      viewerPc.current?.close()
      const pc = new RTCPeerConnection(ICE_CONFIG)
      pc.onicecandidate = e => { if (e.candidate) emit({ type: 'rtc_ice', liveId, to: from, candidate: e.candidate }) }
      pc.ontrack = e => {
        const s = e.streams[0] || new MediaStream([e.track])
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}) }
        setStatus('Watching live')
      }
      viewerPc.current = pc
      ;(async () => {
        await pc.setRemoteDescription(sig.sdp as RTCSessionDescriptionInit)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        emit({ type: 'rtc_answer', liveId, to: from, sdp: pc.localDescription })
      })()
    }
    if (sig.type === 'rtc_ice' && sig.candidate && viewerPc.current) {
      viewerPc.current.addIceCandidate(sig.candidate as RTCIceCandidateInit).catch(() => {})
    }
  }, [netState.rtcFromHost, isHost, liveId])

  if (!live) {
    return (
      <section className="ve-stage" style={{ gridColumn: '2 / -1' }}>
        <div className="ve-topbar">This live has ended.</div>
        <div style={{ padding: 20 }}>
          <button className="ve-btn" onClick={() => setPage('live')}>Back to Live</button>
        </div>
      </section>
    )
  }

  const comments = netState.comments[live.id] ?? []

  return (
    <section className="ve-stage ve-live-fullscreen">
      <div className="ve-live-frame ve-live-frame-full">
        <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000' }} />
        <div className="ve-live-overlay">
          <div className="ve-live-top">
            <button className="ve-icon-btn" aria-label="Back" onClick={() => setPage('live')}>←</button>
            <div className="ve-badge"><span className="ve-live-dot" /> {live.host} · {live.viewers}</div>
            <form className="ve-live-chat-top" onSubmit={e => {
              e.preventDefault()
              if (!text.trim()) return
              emit({ type: 'live_comment', liveId: live.id, text: text.trim() })
              setText('')
            }}>
              <input value={text} onChange={e => setText(e.target.value)} placeholder="Say something…" />
              <button className="ve-icon-btn ve-icon-btn-primary" type="submit" aria-label="Send">➤</button>
            </form>
            {isHost && (
              <button className="ve-icon-btn ve-icon-btn-danger" aria-label="End live" onClick={() => {
                emit({ type: 'live_end', liveId: live.id })
                setPage('live')
              }}>✕</button>
            )}
          </div>

          <div className="ve-live-comments">
            {comments.slice(-6).map((c, i) => (
              <div key={i} className="ve-badge" style={{ display: 'block' }}>
                <b>{c.user}</b> {c.text}
              </div>
            ))}
            {netState.giftFlash && <div className="ve-badge">{netState.giftFlash}</div>}
          </div>

          {!isHost && (
            <div className="ve-gifts-3d">
              {GIFT_CATALOG.map(g => (
                <button
                  key={g.id}
                  className="ve-gift-3d"
                  title={`${g.name} · ${g.coins} coins`}
                  onClick={() => emit({ type: 'live_gift', liveId: live.id, giftId: g.id })}
                >
                  <span className="ve-gift-emoji">{g.icon}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// VAST (Video Ad Serving Template) support for the rewarded-ad flow.
// Fetches a VAST tag URL (e.g. from HilltopAds' Video VAST ad format),
// resolves Wrapper redirects, extracts the media file + tracking pixel
// URLs, and reports back once the video actually plays to the end.
// ---------------------------------------------------------------------------

interface VastResult {
  mediaUrl: string
  impressions: string[]
  trackers: Record<string, string[]>
}

async function fetchVast(url: string, depth = 0): Promise<VastResult | null> {
  if (depth > 3) return null // guard against wrapper redirect loops
  let text: string
  try {
    const res = await fetch(url)
    text = await res.text()
  } catch {
    return null
  }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(text, 'text/xml')
    if (doc.querySelector('parsererror')) return null
  } catch {
    return null
  }

  // Wrapper VAST points to another VAST tag — follow it.
  const wrapperUri = doc.querySelector('VASTAdTagURI')?.textContent?.trim()
  if (wrapperUri) {
    return fetchVast(wrapperUri, depth + 1)
  }

  const mediaUrl = doc.querySelector('MediaFile')?.textContent?.trim()
  if (!mediaUrl) return null

  const trackers: Record<string, string[]> = {}
  doc.querySelectorAll('Tracking').forEach(el => {
    const event = el.getAttribute('event') || 'other'
    const trackUrl = el.textContent?.trim()
    if (trackUrl) {
      trackers[event] = trackers[event] || []
      trackers[event].push(trackUrl)
    }
  })

  const impressions = Array.from(doc.querySelectorAll('Impression'))
    .map(el => el.textContent?.trim())
    .filter((u): u is string => !!u)

  return { mediaUrl, impressions, trackers }
}

function fireTrackingPixels(urls?: string[]) {
  for (const u of urls || []) {
    try { new Image().src = u } catch { /* ignore */ }
  }
}

function PushToast({ toasts, onDismiss }: { toasts: Array<{ id: number; title: string; body: string }>; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 900, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
      {toasts.map(t => (
        <div key={t.id} className="ve-panel" style={{ cursor: 'pointer' }} onClick={() => onDismiss(t.id)}>
          <strong>{t.title}</strong>
          {t.body && <p style={{ margin: '4px 0 0' }} className="ve-muted">{t.body}</p>}
        </div>
      ))}
    </div>
  )
}

function DailyBonusModal({ onClaimed }: { onClaimed: () => void }) {
  const [status, setStatus] = useState<{ available: boolean; streak: number; coinsOnClaim: number } | null>(null)
  const [claimed, setClaimed] = useState<{ coinsAwarded: number; streak: number } | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [showAd, setShowAd] = useState(false)

  useEffect(() => {
    authFetch('/api/wallet/daily-claim').then(r => r.ok ? r.json() : null).then(data => {
      if (data?.available) setStatus(data)
    }).catch(() => {})
  }, [])

  if (dismissed || (!status && !claimed)) return null

  async function performClaim() {
    setClaiming(true)
    try {
      const res = await authFetch('/api/wallet/daily-claim', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setClaimed({ coinsAwarded: data.coinsAwarded, streak: data.streak })
        onClaimed()
      } else {
        setDismissed(true)
      }
    } catch {
      setDismissed(true)
    }
    setClaiming(false)
  }

  // Tapping "Claim" shows a HilltopAds video first — the actual coin
  // credit only happens once the ad reports completion (see handleAdComplete).
  function handleClaimClick() {
    if (process.env.NEXT_PUBLIC_HILLTOP_VAST_URL) {
      setShowAd(true)
    } else {
      // No ad configured yet — don't block the free daily bonus on a
      // missing env var, just grant it directly.
      performClaim()
    }
  }

  function handleAdComplete() {
    setShowAd(false)
    performClaim()
  }

  function handleAdError() {
    setShowAd(false)
    // Ad failed to load (network hiccup, adblock, etc.) — still grant the
    // bonus rather than let a third-party outage block a free daily
    // reward. If you'd rather enforce watching strictly, call
    // setDismissed(true) here instead of performClaim().
    performClaim()
  }

  const streak = claimed?.streak ?? status?.streak ?? 0
  const displayStreak = claimed ? streak : streak + 1 // the streak this claim would reach

  return (
    <div className="ve-modal-backdrop" onClick={() => !claiming && !showAd && setDismissed(true)}>
      {showAd && process.env.NEXT_PUBLIC_HILLTOP_VAST_URL && (
        <RewardedVastAd
          vastUrl={process.env.NEXT_PUBLIC_HILLTOP_VAST_URL}
          onComplete={handleAdComplete}
          onError={handleAdError}
        />
      )}
      <div className="ve-bonus-modal" onClick={e => e.stopPropagation()}>
        <div className="ve-bonus-icon">{claimed ? '🎉' : '🎁'}</div>
        <h2 style={{ margin: '10px 0 4px' }}>{claimed ? 'Bonus claimed!' : 'Daily Bonus'}</h2>
        <p className="ve-muted">
          {claimed ? `+${claimed.coinsAwarded} coins added to your wallet` : 'Come back every day to grow your streak'}
        </p>
        <div className="ve-bonus-streak-row">
          {Array.from({ length: 7 }).map((_, i) => {
            const dayNum = i + 1
            const filled = dayNum <= (displayStreak % 7 === 0 && displayStreak > 0 ? 7 : displayStreak % 7 || (displayStreak > 0 ? 7 : 0))
            return <div key={i} className={`ve-bonus-streak-day${filled ? ' filled' : ''}`}>{dayNum}</div>
          })}
        </div>
        {claimed ? (
          <button className="ve-btn ve-btn-primary" style={{ width: '100%' }} onClick={() => setDismissed(true)}>Nice!</button>
        ) : (
          <button className="ve-btn ve-btn-primary" style={{ width: '100%' }} onClick={handleClaimClick} disabled={claiming}>
            {claiming ? 'Claiming…' : `Watch ad & claim +${status?.coinsOnClaim ?? 0} coins`}
          </button>
        )}
      </div>
    </div>
  )
}

function RewardedVastAd({ vastUrl, onComplete, onError }: {
  vastUrl: string
  onComplete: () => void
  onError: (msg: string) => void
}) {
  const [ad, setAd] = useState<VastResult | null>(null)
  const [failed, setFailed] = useState(false)
  const firedComplete = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchVast(vastUrl).then(result => {
      if (cancelled) return
      if (!result) {
        setFailed(true)
        onError('Ad failed to load — try again later.')
        return
      }
      setAd(result)
      fireTrackingPixels(result.impressions)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vastUrl])

  function handleEnded() {
    if (firedComplete.current) return
    firedComplete.current = true
    fireTrackingPixels(ad?.trackers['complete'])
    onComplete()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ maxWidth: 640, width: '90%' }}>
        {failed ? (
          <p style={{ color: '#fff', textAlign: 'center' }}>Ad failed to load. Please try again later.</p>
        ) : ad ? (
          <video
            src={ad.mediaUrl}
            autoPlay
            playsInline
            controls={false}
            style={{ width: '100%', borderRadius: 8, background: '#000' }}
            onEnded={handleEnded}
            onError={() => { setFailed(true); onError('Ad playback failed.') }}
          />
        ) : (
          <p style={{ color: '#fff', textAlign: 'center' }}>Loading ad…</p>
        )}
        <p style={{ color: '#aaa', textAlign: 'center', marginTop: 8, fontSize: 13 }}>
          Watch to the end to earn coins
        </p>
      </div>
    </div>
  )
}

function WalletPage({ user, setUser }: { user: AuthUser; setUser: (msg: string) => void }) {
  const [diamonds, setDiamonds] = useState(CASHOUT_MIN)
  const [email, setEmail] = useState(user.paypalEmail ?? user.email)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<{ orderId: string; providerRef: string } | null>(null)

  async function handleBuy(packId: string) {
    setLoading(true)
    setMsg('')
    try {
      const res = await authFetch('/api/payments/create-coin-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const data = await res.json()
      if (data.approvalUrl) {
        window.open(data.approvalUrl, '_blank')
        setPendingOrder({ orderId: data.orderId, providerRef: data.providerRef })
        setMsg('Approve the payment in the PayPal window, then come back and tap "I\'ve completed payment".')
      } else {
        setMsg(data.error || 'Failed to create order')
      }
    } catch {
      setMsg('Network error')
    }
    setLoading(false)
  }

  async function handleCapture() {
    if (!pendingOrder) return
    setLoading(true)
    setMsg('')
    try {
      const res = await authFetch('/api/payments/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendingOrder),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg(`Payment confirmed — coins credited.`)
        setPendingOrder(null)
        setUser('refresh')
      } else {
        setMsg(data.error || 'Payment not yet approved — try again after approving in the PayPal window.')
      }
    } catch {
      setMsg('Network error')
    }
    setLoading(false)
  }

  async function handleCashout() {
    setLoading(true)
    setMsg('')
    try {
      const res = await authFetch('/api/cashout/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diamonds, paypalEmail: email }),
      })
      const data = await res.json()
      if (data.id) {
        setMsg(`Request ${data.id.slice(0, 8)} submitted.`)
        setUser('refresh')
      } else {
        setMsg(data.error || 'Failed')
      }
    } catch {
      setMsg('Network error')
    }
    setLoading(false)
  }

  const [bonusMsg, setBonusMsg] = useState('')
  const [watchingAd, setWatchingAd] = useState(false)
  const [adToken, setAdToken] = useState<string | null>(null)
  const [adStatus, setAdStatus] = useState<{ claimedToday: number; dailyCap: number; coinsPerAd: number; cooldownUntil: string | null } | null>(null)

  useEffect(() => {
    authFetch('/api/wallet/ad-reward/status').then(r => r.ok ? r.json() : null).then(data => {
      if (data) setAdStatus(data)
    }).catch(() => {})
  }, [])

  async function handleWatchAd() {
    const vastUrl = process.env.NEXT_PUBLIC_HILLTOP_VAST_URL
    if (!vastUrl) {
      setBonusMsg('Ad not configured yet — try again later.')
      return
    }
    setWatchingAd(true)
    setBonusMsg('')
    try {
      const startRes = await authFetch('/api/wallet/ad-reward/start', { method: 'POST' })
      const startData = await startRes.json()
      if (!startRes.ok) {
        setBonusMsg(startData.error || 'Ad not available right now')
        setWatchingAd(false)
        return
      }
      setAdToken(startData.token)
    } catch {
      setBonusMsg('Network error')
      setWatchingAd(false)
    }
  }

  async function handleAdComplete() {
    const token = adToken
    setAdToken(null)
    if (!token) { setWatchingAd(false); return }
    try {
      const claimRes = await authFetch('/api/wallet/ad-reward/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const claimData = await claimRes.json()
      if (claimData.ok) {
        setBonusMsg(`+${claimData.coinsAwarded} coins for watching!`)
        setAdStatus(s => s ? { ...s, claimedToday: claimData.claimedToday } : s)
        setUser('refresh')
      } else {
        setBonusMsg(claimData.error || 'Could not credit reward')
      }
    } catch {
      setBonusMsg('Network error')
    }
    setWatchingAd(false)
  }

  function handleAdError(msg: string) {
    setAdToken(null)
    setBonusMsg(msg)
    setWatchingAd(false)
  }

  return (
    <section className="ve-stage" style={{ gridColumn: '2 / -1' }}>
      {adToken && process.env.NEXT_PUBLIC_HILLTOP_VAST_URL && (
        <RewardedVastAd
          vastUrl={process.env.NEXT_PUBLIC_HILLTOP_VAST_URL}
          onComplete={handleAdComplete}
          onError={handleAdError}
        />
      )}
      <div className="ve-topbar">
        <strong>Wallet</strong>
        <span className="ve-muted">{DIAMONDS_PER_USD} diamonds = $1</span>
      </div>
      <div style={{ padding: 20 }} className="ve-grid-2">
        <div className="ve-panel">
          <p className="ve-muted">Spendable coins</p>
          <p className="ve-stat">{user.coins.toLocaleString()}</p>
          <p className="ve-muted" style={{ marginTop: 16 }}>Earned diamonds</p>
          <p className="ve-stat">{user.diamonds.toLocaleString()}</p>
          <p className="ve-muted">≈ ${diamondsToUsd(user.diamonds).toFixed(2)}</p>
        </div>
        <div className="ve-panel">
          <h3 style={{ marginTop: 0 }}>Watch ads for coins</h3>
          {adStatus && (
            <>
              <p className="ve-muted" style={{ marginBottom: 10 }}>
                {adStatus.claimedToday} / {adStatus.dailyCap} watched today · +{adStatus.coinsPerAd} coins each
              </p>
              <div className="ve-ad-grid">
                {Array.from({ length: adStatus.dailyCap }).map((_, i) => {
                  const claimed = i < adStatus.claimedToday
                  const isNext = i === adStatus.claimedToday
                  const onCooldown = !!adStatus.cooldownUntil && new Date(adStatus.cooldownUntil).getTime() > Date.now()
                  return (
                    <button
                      key={i}
                      className={`ve-ad-slot${claimed ? ' claimed' : ''}${isNext && !onCooldown ? ' next' : ''}`}
                      disabled={!isNext || watchingAd || onCooldown}
                      onClick={handleWatchAd}
                      title={claimed ? 'Watched' : isNext ? 'Watch ad' : 'Locked'}
                    >
                      {claimed ? '✓' : isNext ? (watchingAd ? '…' : '▶') : '🔒'}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {bonusMsg && <p className="ve-muted" style={{ marginTop: 10 }}>{bonusMsg}</p>}
        </div>
        <div className="ve-panel">
          <h3 style={{ marginTop: 0 }}>Coin packs</h3>
          <p className="ve-warn">PayPal checkout — real payment required.</p>
          {COIN_PACKS.map(p => (
            <button key={p.id} className="ve-btn" style={{ marginRight: 8, marginTop: 8 }} onClick={() => handleBuy(p.id)} disabled={loading}>
              {p.coins} coins · {p.priceLabel}
            </button>
          ))}
          {pendingOrder && (
            <button className="ve-btn ve-btn-primary" style={{ marginTop: 12 }} onClick={handleCapture} disabled={loading}>
              I've completed payment
            </button>
          )}
        </div>
        <div className="ve-panel">
          <h3 style={{ marginTop: 0 }}>Cash out to PayPal</h3>
          <p className="ve-muted">Minimum {CASHOUT_MIN} diamonds. KYC must be approved.</p>
          <input className="ve-field" type="number" value={diamonds} onChange={e => setDiamonds(Number(e.target.value))} />
          <input className="ve-field" type="email" placeholder="PayPal email" value={email} onChange={e => setEmail(e.target.value)} />
          <p className="ve-ok">You would receive ≈ ${diamondsToUsd(diamonds).toFixed(2)}</p>
          {msg && <p className="ve-muted">{msg}</p>}
          <button className="ve-btn ve-btn-primary" style={{ marginTop: 10 }} onClick={handleCashout} disabled={loading}>
            Request cash-out
          </button>
        </div>
      </div>
    </section>
  )
}

function VerifyPage({ user, setUser }: { user: AuthUser; setUser: (msg: string) => void }) {
  const [msg, setMsg] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null)
  const [nicFrontUrl, setNicFrontUrl] = useState<string | null>(null)
  const [nicBackUrl, setNicBackUrl] = useState<string | null>(null)

  async function handleFileUpload(
    kind: 'kyc_selfie' | 'kyc_nic_front' | 'kyc_nic_back',
    setUrl: (url: string) => void,
    file: File,
  ) {
    setUploading(kind)
    setMsg('')
    try {
      const url = await uploadImageDirect(file, kind)
      setUrl(url)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed')
    }
    setUploading(null)
  }

  async function handleSubmit() {
    if (!selfieUrl) {
      setMsg('A selfie photo is required.')
      return
    }
    try {
      const res = await authFetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selfieUrl, nicFrontUrl, nicBackUrl }),
      })
      const data = await res.json()
      if (data.ok) {
        setMsg('KYC submitted for review.')
        setUser('refresh')
      } else {
        setMsg(data.error || 'Failed to submit')
      }
    } catch {
      setMsg('Network error')
    }
  }

  function FileRow({ label, kind, url, setUrl }: {
    label: string
    kind: 'kyc_selfie' | 'kyc_nic_front' | 'kyc_nic_back'
    url: string | null
    setUrl: (url: string) => void
  }) {
    return (
      <div style={{ marginTop: 12 }}>
        <label className="ve-muted" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
        <input
          type="file"
          accept="image/*"
          disabled={uploading === kind}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleFileUpload(kind, setUrl, file)
          }}
        />
        {uploading === kind && <span className="ve-muted" style={{ marginLeft: 8 }}>Uploading…</span>}
        {url && <p className="ve-ok" style={{ marginTop: 4 }}>✓ Uploaded</p>}
      </div>
    )
  }

  return (
    <section className="ve-stage" style={{ gridColumn: '2 / -1' }}>
      <div className="ve-topbar">
        <strong>Identity check</strong>
        <span className="ve-muted">Status: {user.kycStatus}</span>
      </div>
      <div style={{ padding: 20, maxWidth: 560 }}>
        <div className="ve-panel">
          <p>
            KYC verification is required before going live and cashing out.
            Upload your selfie and NIC photos.
          </p>
          <p className="ve-muted">This is not a government NIC database check.</p>

          <FileRow label="Selfie (required)" kind="kyc_selfie" url={selfieUrl} setUrl={setSelfieUrl} />
          <FileRow label="NIC — front" kind="kyc_nic_front" url={nicFrontUrl} setUrl={setNicFrontUrl} />
          <FileRow label="NIC — back" kind="kyc_nic_back" url={nicBackUrl} setUrl={setNicBackUrl} />

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button className="ve-btn" onClick={handleSubmit} disabled={!selfieUrl || !!uploading}>Submit for review</button>
          </div>
          {msg && <p className="ve-muted" style={{ marginTop: 12 }}>{msg}</p>}
        </div>
      </div>
    </section>
  )
}

function StatusPage({ netState, user, emit }: { netState: NetState; user: AuthUser; emit: (msg: Record<string, unknown>) => void }) {
  const [text, setText] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImageDirect(file, 'status')
      setImageUrl(url)
    } catch { /* ignore */ }
    setUploading(false)
  }

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    await authFetch('/api/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), imageUrl }),
    }).catch(() => {})
    setText('')
    setImageUrl(null)
  }

  return (
    <section className="ve-stage" style={{ gridColumn: '2 / -1' }}>
      <div className="ve-topbar">
        <strong>Status</strong>
        <span className="ve-muted">Share updates with everyone</span>
      </div>
      <div style={{ padding: 20, display: 'grid', gap: 12 }}>
        <form className="ve-panel" onSubmit={handlePost}>
          <input className="ve-field" style={{ marginTop: 0 }} value={text} onChange={e => setText(e.target.value)} placeholder="Share an update" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <input type="file" accept="image/*" onChange={handleImagePick} disabled={uploading} />
            {uploading && <span className="ve-muted">Uploading…</span>}
            {imageUrl && <span className="ve-ok">✓ Image attached</span>}
          </div>
          <button className="ve-btn ve-btn-primary" style={{ marginTop: 10 }} type="submit" disabled={uploading}>Post</button>
        </form>
        {netState.statuses.map(s => (
          <div key={s.id} className="ve-panel">
            <strong>{s.userName}</strong>
            <p>{s.text}</p>
            {s.imageUrl && (
              <img src={s.imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginTop: 6 }} />
            )}
            <span className="ve-muted">{s.age}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ProfilePage({ user, setUser, onLogout }: { user: AuthUser; setUser: (u: AuthUser) => void; onLogout: () => void }) {
  const [bio, setBio] = useState(user.bio || '')
  const [birthday, setBirthday] = useState(user.birthday || '')
  const [city, setCity] = useState(user.city || '')
  const [gender, setGender] = useState(user.gender || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [notifStatus, setNotifStatus] = useState<'idle' | 'requesting' | 'enabled' | 'error'>('idle')
  const [notifMsg, setNotifMsg] = useState('')

  async function handleEnableNotifications() {
    setNotifStatus('requesting')
    setNotifMsg('')
    const result = await requestNotificationPermission()
    if (result.ok) {
      setNotifStatus('enabled')
    } else {
      setNotifStatus('error')
      setNotifMsg(result.message)
    }
  }

  const GENDER_LABELS: Record<string, string> = { male: 'පිරිමි', female: 'ගැහැනු', other: 'වෙනත්' }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    try {
      const res = await authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio: bio || null,
          birthday: birthday || null,
          city: city || null,
          gender: gender || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setMsg(data.error || 'Failed to save'); setSaving(false); return }
      // Refresh user data
      const meRes = await authFetch(`/api/auth/me`)
      const meData = await meRes.json()
      if (meData.profile) {
        setUser({
          ...user,
          bio: meData.profile.bio,
          birthday: meData.profile.birthday,
          city: meData.profile.city,
          gender: meData.profile.gender,
          age: meData.profile.age,
          avatarUrl: meData.profile.avatarUrl,
        })
      }
      setMsg('Profile updated!')
      setTimeout(() => setMsg(''), 2000)
    } catch {
      setMsg('Network error')
    }
    setSaving(false)
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImageDirect(file, 'avatar')

      const profileRes = await authFetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      })
      if (!profileRes.ok) { setMsg('Upload succeeded but saving to profile failed'); setUploading(false); return }

      setUser({ ...user, avatarUrl: url })
      setMsg('Photo updated!')
      setTimeout(() => setMsg(''), 2000)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload error')
    }
    setUploading(false)
  }

  return (
    <section className="ve-stage">
      <div className="ve-topbar">
        <h1>Profile</h1>
        <button className="ve-btn ve-btn-ghost" style={{ color: 'var(--ve-rose-2)' }} onClick={onLogout}>Logout</button>
      </div>

      <div className="ve-profile-container">
        {/* Avatar section */}
        <div className="ve-profile-avatar-section">
          <div
            className="ve-profile-avatar"
            style={{ backgroundImage: user.avatarUrl ? `url(${user.avatarUrl})` : undefined }}
            onClick={() => fileRef.current?.click()}
            title="Click to change photo"
          >
            {user.avatarUrl ? '' : <span className="ve-profile-avatar-fallback">{user.name[0]}</span>}
            <div className="ve-profile-avatar-overlay">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleAvatarUpload} />
          {uploading && <p className="ve-muted" style={{ marginTop: 8 }}>Uploading...</p>}
          <h2 style={{ margin: '12px 0 2px' }}>{user.name}</h2>
          <p className="ve-muted">{user.email}</p>
          {user.age && <p className="ve-muted">{user.age} years old</p>}
          {user.city && <p className="ve-muted">{user.city}</p>}
          {user.gender && <p className="ve-muted">{GENDER_LABELS[user.gender] || user.gender}</p>}
        </div>

        {/* Edit form */}
        <form className="ve-panel ve-profile-form" onSubmit={handleSave}>
          <h3 style={{ margin: '0 0 16px' }}>Edit Profile</h3>

          <label className="ve-profile-label">Bio</label>
          <textarea
            className="ve-field ve-profile-bio"
            placeholder="Tell us about yourself..."
            value={bio}
            onChange={e => setBio(e.target.value)}
            maxLength={300}
            rows={3}
          />

          <label className="ve-profile-label">Birthday</label>
          <input
            className="ve-field"
            type="date"
            value={birthday}
            onChange={e => setBirthday(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
          />

          <label className="ve-profile-label">City</label>
          <input
            className="ve-field"
            placeholder="e.g. Colombo"
            value={city}
            onChange={e => setCity(e.target.value)}
            maxLength={100}
          />

          <label className="ve-profile-label">Gender</label>
          <select className="ve-field" value={gender} onChange={e => setGender(e.target.value)}>
            <option value="">Select</option>
            <option value="male">පිරිමි (Male)</option>
            <option value="female">ගැහැනු (Female)</option>
            <option value="other">වෙනත් (Other)</option>
          </select>

          {msg && <p style={{ marginTop: 12, textAlign: 'center' }} className={msg.includes('updated') ? 've-ok' : 've-err'}>{msg}</p>}

          <button className="ve-btn ve-btn-primary" style={{ width: '100%', marginTop: 16 }} type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </form>

        <div className="ve-panel" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Notifications</h3>
          {notifStatus === 'enabled' ? (
            <p className="ve-ok">✓ Push notifications enabled on this device</p>
          ) : (
            <>
              <p className="ve-muted" style={{ marginBottom: 10 }}>Get notified about gifts, messages, and live alerts.</p>
              <button className="ve-btn" onClick={handleEnableNotifications} disabled={notifStatus === 'requesting'}>
                {notifStatus === 'requesting' ? 'Requesting…' : 'Enable notifications'}
              </button>
              {notifStatus === 'error' && <p className="ve-err" style={{ marginTop: 8 }}>{notifMsg}</p>}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function AdminPage({ user }: { user: AuthUser }) {
  const [cashouts, setCashouts] = useState<Array<Record<string, unknown>>>([])
  const [kycList, setKycList] = useState<Array<Record<string, unknown>>>([])
  const [tab, setTab] = useState<'payouts' | 'kyc'>('payouts')

  useEffect(() => {
    authFetch(`/api/admin/cashout`).then(r => r.json()).then(setCashouts).catch(() => {})
    authFetch('/api/admin/kyc').then(r => r.json()).then(setKycList).catch(() => {})
  }, [])

  async function handleApprove(id: string) {
    await authFetch(`/api/admin/cashout/${id}/approve`, { method: 'POST' })
    authFetch(`/api/admin/cashout`).then(r => r.json()).then(setCashouts).catch(() => {})
  }

  async function handleReject(id: string) {
    await authFetch(`/api/admin/cashout/${id}/reject`, { method: 'POST' })
    authFetch(`/api/admin/cashout`).then(r => r.json()).then(setCashouts).catch(() => {})
  }

  async function handleKyc(id: string, action: 'approve' | 'reject') {
    await authFetch(`/api/admin/kyc/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    authFetch('/api/admin/kyc').then(r => r.json()).then(setKycList).catch(() => {})
  }

  if (user.role !== 'admin') {
    return <section className="ve-stage" style={{ gridColumn: '2 / -1' }}><div className="ve-topbar">Admin only</div></section>
  }

  return (
    <section className="ve-stage" style={{ gridColumn: '2 / -1' }}>
      <div className="ve-topbar">
        <strong>Admin desk</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`ve-btn${tab === 'payouts' ? ' ve-btn-primary' : ''}`} onClick={() => setTab('payouts')}>Payouts</button>
          <button className={`ve-btn${tab === 'kyc' ? ' ve-btn-primary' : ''}`} onClick={() => setTab('kyc')}>KYC</button>
        </div>
      </div>
      <div style={{ padding: 20 }}>
        {tab === 'payouts' && (
          <div className="ve-panel">
            <h3 style={{ marginTop: 0 }}>Payouts</h3>
            <table className="ve-table">
              <thead>
                <tr><th>User</th><th>Diamonds</th><th>USD</th><th>PayPal</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {cashouts.length === 0 && <tr><td colSpan={6} className="ve-muted">No requests</td></tr>}
                {cashouts.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.userName || c.userId?.slice(0, 8)}</td>
                    <td>{c.diamonds}</td>
                    <td>${c.amount?.toFixed(2)}</td>
                    <td>{c.paypalEmail || '-'}</td>
                    <td>{c.status}</td>
                    <td>
                      {c.status === 'pending' && (
                        <>
                          <button className="ve-btn ve-btn-primary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => handleApprove(c.id)}>Pay</button>{' '}
                          <button className="ve-btn" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => handleReject(c.id)}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'kyc' && (
          <div className="ve-panel">
            <h3 style={{ marginTop: 0 }}>KYC Submissions</h3>
            <table className="ve-table">
              <thead><tr><th>User</th><th>Email</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(kycList as any[]).length === 0 && <tr><td colSpan={4} className="ve-muted">No submissions</td></tr>}
                {(kycList as any[]).map((k: any) => (
                  <tr key={k.id}>
                    <td>{k.userName || k.userId?.slice(0, 8)}</td>
                    <td>{k.userEmail}</td>
                    <td>{k.status}</td>
                    <td>
                      {k.status === 'pending' && (
                        <>
                          <button className="ve-btn ve-btn-primary" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => handleKyc(k.id, 'approve')}>Approve</button>{' '}
                          <button className="ve-btn" style={{ fontSize: 12, padding: '6px 10px' }} onClick={() => handleKyc(k.id, 'reject')}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

// ============ NET STATE ============

type NetState = {
  connected: boolean
  error: string | null
  me: NetUser | null
  users: NetUser[]
  chats: NetChat[]
  messages: Record<string, NetMsg[]>
  lives: NetLive[]
  comments: Record<string, NetComment[]>
  openChatId: string | null
  rtcNeedOffer: { liveId: string; viewerId: string; viewerName: string } | null
  rtcFromHost: { type: string; from: string; liveId: string; sdp?: unknown; candidate?: unknown } | null
  giftFlash: string | null
  currentLiveId: string | null
  statuses: Array<{ id: string; userName: string; text: string; age: string; imageUrl?: string | null }>
}

// ============ MAIN APP ============

export default function Home() {
  const [page, setPage] = useState<Page>('landing')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authError, setAuthError] = useState('')
  const [socket, setSocket] = useState<any>(null)
  const [threadChatId, setThreadChatId] = useState<string | null>(null)
  const [netState, setNetState] = useState<NetState>({
    connected: false, error: null, me: null, users: [], chats: [], messages: {},
    lives: [], comments: {}, openChatId: null, rtcNeedOffer: null, rtcFromHost: null,
    giftFlash: null, currentLiveId: null, statuses: [],
  })
  const netRef = useRef(netState)
  useEffect(() => { netRef.current = netState })

  // Reliably navigate into a live stream (host's own, or joining someone
  // else's). Previously, clicking another user's live tile only set
  // threadChatId — which LiveStagePage never actually reads — so viewers
  // joining a live they didn't start would silently fail to connect.
  function goToLive(liveId: string) {
    setNetState(n => ({ ...n, currentLiveId: liveId }))
    setThreadChatId(null)
    setPage('liveStage')
  }

  const [viewingProfile, setViewingProfile] = useState<{ id: string; name: string; avatarUrl: string | null; city: string | null } | null>(null)
  function goToProfile(u: { id: string; name: string; avatarUrl: string | null; city: string | null }) {
    setViewingProfile(u)
    setPage('publicProfile')
  }

  const [showDailyBonus, setShowDailyBonus] = useState(false)
  const [pushToasts, setPushToasts] = useState<Array<{ id: number; title: string; body: string }>>([])

  // Foreground push notifications (background ones are handled by the
  // service worker instead — see public/firebase-messaging-sw.js).
  useEffect(() => {
    if (!user) return
    let unsubscribe: (() => void) | undefined
    listenForForegroundMessages(payload => {
      const id = Date.now()
      setPushToasts(t => [...t, {
        id,
        title: payload.notification?.title || 'Notification',
        body: payload.notification?.body || '',
      }])
      setTimeout(() => setPushToasts(t => t.filter(x => x.id !== id)), 6000)
    }).then(unsub => { unsubscribe = unsub })
    return () => { unsubscribe?.() }
  }, [user?.id])

  // Connect socket.io (via CDN)
  useEffect(() => {
    const s = connectSocket()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSocket(s)
    s.on('connect', () => {
      setNetState(n => ({ ...n, connected: true, error: null }))
      const existingToken = getToken()
      if (existingToken) {
        // Returning visitor with a stored session — resume without a
        // manual login, and (re)join the WS with the same signed token.
        authFetch('/api/auth/me').then(r => r.ok ? r.json() : Promise.reject())
          .then((meData: any) => {
            setUser({
              id: meData.user.id,
              name: meData.user.name,
              email: meData.user.email,
              role: meData.user.role,
              coins: meData.wallet?.coins ?? 0,
              diamonds: meData.wallet?.diamonds ?? 0,
              lifetimeEarned: meData.wallet?.lifetimeEarned ?? 0,
              avatarUrl: meData.profile?.avatarUrl,
              paypalEmail: meData.profile?.paypalEmail,
              kycStatus: meData.kyc?.status ?? 'none',
              bio: meData.profile?.bio,
              birthday: meData.profile?.birthday,
              city: meData.profile?.city,
              gender: meData.profile?.gender,
              age: meData.profile?.age,
            })
            s.emit('hello', { token: existingToken })
            setShowDailyBonus(true)
            setPage(p => p === 'landing' || p === 'register' ? 'home' : p)
          })
          .catch(() => { clearToken() })
      }
    })
    s.on('disconnect', () => setNetState(n => ({ ...n, connected: false })))
    s.on('error', (err: string) => setNetState(n => ({ ...n, error: err })))

    s.on('snapshot', (data: any) => {
      setNetState(n => ({
        ...n,
        me: data.me,
        users: data.users ?? [],
        chats: data.chats ?? [],
        messages: data.messages ?? {},
        lives: data.lives ?? [],
        comments: data.comments ?? {},
        statuses: (data.statuses ?? []).map((s: any) => ({
          id: s.id,
          userName: s.userName,
          text: s.text,
          imageUrl: s.imageUrl,
          age: s.age ?? (s.createdAt ? new Date(s.createdAt).toLocaleString() : ''),
        })),
      }))
    })

    s.on('presence', (data: any) => setNetState(n => ({ ...n, users: data.users ?? [] })))
    s.on('open_chat', (data: any) => {
      setNetState(n => ({ ...n, openChatId: data.chatId }))
      setThreadChatId(data.chatId)
      setPage('thread')
    })
    s.on('chat_msg', (data: any) => {
      setNetState(n => {
        const chatId = data.chatId
        const message = data.message
        const chat = data.chat
        const msgs = { ...n.messages, [chatId]: [...(n.messages[chatId] ?? []), message] }
        const chats = chat ? [chat, ...n.chats.filter(c => c.id !== chat.id)] : n.chats
        return { ...n, messages: msgs, chats }
      })
    })
    s.on('lives', (data: any) => setNetState(n => ({ ...n, lives: data.lives ?? [] })))
    s.on('live_started', (data: any) => {
      const live = data.live
      setNetState(n => {
        const lives = [live, ...n.lives.filter(l => l.id !== live.id)]
        return { ...n, lives, currentLiveId: live.id }
      })
      setPage('liveStage')
      setThreadChatId(null)
    })
    s.on('live_ended', (data: any) => {
      setNetState(n => ({
        ...n,
        lives: n.lives.filter(l => l.id !== data.liveId),
        currentLiveId: n.currentLiveId === data.liveId ? null : n.currentLiveId,
      }))
      if (netRef.current.currentLiveId === data.liveId) setPage('live')
    })
    s.on('live_state', (data: any) => {
      const live = data.live
      setNetState(n => {
        const lives = n.lives.some(l => l.id === live.id) ? n.lives.map(l => l.id === live.id ? live : l) : [live, ...n.lives]
        const comments = { ...n.comments, [live.id]: data.comments ?? [] }
        let giftFlash = n.giftFlash
        if (data.gift) {
          const g = data.gift as { from: string; name: string }
          giftFlash = `${g.from} sent ${g.name}`
          setTimeout(() => setNetState(nn => ({ ...nn, giftFlash: null })), 3000)
        }
        return { ...n, lives, comments, giftFlash }
      })
    })
    s.on('rtc_need_offer', (data: any) => setNetState(n => ({ ...n, rtcNeedOffer: data })))
    s.on('rtc_offer', (data: any) => setNetState(n => ({ ...n, rtcFromHost: data })))
    s.on('rtc_answer', (data: any) => setNetState(n => ({ ...n, rtcFromHost: data })))
    s.on('rtc_ice', (data: any) => setNetState(n => ({ ...n, rtcFromHost: data })))

    return () => { disconnectSocket() }
  }, [])

  const emit = useCallback((msg: Record<string, unknown>) => {
    if (socket?.connected) socket.emit(msg.type as string, msg)
  }, [socket])

  // Load statuses on mount
  useEffect(() => {
    fetch('/api/statuses').then(r => r.json()).then((data: any[]) => {
      setNetState(n => ({
        ...n,
        statuses: (Array.isArray(data) ? data : []).map(s => ({
          id: s.id, userName: s.userName, text: s.text, imageUrl: s.imageUrl, age: new Date(s.createdAt).toLocaleString(),
        })),
      }))
    }).catch(() => {})
  }, [])

  async function completeAuthSuccess(data: any) {
    setToken(data.token)

    const meRes = await authFetch(`/api/auth/me`)
    const meData = await meRes.json()
    const fullUser: AuthUser = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      role: data.user.role || 'user',
      coins: meData.wallet?.coins ?? 0,
      diamonds: meData.wallet?.diamonds ?? 0,
      lifetimeEarned: meData.wallet?.lifetimeEarned ?? 0,
      avatarUrl: meData.profile?.avatarUrl,
      paypalEmail: meData.profile?.paypalEmail,
      kycStatus: meData.kyc?.status ?? 'none',
      bio: meData.profile?.bio,
      birthday: meData.profile?.birthday,
      city: meData.profile?.city,
      gender: meData.profile?.gender,
      age: meData.profile?.age,
    }
    setUser(fullUser)
    setShowDailyBonus(true)

    if (socket?.connected) {
      socket.emit('hello', { token: data.token })
    }
    setPage('home')
  }

  // Pure login — only ever calls /api/auth/login. Does NOT fall back to
  // registration on failure; a login failure (wrong password, unknown
  // email) should show as a login error, never as a confusing
  // "account already exists" message.
  async function handleLogin(email: string, password: string) {
    setAuthError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.error || 'Invalid email or password')
        return
      }
      await completeAuthSuccess(data)
    } catch {
      setAuthError('Network error')
    }
  }

  // Pure registration — only ever calls /api/auth/register. Duplicate-email
  // validation lives here (and server-side in the register route) — login
  // never touches this path.
  async function handleRegister(name: string, email: string, password: string) {
    setAuthError('')
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAuthError(data.error || 'Registration failed')
        return
      }
      await completeAuthSuccess(data)
    } catch {
      setAuthError('Network error')
    }
  }

  function handleSetUser(msg: string) {
    if (msg === 'refresh' && user) {
      authFetch(`/api/auth/me`).then(r => r.json()).then(meData => {
        setUser(u => u ? {
          ...u,
          coins: meData.wallet?.coins ?? u.coins,
          diamonds: meData.wallet?.diamonds ?? u.diamonds,
          kycStatus: meData.kyc?.status ?? u.kycStatus,
          avatarUrl: meData.profile?.avatarUrl ?? u.avatarUrl,
          bio: meData.profile?.bio ?? u.bio,
          birthday: meData.profile?.birthday ?? u.birthday,
          city: meData.profile?.city ?? u.city,
          gender: meData.profile?.gender ?? u.gender,
          age: meData.profile?.age ?? u.age,
        } : u)
      }).catch(() => {})
    }
  }

  function handleLogout() {
    disconnectSocket()
    clearToken()
    setUser(null as any)
    setShowDailyBonus(false)
    setNetState(n => ({
      ...n,
      connected: false,
      users: [],
      chats: [],
      messages: {},
      lives: [],
      comments: {},
      statuses: [],
      openChatId: null,
      currentLiveId: null,
      giftFlash: null,
    }))
    setPage('landing')
  }

  if (page === 'register') {
    return (
      <div className="ve-app-bg">
        <RegisterPage onRegister={handleRegister} onGoLogin={() => setPage('landing')} wsConnected={netState.connected} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="ve-app-bg">
        <LandingPage onLogin={handleLogin} onGoRegister={() => setPage('register')} wsConnected={netState.connected} wsError={authError || netState.error} />
      </div>
    )
  }

  return (
    <div className="ve-app-bg">
      <Shell
        page={page} setPage={setPage}
        threadChatId={threadChatId} setThreadChatId={setThreadChatId}
        user={user} setUser={setUser} netState={netState} emit={emit} socket={socket}
        setStatusMsg={handleSetUser} onLogout={handleLogout}
        goToLive={goToLive} goToProfile={goToProfile} viewingProfile={viewingProfile}
      />
      {showDailyBonus && <DailyBonusModal onClaimed={() => handleSetUser('refresh')} />}
      <PushToast toasts={pushToasts} onDismiss={id => setPushToasts(t => t.filter(x => x.id !== id))} />
    </div>
  )
}