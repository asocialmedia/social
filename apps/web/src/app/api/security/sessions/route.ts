import {
  and,
  fromPrismaDateTime,
  prisma,
  publishSessionRevocation,
  toPrismaDateTime,
} from "@asm/db";
import { z } from "zod";

import { authInternalHeaders, getAuthBaseUrl } from "@/lib/auth/auth-internal";
import { getSessionFromApi } from "@/lib/auth/session";

const sessionActionSchema = z
  .object({
    action: z.enum(["all", "other-sessions", "single"]),
    sessionId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "single" && !value.sessionId) {
      context.addIssue({
        code: "custom",
        message: "A session is required",
        path: ["sessionId"],
      });
    }
  });

function noStoreJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    headers: { "cache-control": "no-store, private, max-age=0" },
    status,
  });
}

// Session discovery is safe for any authenticated account owner. Better Auth's
// built-in list endpoint requires a fresh session, which wrongly turns this
// read-only dashboard into a 403 after its default 24-hour freshness window.
// Keep the destructive controls behind Better Auth's own fresh-session guard.
export async function GET(): Promise<Response> {
  const currentSession = await getSessionFromApi();
  if (!currentSession?.user) {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  try {
    const sessions = await prisma.orm.public.Sessions.select(
      "country",
      "createdAt",
      "expiresAt",
      "id",
      "ipAddress",
      "updatedAt",
      "userAgent"
    )
      .where((session) =>
        and(
          session.expiresAt.gt(toPrismaDateTime(new Date())),
          session.userId.eq(currentSession.user.id)
        )
      )
      .orderBy((session) => session.updatedAt.desc())
      .all()
      .then((rows) =>
        rows.map((session) => ({
          ...session,
          createdAt: fromPrismaDateTime(session.createdAt),
          expiresAt: fromPrismaDateTime(session.expiresAt),
          updatedAt: fromPrismaDateTime(session.updatedAt),
        }))
      );
    return noStoreJson(sessions);
  } catch (error) {
    console.error("Failed to list active sessions", error);
    return noStoreJson({ error: "Couldn’t load active sessions" }, 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const currentSession = await getSessionFromApi();
  if (!currentSession?.user) {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const input = sessionActionSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!input.success) {
    return noStoreJson({ error: "Invalid session action" }, 400);
  }

  let endpoint = "/api/auth/revoke-sessions";
  let body: { token: string } | undefined;
  let event: { retainedSessionId?: string; revokedSessionId?: string } = {};

  if (input.data.action === "other-sessions") {
    endpoint = "/api/auth/revoke-other-sessions";
    event = { retainedSessionId: currentSession.session.id };
  } else if (input.data.action === "single") {
    const target = await prisma.orm.public.Sessions.select("id", "token")
      .where((session) =>
        and(
          session.expiresAt.gt(toPrismaDateTime(new Date())),
          session.id.eq(input.data.sessionId ?? ""),
          session.userId.eq(currentSession.user.id)
        )
      )
      .first();
    if (!target) {
      return noStoreJson({ error: "Session not found" }, 404);
    }
    endpoint = "/api/auth/revoke-session";
    body = { token: target.token };
    event = { revokedSessionId: target.id };
  }

  const cookie = request.headers.get("cookie") ?? "";
  const upstream = await fetch(`${getAuthBaseUrl()}${endpoint}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: authInternalHeaders({
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    }),
    method: "POST",
  });

  if (!upstream.ok) {
    if (upstream.status === 403) {
      return noStoreJson(
        {
          error:
            "For your protection, sign in again before managing signed-in devices.",
        },
        403
      );
    }
    return noStoreJson(
      { error: "Couldn’t update active sessions" },
      upstream.status
    );
  }

  await publishSessionRevocation(currentSession.user.id, event);
  return noStoreJson({ success: true });
}
