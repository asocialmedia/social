// Allowlist for browser push subscription endpoints. The worker POSTs to
// whatever endpoint a user registered, on every notification that user
// receives, so an arbitrary URL (http://, an internal hostname, a metadata
// IP) would turn the push fan-out into a server-side request forgery
// primitive. Only real browser push services are accepted, over HTTPS on
// the default port.

const PUSH_SERVICE_HOSTS = new Set([
  // Chrome, Edge (Chromium), Opera, Samsung Internet, Android browsers
  "fcm.googleapis.com",
  "android.googleapis.com",
  // Firefox
  "updates.push.services.mozilla.com",
]);

const PUSH_SERVICE_SUFFIXES = [
  // Safari (web.push.apple.com and regional hosts)
  ".push.apple.com",
  // Legacy Edge / Windows (WNS)
  ".notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || (url.port !== "" && url.port !== "443")) {
    return false;
  }
  if (url.username || url.password) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    PUSH_SERVICE_HOSTS.has(host) ||
    PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}
