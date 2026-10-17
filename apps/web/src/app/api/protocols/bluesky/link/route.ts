import { prisma } from "@asm/db";
import {
  createBlueskySession,
  resolveBlueskyHandle,
} from "@asm/protocols/bluesky";
import { z } from "zod";

import { getSessionFromApi } from "@/lib/auth/session";

const linkBlueskySchema = z.object({
  appPassword: z.string().max(100).optional(),
  handle: z.string().min(1).max(253),
});

export async function POST(req: Request) {
  const session = await getSessionFromApi();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user.emailVerified) {
    return Response.json(
      {
        error:
          "You must verify your email address on asocialmedia before connecting an external account.",
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = linkBlueskySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const cleanHandle = parsed.data.handle.replace(/^@/, "").toLowerCase();
  const appPassword = parsed.data.appPassword?.trim() || undefined;

  let did: string;
  try {
    const resolved = await resolveBlueskyHandle(cleanHandle);
    ({ did } = resolved);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not resolve Bluesky handle. Check spelling and try again.",
      },
      { status: 400 }
    );
  }

  let accessJwt: string | undefined;
  let refreshJwt: string | undefined;
  if (appPassword) {
    try {
      const sessionResult = await createBlueskySession({
        identifier: did,
        password: appPassword,
      });
      ({ accessJwt, refreshJwt } = sessionResult);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid Bluesky App Password. Please generate one in Bluesky Settings.",
        },
        { status: 400 }
      );
    }
  }

  try {
    const existing = await prisma.orm.public.Accounts.where({
      accountId: did,
      providerId: "bluesky",
    }).first();

    if (existing && existing.userId !== session.user.id) {
      return Response.json(
        {
          error:
            "This Bluesky account is already linked to another user profile.",
        },
        { status: 409 }
      );
    }

    await (existing
      ? prisma.orm.public.Accounts.where({
          id: existing.id,
        }).updateAndCount({
          accessToken: accessJwt ?? existing.accessToken,
          issuer: cleanHandle,
          password: appPassword ?? existing.password,
          refreshToken: refreshJwt ?? existing.refreshToken,
        })
      : prisma.orm.public.Accounts.create({
          accessToken: accessJwt ?? null,
          accountId: did,
          issuer: cleanHandle,
          password: appPassword ?? null,
          providerId: "bluesky",
          refreshToken: refreshJwt ?? null,
          userId: session.user.id,
        }));

    return Response.json({
      did,
      handle: cleanHandle,
      hasSession: Boolean(accessJwt),
      success: true,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to persist account connection.",
      },
      { status: 500 }
    );
  }
}
