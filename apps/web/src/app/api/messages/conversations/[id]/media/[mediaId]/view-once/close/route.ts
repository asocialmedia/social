import { closeViewOnceGrant } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";
import { parseBoundedJsonBody } from "@/lib/messages/server";

const closeSchema = z.object({ grantId: z.uuid() });

export async function POST(request: Request) {
  const session = await getSessionFromApi();
  const user = session?.user;
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await parseBoundedJsonBody(request, 1024);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    await closeViewOnceGrant(parsed.data.grantId, user.id);
  } catch {
    return Response.json(
      { error: "Couldn't close the photo" },
      { status: 503 }
    );
  }
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
