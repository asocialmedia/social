import { resolveVapidConfig } from "@asm/notifications/server";

// Serves the VAPID public key the browser needs for PushManager.subscribe.
// Public by design (it ships to every client); the matching private key never
// leaves the server. `configured: false` tells the client push is unavailable
// on this deployment so the settings toggle can explain itself instead of
// failing silently.
export function GET() {
  const vapid = resolveVapidConfig();
  if (!vapid) {
    return Response.json(
      { configured: false, publicKey: null },
      { headers: { "cache-control": "no-store" } }
    );
  }
  return Response.json(
    { configured: true, publicKey: vapid.publicKey },
    { headers: { "cache-control": "public, max-age=3600" } }
  );
}
