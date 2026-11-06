import { ChatLifecycleError } from "@asm/db";

const copy: Record<string, string> = {
  CHAT_NOT_FOUND: "This conversation is unavailable.",
  CHAT_STATE_CHANGED: "Chat settings changed. Refresh and try again.",
  END_INCOGNITO_FIRST: "End incognito before deleting your chat history.",
  INCOGNITO_DM_ONLY: "Incognito is available in direct messages.",
  INVALID_CURSOR: "Refresh the session history and try again.",
  INVALID_RETENTION: "Choose Off or 24 hours.",
  RETENTION_FORBIDDEN:
    "Only the den owner or an Elder can change this setting.",
};
export function lifecycleError(error: unknown): Response {
  if (error instanceof ChatLifecycleError) {
    return Response.json(
      {
        code: error.code,
        error:
          copy[error.code] ?? "Chat settings changed. Refresh and try again.",
      },
      { headers: { "Cache-Control": "no-store" }, status: error.status }
    );
  }
  console.error("Chat lifecycle request failed");
  return Response.json(
    {
      code: "CHAT_UNAVAILABLE",
      error: "Chat controls are temporarily unavailable. Please try again.",
    },
    {
      headers: { "Cache-Control": "no-store", "Retry-After": "3" },
      status: 503,
    }
  );
}
