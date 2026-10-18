import type {
  CommunityChatMessage,
  CommunityChatMessagePage,
  CommunityChatPermissions,
  CommunityChatRoom,
} from "@asm/messages";

import type { ApiCallOptions } from "@/features/feed/lib/feed-api";
import { withAuthHeaders } from "@/lib/auth-headers";

export interface CommunityChatChannelsResponse {
  channels: CommunityChatRoom[];
  permissions: CommunityChatPermissions;
}

export interface CommunityChatRoomResponse extends CommunityChatMessagePage {
  permissions: CommunityChatPermissions;
  room: CommunityChatRoom;
}

export class CommunityChatApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CommunityChatApiError";
    this.status = status;
  }
}

async function requestJson<T>(
  path: string,
  options: ApiCallOptions & { body?: unknown; method?: "GET" | "POST" }
): Promise<T> {
  const baseFetch = options.baseFetch ?? fetch;
  const headers = withAuthHeaders({}, options.cookie);
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  let response: Response;
  try {
    response = await baseFetch(`${options.apiBase}${path}`, {
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method ?? "GET",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch {
    throw new CommunityChatApiError(
      "Community chat is temporarily unavailable",
      0
    );
  }
  if (!response.ok) {
    let message = "Community chat request failed";
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === "string") {
        message = payload.error;
      }
    } catch {
      message = response.statusText || message;
    }
    throw new CommunityChatApiError(message, response.status);
  }
  return (await response.json()) as T;
}

export function fetchCommunityChatChannels(
  slug: string,
  options: ApiCallOptions
): Promise<CommunityChatChannelsResponse> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/channels`,
    options
  );
}

export function fetchCommunityChatMessages(
  slug: string,
  roomId: string,
  query: { after?: string; before?: string; limit?: number },
  options: ApiCallOptions
): Promise<CommunityChatRoomResponse> {
  const params = new URLSearchParams();
  if (query.after) {
    params.set("after", query.after);
  }
  if (query.before) {
    params.set("before", query.before);
  }
  if (query.limit) {
    params.set("limit", String(query.limit));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/messages${suffix}`,
    options
  );
}

export function fetchCommunityChatMessage(
  slug: string,
  roomId: string,
  messageId: string,
  options: ApiCallOptions
): Promise<{ message: CommunityChatMessage }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}`,
    options
  );
}

export function sendCommunityChatMessage(
  slug: string,
  roomId: string,
  input: { clientId: string; content: string },
  options: ApiCallOptions
): Promise<{ message: CommunityChatMessage }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/messages`,
    { ...options, body: input, method: "POST" }
  );
}
