import { saveDevicePushToken } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const registerSchema = z.object({
  platform: z.enum(["android", "ios"]),
  provider: z.enum(["expo", "fcm", "apns"]).default("expo"),
  token: z.string().min(8).max(512),
});

// Registers a native device push token. The install-token gate already covers
// this route (it is not on the exempt list), so only a verified install can
// register; the session scopes the token to its user.
export async function POST(req: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid token" }, { status: 400 });
  }

  await saveDevicePushToken({
    platform: parsed.data.platform,
    provider: parsed.data.provider,
    token: parsed.data.token,
    userId: session.user.id,
  });

  return Response.json({ success: true });
}

const unregisterSchema = z.object({
  token: z.string().min(8).max(512),
});

// Removes a native device token, scoped to the caller so one user cannot
// unregister another's device.
export async function DELETE(req: Request) {
  const session = await getSessionFromApi();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = unregisterSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid token" }, { status: 400 });
  }

  const { removeDevicePushToken } = await import("@asm/db");
  await removeDevicePushToken(parsed.data.token, session.user.id);
  return Response.json({ success: true });
}
