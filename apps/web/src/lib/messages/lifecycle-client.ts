import { LIFECYCLE_CAPABILITY } from "@asm/messages";
import type { ChatLifecycleSnapshot, IncognitoMessage } from "@asm/messages";

export class ChatControlError extends Error {
  readonly status: number;
  readonly expectedIndex?: number;
  constructor(message: string, status: number, expectedIndex?: number) {
    super(message);
    this.name = "ChatControlError";
    this.status = status;
    this.expectedIndex = expectedIndex;
  }
}
export async function chatControlRequest<T>(
  conversationId: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(
    `/api/messages/conversations/${conversationId}/${path}`,
    {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Chat-Capability": LIFECYCLE_CAPABILITY,
        ...init?.headers,
      },
    }
  );
  const data = (await response.json()) as {
    error?: string;
    expectedIndex?: number;
  };
  if (!response.ok) {
    throw new ChatControlError(
      data.error ?? "This action couldn't be completed. Please try again.",
      response.status,
      data.expectedIndex
    );
  }
  return data as T;
}
export function fetchChatLifecycle(
  conversationId: string,
  signal?: AbortSignal,
  before?: string
) {
  return chatControlRequest<ChatLifecycleSnapshot>(
    conversationId,
    `lifecycle${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    { signal }
  );
}
export function mutateChatLifecycle(conversationId: string, body: object) {
  return chatControlRequest<ChatLifecycleSnapshot>(
    conversationId,
    "lifecycle",
    { body: JSON.stringify(body), method: "POST" }
  );
}
export function fetchIncognitoPage(
  conversationId: string,
  sessionId: string,
  signal?: AbortSignal,
  before?: number
) {
  return chatControlRequest<{ messages: IncognitoMessage[]; hasMore: boolean }>(
    conversationId,
    `incognito?sessionId=${sessionId}${before === undefined ? "" : `&before=${before}`}`,
    { signal }
  );
}
export interface ChatExportStatus {
  id: string;
  status: string;
  expiresAt: string;
  errorCode: string | null;
}
