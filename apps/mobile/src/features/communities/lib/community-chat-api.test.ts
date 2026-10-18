import { describe, expect, test } from "bun:test";

import {
  CommunityChatApiError,
  fetchCommunityChatPins,
  fetchCommunityChatThreadFollowing,
  mutateCommunityChatMessage,
  updateCommunityChatPin,
  updateCommunityChatThreadFollowing,
} from "./community-chat-api";

function transport(status = 200) {
  const requests: {
    body: unknown;
    headers: Headers;
    method: string;
    url: string;
  }[] = [];
  const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input),
    });
    return Promise.resolve(
      Response.json(
        status === 200
          ? { following: true, message: { id: "message" }, messages: [] }
          : { error: "Message changed. Refresh before editing." },
        { status }
      )
    );
  }) as typeof fetch;
  return {
    options: {
      apiBase: "https://example.test",
      baseFetch,
      cookie: "session=test",
    },
    requests,
  };
}

describe("native community chat management", () => {
  test("sends the expected revision and safely encodes message and community identifiers", async () => {
    const { options, requests } = transport();
    await mutateCommunityChatMessage(
      "a/b",
      "message/id",
      { content: "Edited", revision: 3 },
      "EDIT",
      options
    );
    await mutateCommunityChatMessage(
      "a/b",
      "message/id",
      { revision: 4 },
      "DELETE",
      options
    );
    expect(requests.map((request) => request.method)).toEqual([
      "PATCH",
      "DELETE",
    ]);
    expect(requests[0]?.url).toBe(
      "https://example.test/api/communities/a%2Fb/chat/messages/message%2Fid"
    );
    expect(requests[0]?.body).toEqual({ content: "Edited", revision: 3 });
    expect(requests[1]?.body).toEqual({ revision: 4 });
    expect(requests[0]?.headers.get("cookie")).toBe("session=test");
  });

  test("preserves conflict details instead of treating stale edits as successful", async () => {
    const { options } = transport(409);
    try {
      await mutateCommunityChatMessage(
        "community",
        "message",
        { content: "Edited", revision: 1 },
        "EDIT",
        options
      );
      throw new Error("Expected a revision conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(CommunityChatApiError);
      if (!(error instanceof CommunityChatApiError)) {
        throw error;
      }
      expect(error.status).toBe(409);
      expect(error.message).toBe("Message changed. Refresh before editing.");
    }
  });

  test("keeps following and pins scoped to the selected thread or channel", async () => {
    const { options, requests } = transport();
    await fetchCommunityChatThreadFollowing(
      "community",
      "private/thread",
      options
    );
    await updateCommunityChatThreadFollowing(
      "community",
      "private/thread",
      false,
      options
    );
    await fetchCommunityChatPins("community", "private/thread", options);
    await updateCommunityChatPin(
      "community",
      "private/thread",
      { messageId: "message", pinned: true },
      options
    );
    expect(requests.map((request) => request.url)).toEqual([
      "https://example.test/api/communities/community/chat/threads/private%2Fthread/following",
      "https://example.test/api/communities/community/chat/threads/private%2Fthread/following",
      "https://example.test/api/communities/community/chat/rooms/private%2Fthread/pins",
      "https://example.test/api/communities/community/chat/rooms/private%2Fthread/pins",
    ]);
    expect(requests[1]?.body).toEqual({ following: false });
    expect(requests[3]?.body).toEqual({ messageId: "message", pinned: true });
  });
});
