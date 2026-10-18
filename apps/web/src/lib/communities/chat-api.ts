import { CommunityChatError } from "@asm/db";

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
