import type { DenError as DenErrorClass } from "@asm/db";
import { DenError } from "@asm/db";
import { createLogger } from "@asm/logger";

import { getSessionFromApi } from "@/lib/auth/session";

const logger = createLogger({ serviceName: "den-api" });

// A DenError code is a domain outcome, not a bug, so it gets a real status
// instead of the catch-all 500. The split matters to the client: 403 means "you
// are not allowed" (it stops retrying), 404 means "gone or invisible" (it drops
// the surface entirely), and 409 means "your state already says this" (it is
// safe to re-read rather than retry).
//
// There is no BLOCKED code here, and that is the point of the map rather than a
// gap in it: a block is a DM-only rule, so a den has no outcome to give it. If
// you are adding a code to `DenError` and it is a relationship between two
// accounts rather than a property of one account's relationship with THIS den,
// it almost certainly belongs to a DM.
//
// The map is `Record<DenError["code"], number>`, so it is exhaustive by
// construction: a new code that is not mapped here is a compile error rather than
// a request that falls through to a 400 nobody chose.
const DEN_ERROR_STATUS: Record<DenErrorClass["code"], number> = {
  ALREADY_MEMBER: 409,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  INVALID_ROLE: 400,
  LIMIT_REACHED: 409,
  MEMBERS_REQUIRED: 400,
  NOT_A_DEN: 409,
  NOT_FOUND: 404,
  SELF_ACTION: 409,
};

// The viewer's id, or a 401 Response when there is no session.
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

// Turns anything thrown by the den service into the API's error shape. The
// message is forwarded because every one of them is already written for a human.
export function denErrorResponse(
  error: unknown,
  context: { operation: string; denId?: string; userId?: string }
): Response {
  if (error instanceof DenError) {
    return Response.json(
      { code: error.code, error: error.message },
      { status: DEN_ERROR_STATUS[error.code] ?? 400 }
    );
  }
  logger.error(
    {
      denId: context.denId,
      error: String(error),
      operation: context.operation,
      userId: context.userId,
    },
    "den request failed"
  );
  return Response.json(
    { error: "Couldn't complete that, try again?" },
    { status: 500 }
  );
}

// Parses a JSON body, returning null rather than throwing on malformed input.
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Reads an optional string field. Returns `fallback` when the key is absent and
// `null` when it is present but not a string, so a caller can tell "leave this
// alone" from "clear this" without the two collapsing into one.
export function optionalStringField(
  body: Record<string, unknown> | null,
  key: string
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (!body || !(key in body)) {
    return { ok: true, value: undefined };
  }
  const value = body[key];
  if (value === null) {
    return { ok: true, value: null };
  }
  if (typeof value !== "string") {
    return { ok: false };
  }
  return { ok: true, value };
}
