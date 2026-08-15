import { beforeEach, describe, expect, mock, test } from "bun:test";

import { POST } from "./route";

type Session = { user: { id: string } } | null;
const mockGetSession = mock((): Session => ({ user: { id: "user1" } }));
type Conversation = { id: string; members: unknown[] } | null;
const mockGetConversationForUser = mock((): Conversation => ({
  id: "convo-1",
  members: [],
}));
const mockPublishTyping = mock(async () => {});

mock.module("@/lib/session", () => ({
  getSessionFromApi: mockGetSession,
}));

mock.module("@/lib/messages/server", () => ({
  getConversationForUser: mockGetConversationForUser,
}));

mock.module("@asm/db", () => ({
  publishTypingStarted: mockPublishTyping,
}));

function postTo(conversationId: string) {
  return POST(new Request(`http://localhost:3000/typing`, { method: "POST" }), {
    params: Promise.resolve({ id: conversationId }),
  });
}

describe("POST /api/messages/conversations/:id/typing", () => {
  beforeEach(() => {
    mockGetSession.mockClear();
    mockGetConversationForUser.mockClear();
    mockPublishTyping.mockClear();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await postTo("convo-1");
    expect(res.status).toBe(401);
    expect(mockPublishTyping).not.toHaveBeenCalled();
  });

  test("rejects non-members", async () => {
    mockGetConversationForUser.mockReturnValueOnce(null);
    const res = await postTo("convo-1");
    expect(res.status).toBe(404);
    expect(mockPublishTyping).not.toHaveBeenCalled();
  });

  test("publishes a typing event for the user", async () => {
    const res = await postTo("convo-1");
    expect(res.status).toBe(200);
    expect(mockGetConversationForUser).toHaveBeenCalledWith("convo-1", "user1");
    expect(mockPublishTyping).toHaveBeenCalledWith("convo-1", "user1");
  });
});
