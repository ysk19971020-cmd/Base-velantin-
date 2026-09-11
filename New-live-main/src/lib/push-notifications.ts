// ---------------------------------------------------------------------------
// Web Push: permission request + token registration
// ---------------------------------------------------------------------------

import { getToken, onMessage, type MessagePayload } from 'firebase/messaging'
import { getFirebaseMessaging } from '@/lib/firebase'
import { authFetch } from '@/lib/auth-client'

export type PermissionResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-vapid-key' | 'error'; message: string }

/**
 * Requests notification permission, registers the FCM service worker,
 * retrieves a registration token, and saves it to the user's account.
 * Call this from a user gesture (e.g. a button click) — browsers may
 * ignore/ block permission prompts triggered without one.
 */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported', message: 'Push notifications are not supported in this browser.' }
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY
  if (!vapidKey) {
    return { ok: false, reason: 'no-vapid-key', message: 'Push notifications are not configured yet.' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied', message: 'Notification permission was not granted.' }
  }

  try {
    const messaging = await getFirebaseMessaging()
    if (!messaging) {
      return { ok: false, reason: 'unsupported', message: 'Push notifications are not supported in this browser.' }
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    })

    if (!token) {
      return { ok: false, reason: 'error', message: 'Could not get a notification token.' }
    }

    const res = await authFetch('/api/user/fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      return { ok: false, reason: 'error', message: 'Got a token but failed to save it.' }
    }

    return { ok: true, token }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Subscribes to foreground push messages (received while the tab is open
 * and focused — background messages are handled by the service worker
 * instead). Returns an unsubscribe function; call it in a useEffect cleanup.
 */
export async function listenForForegroundMessages(
  onMessageReceived: (payload: MessagePayload) => void,
): Promise<() => void> {
  const messaging = await getFirebaseMessaging()
  if (!messaging) return () => {}
  return onMessage(messaging, onMessageReceived)
}
