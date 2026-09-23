// asocialmedia web push service worker.
//
// Scope: push notifications only. It deliberately does NOT intercept fetch or
// cache anything (the app already has its own offline handling via the Next.js
// router), so registering it cannot regress page loads - a bad service worker
// that caches is far worse than no service worker.
//
// The server sends a JSON payload shaped by @asm/notifications:
//   { title, body, path, tag }
// `path` is a root-relative app route the notification should open.

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title || "asocialmedia";
  const path = payload.path || "/notifications";
  const options = {
    badge: "/favicon/android-chrome-192x192.png",
    body: payload.body || "",
    data: { path },
    icon: "/favicon/android-chrome-192x192.png",
    renotify: Boolean(payload.tag),
    // The tag collapses repeats for the same post/eddie, matching the grouped
    // feed rows; renotify keeps a new activity alerting even when it replaces
    // an older one with the same tag.
    tag: payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path || "/notifications";
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      // Focus an existing tab already on the target instead of opening a
      // duplicate; otherwise reuse any open tab and navigate it.
      for (const client of clientList) {
        if (client.url === target && "focus" in client) {
          return client.focus();
        }
      }
      const [firstClient] = clientList;
      if (firstClient && "navigate" in firstClient) {
        return firstClient.navigate(target).then(() => firstClient.focus());
      }
      return self.clients.openWindow(target);
    })()
  );
});
