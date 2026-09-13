import { verifyPasswordHash } from "@asm/auth/core";
import { consumeRateLimit, prisma } from "@asm/db";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const reauthenticationSchema = z
  .object({
    password: z.string().min(1, "Enter your current password").max(256),
  })
  .strict();

function noStoreJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    headers: { "cache-control": "no-store, private, max-age=0" },
    status,
  });
}

export async function POST(request: Request): Promise<Response> {
  const currentSession = await getSessionFromApi();
  if (!currentSession?.user || !currentSession.session) {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const input = reauthenticationSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!input.success) {
    return noStoreJson(
      { error: input.error.issues[0]?.message ?? "Invalid password" },
      400
    );
  }

  const rateLimit = await consumeRateLimit({
    bucket: "security-reauthentication",
    identifier: currentSession.user.id,
    limit: 5,
    windowSeconds: 5 * 60,
  });
  if (!rateLimit.allowed) {
    return noStoreJson(
      { error: "Too many attempts. Please try again later." },
      429
    );
  }

  const credential = await prisma.account.findFirst({
    select: { password: true },
    where: {
      providerId: "credential",
      userId: currentSession.user.id,
    },
  });
  if (!credential?.password) {
    return noStoreJson(
      {
        error:
          "Set an account password before confirming this security change.",
      },
      409
    );
  }

  const passwordMatches = await verifyPasswordHash(
    input.data.password,
    credential.password
  );
  if (!passwordMatches) {
    return noStoreJson({ error: "Incorrect password" }, 401);
  }

  const updated = await prisma.session.updateMany({
    data: { createdAt: new Date() },
    where: {
      expiresAt: { gt: new Date() },
      id: currentSession.session.id,
      userId: currentSession.user.id,
    },
  });
  if (updated.count !== 1) {
    return noStoreJson(
      { error: "Your session has ended. Sign in again." },
      401
    );
  }

  return noStoreJson({ success: true });
}
