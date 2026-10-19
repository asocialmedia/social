import type {
  CommunityChatMessage,
  CommunityChatMessagePage,
  CommunityChatPermissions,
  CommunityChatRoom,
  CommunityChatThreadSummary,
  CommunityChatMemberPage,
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
  options: ApiCallOptions & {
    body?: unknown;
    method?: "DELETE" | "GET" | "PATCH" | "POST";
  }
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
  query: { after?: string; around?: string; before?: string; limit?: number },
  options: ApiCallOptions
): Promise<CommunityChatRoomResponse> {
  const params = new URLSearchParams();
  if (query.after) {
    params.set("after", query.after);
  }
  if (query.around) {
    params.set("around", query.around);
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
  input: { clientId: string; content: string; replyToId?: string },
  options: ApiCallOptions
): Promise<{ message: CommunityChatMessage }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/messages`,
    { ...options, body: input, method: "POST" }
  );
}

export function fetchCommunityChatThreads(
  slug: string,
  channelId: string,
  options: ApiCallOptions
): Promise<{ threads: CommunityChatThreadSummary[] }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(channelId)}/threads`,
    options
  );
}

export function createCommunityChatPublicThread(
  slug: string,
  channelId: string,
  input: { clientId: string; name: string; sourceMessageId: string },
  options: ApiCallOptions
): Promise<{ thread: CommunityChatRoom }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(channelId)}/threads`,
    { ...options, body: { ...input, visibility: "PUBLIC" }, method: "POST" }
  );
}

export function createCommunityChatPrivateThread(
  slug: string,
  channelId: string,
  input: {
    clientId: string;
    name: string;
    starterContent: string;
    inviteeUserIds: string[];
  },
  options: ApiCallOptions
): Promise<{ thread: CommunityChatRoom }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(channelId)}/threads`,
    { ...options, body: { ...input, visibility: "PRIVATE" }, method: "POST" }
  );
}

export type { CommunityChatMemberOption } from "@asm/messages";

export function fetchCommunityChatMembers(
  slug: string,
  query: string,
  cursor: string | null,
  options: ApiCallOptions
): Promise<CommunityChatMemberPage> {
  const params = new URLSearchParams({ limit: "20", q: query });
  if (cursor) {
    params.set("cursor", cursor);
  }
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/members?${params}`,
    options
  );
}

export function updateCommunityChatReaction(
  slug: string,
  roomId: string,
  input: { emoji: string; messageId: string; reacted: boolean },
  options: ApiCallOptions
): Promise<{ changed: boolean }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/reactions`,
    { ...options, body: input, method: "POST" }
  );
}

export function advanceCommunityChatRead(
  slug: string,
  roomId: string,
  readSequence: string,
  options: ApiCallOptions
): Promise<{ readSequence: string }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/read`,
    { ...options, body: { readSequence }, method: "POST" }
  );
}

export function mutateCommunityChatMessage(
  slug: string,
  messageId: string,
  input: { content?: string; revision: number },
  operation: "DELETE" | "EDIT",
  options: ApiCallOptions
): Promise<{ message: CommunityChatMessage }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/messages/${encodeURIComponent(messageId)}`,
    {
      ...options,
      body: input,
      method: operation === "EDIT" ? "PATCH" : "DELETE",
    }
  );
}

export function fetchCommunityChatPins(
  slug: string,
  roomId: string,
  options: ApiCallOptions
): Promise<{ messages: CommunityChatMessage[] }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/pins`,
    options
  );
}

export function updateCommunityChatPin(
  slug: string,
  roomId: string,
  input: { messageId: string; pinned: boolean },
  options: ApiCallOptions
): Promise<{ changed: boolean }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/rooms/${encodeURIComponent(roomId)}/pins`,
    { ...options, body: input, method: "PATCH" }
  );
}

export function fetchCommunityChatThreadFollowing(
  slug: string,
  threadId: string,
  options: ApiCallOptions
): Promise<{ following: boolean }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/threads/${encodeURIComponent(threadId)}/following`,
    options
  );
}

export function updateCommunityChatThreadFollowing(
  slug: string,
  threadId: string,
  following: boolean,
  options: ApiCallOptions
): Promise<{ following: boolean }> {
  return requestJson(
    `/api/communities/${encodeURIComponent(slug)}/chat/threads/${encodeURIComponent(threadId)}/following`,
    { ...options, body: { following }, method: "PATCH" }
  );
}
