import type { CommunityError } from "@asm/db";
import { CommunityError as CommunityErrorClass } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "community-api" });

// A CommunityError code is a domain outcome, not a bug, so it gets a real
// status instead of the catch-all 500. The split matters to the native client:
// 403 means "you are not allowed" (it hides the gate and stops retrying),
// 404 means "gone or invisible" (it drops the surface entirely), and 409 means
// "your state already says this" (it is safe to re-read rather than retry).
const COMMUNITY_ERROR_STATUS: Record<CommunityError["code"], number> = {
  ALREADY_MEMBER: 409,
  AURA_TOO_LOW: 403,
  FORBIDDEN: 403,
  INVALID_ROLE: 400,
  INVALID_SLUG: 400,
  LIMIT_REACHED: 409,
  MOD_LIMIT_REACHED: 409,
  NOT_FOUND: 404,
  SLUG_TAKEN: 409,
};

/** The viewer's id, or a 401 Response when there is no session. */
export async function requireApiUser(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await getSessionFromApi();
  const userId = session?.user?.id;
  if (!userId) {
    return {
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, userId };
}

/**
 * Turns anything thrown by a community service into the API's error shape.
 * The message is forwarded because every one of them is already written for a
 * human (they are the same strings the server actions surface), and the native
 * client shows them verbatim.
 */
export function communityErrorResponse(
  error: unknown,
  context: { operation: string; slug: string; userId?: string }
): Response {
  if (error instanceof CommunityErrorClass) {
    return Response.json(
      { code: error.code, error: error.message },
      { status: COMMUNITY_ERROR_STATUS[error.code] ?? 400 }
    );
  }
  // A zod failure from a wizard payload means the client sent a shape this
  // server does not accept. 400 is correct and the message names the field.
  if (error instanceof Error && error.name === "ZodError") {
    return Response.json({ error: error.message }, { status: 400 });
  }
  logger.error(
    {
      error: String(error),
      operation: context.operation,
      slug: context.slug,
      userId: context.userId,
    },
    "community request failed"
  );
  return Response.json(
    { error: "Couldn't complete that, try again?" },
    { status: 500 }
  );
}

/** Parses a JSON body, returning null rather than throwing on malformed input. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
