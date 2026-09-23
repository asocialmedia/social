import { savePushSubscription } from "@asm/db";
import { isAllowedPushEndpoint } from "@asm/notifications/shared";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    auth: z.string().min(1).max(256),
    p256dh: z.string().min(1).max(512),
  }),
});

// Registers a browser push subscription. The body is the raw
// PushSubscription.toJSON() shape from the browser, so the keys are validated
// as opaque strings (the browser generates them) rather than parsed.
export async function POST(req: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = subscribeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  // Only real browser push services: the worker POSTs to this URL on every
  // notification, so an arbitrary endpoint would be an SSRF primitive.
  if (!isAllowedPushEndpoint(parsed.data.endpoint)) {
    return Response.json(
      { error: "Unsupported push service" },
      { status: 400 }
    );
  }

  await savePushSubscription({
    auth: parsed.data.keys.auth,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    userAgent: req.headers.get("user-agent"),
    userId: session.user.id,
  });

  return Response.json({ success: true });
}
