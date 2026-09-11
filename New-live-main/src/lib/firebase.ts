// Firebase configuration — uses NEXT_PUBLIC_ env vars for client-side access.
// Firebase API keys are safe to expose; security is enforced by Firebase Security Rules.

import { initializeApp, getApps } from "firebase/app";
import { getAnalytics, isSupported as analyticsIsSupported } from "firebase/analytics";
import { getMessaging, isSupported as messagingIsSupported, type Messaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Firebase is optional: when the NEXT_PUBLIC_FIREBASE_* env vars aren't
// set (e.g. local dev without push notifications), skip initialization
// entirely instead of creating a broken app that throws on every use.
const isConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId
);

const app =
  isConfigured && getApps().length === 0
    ? initializeApp(firebaseConfig)
    : isConfigured
      ? getApps()[0]
      : null;

let analytics: ReturnType<typeof getAnalytics> | null = null;
if (app && typeof window !== "undefined") {
  analyticsIsSupported().then((supported) => {
    if (supported) analytics = getAnalytics(app!);
  });
}

// ---------------------------------------------------------------------------
// Web Push (Firebase Cloud Messaging)
// ---------------------------------------------------------------------------
// Messaging is only available in the browser, and only where the platform
// actually supports it (Safari/older browsers/no service-worker support
// will resolve `messagingIsSupported()` to false) — never call this during
// server-side rendering.
let messagingInstance: Messaging | null = null;

export async function getFirebaseMessaging(): Promise<Messaging | null> {
  if (typeof window === "undefined") return null;
  if (!app) return null;
  if (messagingInstance) return messagingInstance;

  const supported = await messagingIsSupported().catch(() => false);
  if (!supported) return null;

  messagingInstance = getMessaging(app);
  return messagingInstance;
}

export { app, analytics };
