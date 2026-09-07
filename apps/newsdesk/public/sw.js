// Service worker: installability, and push.
//
// Cache-less on purpose — Vercel's CDN is fast enough that offline support has never been a
// felt need, and a cache here would serve a stale feed to a news app, which is the one thing
// it must not do. If offline ever matters, reach for serwist rather than hand-rolling.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass-through. Browsers only consider the app installable when the SW is registered AND
  // has a fetch handler, even if the handler does nothing.
});

/**
 * A story landed.
 *
 * `tag` is the item id, so a re-delivery of the same story replaces the old notification
 * instead of stacking a second one — push services retry, and two buzzes for one story is
 * exactly the thing that gets notifications turned off.
 *
 * The payload is trusted only as far as it is parsed: a malformed one still shows something,
 * because a silent push on iOS costs the app its permission to send any more.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "New in the feed";
  const options = {
    body: data.body || "Tap to open the desk.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.itemId || "newsdesk",
    renotify: true,
    data: { itemId: data.itemId || null },
    // A news alert is worth a buzz; that is the whole point of it arriving now.
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Tapping the notification.
 *
 * Focuses an open tab rather than opening a second one — a news desk you have already got
 * open should come forward, not be duplicated.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const itemId = event.notification.data && event.notification.data.itemId;
  const url = itemId ? `/?item=${encodeURIComponent(itemId)}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
