import { LIFECYCLE_CAPABILITY } from "@asm/messages";
import type { ChatLifecycleSnapshot, IncognitoMessage } from "@asm/messages";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { withAuthHeaders } from "@/lib/network/auth-headers";

export class NativeChatControlError extends Error {
  readonly status: number;
  readonly expectedIndex?: number;
  constructor(message: string, status: number, expectedIndex?: number) {
    super(message);
    this.name = "NativeChatControlError";
    this.status = status;
    this.expectedIndex = expectedIndex;
  }
}
export async function nativeChatRequest<T>(
  conversationId: string,
  path: string,
  options: ApiCallOptions,
  init?: RequestInit
): Promise<T> {
  const response = await (options.baseFetch ?? fetch)(
    `${options.apiBase}/api/messages/conversations/${conversationId}/${path}`,
    {
      ...init,
      headers: withAuthHeaders(
        {
          "Content-Type": "application/json",
          "X-Chat-Capability": LIFECYCLE_CAPABILITY,
        },
        options.cookie
      ),
    }
  );
  const data = (await response.json()) as {
    error?: string;
    expectedIndex?: number;
  };
  if (!response.ok) {
    throw new NativeChatControlError(
      data.error ?? "This action couldn't be completed. Try again.",
      response.status,
      data.expectedIndex
    );
  }
  return data as T;
}
export function nativeLifecycle(
  conversationId: string,
  options: ApiCallOptions,
  signal?: AbortSignal,
  before?: string
) {
  return nativeChatRequest<ChatLifecycleSnapshot>(
    conversationId,
    `lifecycle${before ? `?before=${before}` : ""}`,
    options,
    { signal }
  );
}
export function nativeIncognitoPage(
  conversationId: string,
  sessionId: string,
  options: ApiCallOptions,
  signal?: AbortSignal,
  before?: number
) {
  return nativeChatRequest<{ messages: IncognitoMessage[]; hasMore: boolean }>(
    conversationId,
    `incognito?sessionId=${sessionId}${before === undefined ? "" : `&before=${before}`}`,
    options,
    { signal }
  );
}
