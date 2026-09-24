// Generates the VAPID keypair web push needs, printing the three env vars to
// paste into the deployment's environment (or .env for local testing).
//
// Run once per deployment: rotating the pair invalidates every existing
// subscription, so browsers re-subscribe on their next visit (the client reads
// the new public key from GET /api/push/public-key and the stale subscription
// is replaced when enableWebPush runs again).
//
// Usage: bun scripts/local-setup/generate-vapid-keys.ts
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

process.stdout.write(
  [
    "# Web push (VAPID). Keep the private key server-side only.",
    `VAPID_PUBLIC_KEY="${keys.publicKey}"`,
    `VAPID_PRIVATE_KEY="${keys.privateKey}"`,
    'VAPID_SUBJECT="mailto:hello@asocialmedia.cc"',
    "",
  ].join("\n")
);
