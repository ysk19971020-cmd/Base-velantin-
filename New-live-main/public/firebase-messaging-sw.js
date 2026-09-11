// ---------------------------------------------------------------------------
// Firebase Cloud Messaging — background service worker
// ---------------------------------------------------------------------------
// This file is served as a static asset from /public and runs in its own
// worker context — it is NOT processed by Next.js/webpack, so it cannot
// read process.env or any NEXT_PUBLIC_ variables. The Firebase config
// below must be the SAME project as NEXT_PUBLIC_FIREBASE_* in your .env,
// entered directly here. This is standard practice for
// firebase-messaging-sw.js (per Firebase's own docs) — these values are
// publishable web config, not secrets.
//
// If you ever change Firebase projects, update BOTH this file and your
// .env — they are not automatically kept in sync.
// ---------------------------------------------------------------------------

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAn97GcUrlfYkEWAU1md6NUV6Ja4GEKM-w",
  authDomain: "hair-1846f.firebaseapp.com",
  projectId: "hair-1846f",
  storageBucket: "hair-1846f.firebasestorage.app",
  messagingSenderId: "909737537634",
  appId: "1:909737537634:web:70dec2ab7f412b27a7613b",
});

const messaging = firebase.messaging();

// Fires when a push arrives while the app is closed/backgrounded/minimized.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Valentine Express";
  const options = {
    body: payload.notification?.body || "",
    icon: "/icon.jpg",
    badge: "/icon.jpg",
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

// Clicking the notification focuses/opens the app instead of just closing it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    }),
  );
});
