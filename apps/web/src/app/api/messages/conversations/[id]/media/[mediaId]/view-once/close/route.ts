import { closeViewOnceGrant } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const closeSchema = z.object({ grantId: z.uuid() });

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  await closeViewOnceGrant(parsed.data.grantId, user.id);
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
