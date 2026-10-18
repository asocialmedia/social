import { CommunityChatError } from "@asm/db";
import { communityChatFeatureEnabled } from "@asm/messages";

export function communityChatErrorResponse(error: unknown): Response {
  if (!(error instanceof CommunityChatError)) {
    return Response.json(
      { error: "Couldn't process this community chat request" },
      { status: 500 }
    );
  }
  const statusByCode = {
    CONFLICT: 409,
    FORBIDDEN: 403,
    INVALID: 400,
    NOT_FOUND: 404,
    SLOW_MODE: 429,
  } as const;
  const status = statusByCode[error.code];
  return Response.json({ code: error.code, error: error.message }, { status });
}

export function communityChatAvailabilityResponse(
  write = false
): Response | null {
  if (
    !communityChatFeatureEnabled(
      process.env.COMMUNITY_CHAT_ENABLED,
      process.env.NODE_ENV
    )
  ) {
    return Response.json(
      { error: "Community chat is unavailable" },
      { status: 404 }
    );
  }
  if (
    write &&
    !communityChatFeatureEnabled(
      process.env.COMMUNITY_CHAT_WRITES_ENABLED,
      process.env.NODE_ENV
    )
  ) {
    return Response.json(
      { code: "READ_ONLY", error: "Community chat is temporarily read-only" },
      { headers: { "retry-after": "60" }, status: 503 }
    );
  }
  return null;
}
