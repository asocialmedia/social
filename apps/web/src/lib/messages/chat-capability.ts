import { LIFECYCLE_CAPABILITY } from "@asm/messages";

export function supportsChatLifecycle(request: Request): boolean {
  return (
    request.headers.get("X-Chat-Capability") === LIFECYCLE_CAPABILITY ||
    new URL(request.url).searchParams.get("capability") === LIFECYCLE_CAPABILITY
  );
}

export function chatCapabilityError(
  request: Request,
  conversation: { retentionVersion?: number }
): Response | null {
  if (!conversation.retentionVersion || supportsChatLifecycle(request)) {
    return null;
  }
  return Response.json(
    {
      code: "CHAT_UPDATE_REQUIRED",
      error: "Update the app to open this conversation safely.",
    },
    { headers: { "Cache-Control": "private, no-store" }, status: 426 }
  );
}

export function fetchChatApi(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Chat-Capability", LIFECYCLE_CAPABILITY);
  return globalThis.fetch(input, { ...init, headers });
}
