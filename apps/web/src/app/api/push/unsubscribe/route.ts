import { removePushSubscription } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

// Removes a browser push subscription. Scoped to the caller's own userId so an
// endpoint leaked from another account cannot be unsubscribed.
export async function POST(req: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = unsubscribeSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  await removePushSubscription(parsed.data.endpoint, session.user.id);
  return Response.json({ success: true });
}
