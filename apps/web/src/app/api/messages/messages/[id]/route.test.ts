// Two tests below re-run the SAME handler against a shared module-level mock, so
// their reads are sequential by construction: each pass rewrites the mock and the
// next pass reads what that rewrite produced. Running them in parallel would
// interleave the writes with the reads, and the assertions would be about nothing.
// oxlint-disable no-await-in-loop
import { beforeEach, describe, expect, mock, test } from "bun:test";

import { blockedSendPeer } from "@/lib/messages/blocks";
import {
  DEN_MESSAGE_DELETE_RATE_LIMIT,
  DEN_MESSAGE_EDIT_RATE_LIMIT,
} from "@/lib/messages/den-rate-limit";
import { messageRouteLimiter } from "@/lib/messages/test-support/route-limiter-probe";

import { DELETE, PATCH } from "./route";

const mockGetSession = mock(() => ({ user: { id: "user1" } }));
const mockAreBlocked = mock(() => false);
const mockIsWithinEditWindow = mock(() => true);
type MutationResult =
  | {
      changeSequence: number;
      outboxId: string;
      revision: number;
      status: "updated";
    }
  | {
      status:
        | "already-deleted"
        | "edit-expired"
        | "not-found"
        | "revision-conflict";
    };

// The mutation helper owns the message revision and durable search outbox transaction.
const mockMessageFirst = mock((): unknown => null);
const mockCommitSearchMutation = mock(
  (_input: unknown): Promise<MutationResult> =>
    Promise.resolve({
      changeSequence: 42,
      outboxId: "outbox-1",
      revision: 2,
      status: "updated",
    })
);
const mockEnqueueSearchOutbox = mock(() => Promise.resolve());
const mockPublishEdited = mock(() => {
  limiter.service("publish-edited");
  return Promise.resolve();
});
const mockPublishDeleted = mock(() => {
  limiter.service("publish-deleted");
  return Promise.resolve();
});
const mockResetUnreadMessageCache = mock(() => Promise.resolve());

// A DM, which is the shape every pre-existing case in this file used. `_type` is
// the field the route never selected before: without it a den and a DM are
// indistinguishable to the block rule, which is the whole of FIX A.
const dmConversation = {
  _type: "DM" as const,
  messageConversationMembers: [{ userId: "user1" }, { userId: "user2" }],
};

const baseMessage = {
  conversation: dmConversation,
  conversationId: "convo-1",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  deletedAt: null,
  id: "msg-1",
  revision: 1,
  senderId: "user1",
};

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

// The limiter this route charges. Mocked explicitly because bun's
// `mock.module("@asm/db")` does not reach the rules module's own binding on it,
// and an unmocked limiter spends real Redis budget from the test suite.
const limiter = messageRouteLimiter();
mock.module("@/lib/messages/den-rate-limit", () => limiter.module);

mock.module("@/lib/messages/server", () => ({
  areBlocked: mockAreBlocked,
  // The real predicate, not a stand-in: this file's whole point is that the route
  // asks the shared question rather than its own. It is expressed here over the
  // shared `blockedSendPeer` for the same reason.
  isBlockedFromConversation: async (
    conversation: { members: { userId: string }[]; type: "DM" | "DEN" },
    userId: string
  ) => {
    const peer = blockedSendPeer(conversation, userId);
    if (!peer) {
      return false;
    }
    return await mockAreBlocked(userId, peer);
  },
  messageSenderSelect: () => ({ sender: true }),
  parseJsonBody: async (request: Request) => {
    try {
      return await request.json();
    } catch {
      return null;
    }
  },
}));

mock.module("@/lib/messages/edit-window", () => ({
  MAX_MESSAGE_CIPHERTEXT_LENGTH: 100_000,
  MESSAGE_EDIT_WINDOW_MS: 12 * 60 * 60 * 1000,
  isWithinEditWindow: mockIsWithinEditWindow,
}));

mock.module("@asm/db", () => ({
  commitMessageSearchMutation: mockCommitSearchMutation,
  enqueueMessageSearchOutbox: mockEnqueueSearchOutbox,
  fromPrismaDateTime: (value: Date) => value,
  prisma: {
    orm: {
      public: {
        Messages: {
          include: () => ({ first: () => mockMessageFirst() }),
          select: () => ({ where: () => ({ first: mockMessageFirst }) }),
          where: () => {
            const withConversation = {
              first: mockMessageFirst,
              include: () => withConversation,
              where: () => withConversation,
            };
            return {
              ...withConversation,
            };
          },
        },
      },
    },
  },
  publishMessageDeleted: mockPublishDeleted,
  publishMessageEdited: mockPublishEdited,
  toPrismaDateTime: (value: Date) => value,
  unreadMessageCache: { reset: mockResetUnreadMessageCache },
}));

function url() {
  return "http://localhost:3000/api/messages/messages/msg-1";
}

function patchRequest(body: unknown) {
  return new Request(url(), {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

const params = { params: Promise.resolve({ id: "msg-1" }) };

describe("PATCH /api/messages/messages/:id", () => {
  beforeEach(() => {
    mockMessageFirst.mockReset();
    mockCommitSearchMutation.mockReset();
    mockCommitSearchMutation.mockImplementation(() =>
      Promise.resolve({
        changeSequence: 42,
        outboxId: "outbox-1",
        revision: 2,
        status: "updated",
      })
    );
    mockEnqueueSearchOutbox.mockReset();
    mockEnqueueSearchOutbox.mockImplementation(() => Promise.resolve());
    mockPublishEdited.mockReset();
    mockPublishDeleted.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
    mockIsWithinEditWindow.mockReset();
    mockIsWithinEditWindow.mockImplementation(() => true);
    mockPublishEdited.mockImplementation(() => {
      limiter.service("publish-edited");
      return Promise.resolve();
    });
    limiter.reset();
    // First findUnique resolves the target, second returns the updated row.
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      ciphertext: "new-cipher",
      editedAt: new Date("2026-01-01T01:00:00.000Z"),
      iv: "new-iv",
    });
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(401);
  });

  test("404s an unknown message", async () => {
    mockMessageFirst.mockReset();
    mockMessageFirst.mockReturnValueOnce(null);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(404);
  });

  test("refuses to edit someone else's message", async () => {
    mockMessageFirst.mockReset();
    mockMessageFirst.mockReturnValueOnce({ ...baseMessage, senderId: "user2" });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(403);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
  });

  test("rejects a deleted message", async () => {
    mockMessageFirst.mockReset();
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      deletedAt: new Date(),
    });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
  });

  test("rejects an edit past the window", async () => {
    mockIsWithinEditWindow.mockReturnValueOnce(false);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
  });

  test("rejects an invalid payload", async () => {
    const res = await PATCH(patchRequest({ iv: "i" }), params);
    expect(res.status).toBe(400);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
  });

  test("rejects an oversized ciphertext", async () => {
    const res = await PATCH(
      patchRequest({ ciphertext: "x".repeat(100_001), iv: "i" }),
      params
    );
    expect(res.status).toBe(413);
  });

  test("blocks an edit after either party blocks", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(403);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
  });

  test("refuses a blocked pair in a DM, which is the only place a block bites", async () => {
    // The DM half of the fix, stated as its own case so a change that dropped
    // the gate entirely could not pass by looking at the den cases below.
    mockMessageFirst.mockReset();
    mockAreBlocked.mockReturnValue(true);
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(403);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
  });

  test("lets a member edit their own message in a den, whoever is first in the roster", async () => {
    // The defect. `user2` is blocked with the sender and is the first other
    // member the roster returns, which is the arrangement that used to refuse the
    // edit. A den is a room, not a pair: nobody in it loses their ability to
    // correct their own words because of a disagreement between two of the others,
    // and which member the query happens to return first is not a fact about the
    // block at all.
    mockMessageFirst.mockReset();
    mockAreBlocked.mockImplementation(() => true);
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      conversation: {
        _type: "DEN",
        messageConversationMembers: [
          { userId: "user1" },
          { userId: "user2" },
          { userId: "user3" },
          { userId: "user4" },
        ],
      },
    });
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      ciphertext: "new-cipher",
      editedAt: new Date("2026-01-01T01:00:00.000Z"),
      iv: "new-iv",
    });
    const res = await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockCommitSearchMutation).toHaveBeenCalledTimes(1);
    expect(mockPublishEdited).toHaveBeenCalledTimes(1);
  });

  test("admits a den edit the same way whichever member the roster returns first", async () => {
    // The row-order independence, as its own assertion rather than a property of
    // the case above: reversing the roster must not change the answer. Before the
    // fix this was the difference between 200 and 403.
    for (const roster of [
      [{ userId: "user2" }, { userId: "user1" }, { userId: "user3" }],
      [{ userId: "user3" }, { userId: "user1" }, { userId: "user2" }],
      [{ userId: "user1" }, { userId: "user3" }, { userId: "user2" }],
    ]) {
      mockMessageFirst.mockReset();
      mockCommitSearchMutation.mockReset();
      mockCommitSearchMutation.mockImplementation(() =>
        Promise.resolve({
          changeSequence: 42,
          outboxId: "outbox-1",
          revision: 2,
          status: "updated",
        })
      );
      mockPublishEdited.mockReset();
      mockAreBlocked.mockImplementation(() => true);
      mockMessageFirst.mockReturnValueOnce({
        ...baseMessage,
        conversation: {
          _type: "DEN",
          messageConversationMembers: roster,
        },
      });
      mockMessageFirst.mockReturnValueOnce(baseMessage);
      const res = await PATCH(
        patchRequest({ ciphertext: "c", iv: "i" }),
        params
      );
      expect(res.status).toBe(200);
    }
  });

  test("rewrites the ciphertext in place and publishes the edit", async () => {
    const res = await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockCommitSearchMutation).toHaveBeenCalledTimes(1);
    const mutationInput = mockCommitSearchMutation.mock.calls[0]?.[0] as {
      editWindowStart: Date;
      editedAt: Date;
    };
    expect(mockCommitSearchMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        ciphertext: "new-cipher",
        conversationId: "convo-1",
        expectedRevision: 1,
        iv: "new-iv",
        kind: "upsert",
        messageId: "msg-1",
        senderId: "user1",
      })
    );
    expect(mutationInput.editWindowStart.getTime()).toBe(
      mutationInput.editedAt.getTime() - 12 * 60 * 60 * 1000
    );
    expect(mockEnqueueSearchOutbox).toHaveBeenCalledWith("outbox-1");
    expect(mockPublishEdited).toHaveBeenCalledTimes(1);
    expect(mockPublishEdited).toHaveBeenCalledWith(
      "convo-1",
      expect.objectContaining({ ciphertext: "new-cipher" })
    );
  });

  test("409s when the row was deleted between the read and the write", async () => {
    mockCommitSearchMutation.mockResolvedValueOnce({
      status: "revision-conflict",
    });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
    expect(mockPublishEdited).not.toHaveBeenCalled();
  });

  test("does not publish an edit when the server-side edit window expires", async () => {
    mockCommitSearchMutation.mockResolvedValueOnce({ status: "edit-expired" });
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(409);
    expect(mockEnqueueSearchOutbox).not.toHaveBeenCalled();
    expect(mockPublishEdited).not.toHaveBeenCalled();
  });

  test("keeps a committed edit successful when Redis enqueue fails", async () => {
    mockEnqueueSearchOutbox.mockImplementationOnce(() =>
      Promise.reject(new Error("redis down"))
    );
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    await Bun.sleep(0);
    expect(res.status).toBe(200);
    expect(mockPublishEdited).toHaveBeenCalledTimes(1);
  });

  test("keeps the edit successful when the publish fails", async () => {
    mockPublishEdited.mockImplementationOnce(() =>
      Promise.reject(new Error("redis down"))
    );
    const res = await PATCH(patchRequest({ ciphertext: "c", iv: "i" }), params);
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/messages/messages/:id", () => {
  beforeEach(() => {
    mockMessageFirst.mockReset();
    mockCommitSearchMutation.mockReset();
    mockCommitSearchMutation.mockImplementation(() =>
      Promise.resolve({
        changeSequence: 42,
        outboxId: "outbox-1",
        revision: 2,
        status: "updated",
      })
    );
    mockEnqueueSearchOutbox.mockReset();
    mockEnqueueSearchOutbox.mockImplementation(() => Promise.resolve());
    mockPublishDeleted.mockReset();
    mockResetUnreadMessageCache.mockReset();
    mockResetUnreadMessageCache.mockImplementation(() => Promise.resolve());
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
    limiter.reset();
  });

  test("soft-deletes and publishes", async () => {
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(mockCommitSearchMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "convo-1",
        expectedRevision: 1,
        kind: "delete",
        messageId: "msg-1",
        senderId: "user1",
      })
    );
    expect(mockEnqueueSearchOutbox).toHaveBeenCalledWith("outbox-1");
    expect(mockPublishDeleted).toHaveBeenCalledTimes(1);
    expect(
      mockResetUnreadMessageCache.mock.calls.map(([userId]) => userId)
    ).toEqual(["user1", "user2"]);
  });

  test("refuses to delete someone else's message for everyone", async () => {
    // "Delete for everyone" is sender-only; a receiver must use the per-user
    // hide endpoint instead.
    mockMessageFirst.mockReturnValueOnce({ ...baseMessage, senderId: "user2" });
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(403);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
    expect(mockPublishDeleted).not.toHaveBeenCalled();
  });

  test("requires auth", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(401);
  });

  test("refuses a blocked pair in a DM", async () => {
    mockAreBlocked.mockReturnValueOnce(true);
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(403);
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
    expect(mockPublishDeleted).not.toHaveBeenCalled();
  });

  test("lets a member delete their own message in a den, whoever is first in the roster", async () => {
    // Same defect as the edit, on the other write path. `user2` is blocked with
    // the sender and sorts first, so this is the exact arrangement that made
    // "delete my own message" depend on row order.
    mockAreBlocked.mockImplementation(() => true);
    mockMessageFirst.mockReturnValueOnce({
      ...baseMessage,
      conversation: {
        _type: "DEN",
        messageConversationMembers: [
          { userId: "user1" },
          { userId: "user2" },
          { userId: "user3" },
        ],
      },
    });
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(mockCommitSearchMutation).toHaveBeenCalledTimes(1);
    expect(mockPublishDeleted).toHaveBeenCalledTimes(1);
  });

  test("admits a den delete the same way whichever member the roster returns first", async () => {
    for (const roster of [
      [{ userId: "user2" }, { userId: "user1" }],
      [{ userId: "user1" }, { userId: "user2" }],
      [{ userId: "user3" }, { userId: "user2" }, { userId: "user1" }],
    ]) {
      mockMessageFirst.mockReset();
      mockCommitSearchMutation.mockReset();
      mockCommitSearchMutation.mockImplementation(() =>
        Promise.resolve({
          changeSequence: 42,
          outboxId: "outbox-1",
          revision: 2,
          status: "updated",
        })
      );
      mockPublishDeleted.mockReset();
      mockAreBlocked.mockImplementation(() => true);
      mockMessageFirst.mockReturnValueOnce({
        ...baseMessage,
        conversation: {
          _type: "DEN",
          messageConversationMembers: roster,
        },
      });
      const res = await DELETE(
        new Request(url(), { method: "DELETE" }),
        params
      );
      expect(res.status).toBe(200);
    }
  });
});

describe("/api/messages/messages/:id rate limit", () => {
  beforeEach(() => {
    mockMessageFirst.mockReset();
    mockCommitSearchMutation.mockReset();
    mockCommitSearchMutation.mockImplementation(() =>
      Promise.resolve({
        changeSequence: 42,
        outboxId: "outbox-1",
        revision: 2,
        status: "updated",
      })
    );
    mockPublishEdited.mockReset();
    mockPublishDeleted.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockImplementation(() => ({ user: { id: "user1" } }));
    mockAreBlocked.mockReset();
    mockAreBlocked.mockImplementation(() => false);
    mockIsWithinEditWindow.mockReset();
    mockIsWithinEditWindow.mockImplementation(() => true);
    mockPublishEdited.mockImplementation(() => {
      limiter.service("publish-edited");
      return Promise.resolve();
    });
    mockPublishDeleted.mockImplementation(() => {
      limiter.service("publish-deleted");
      return Promise.resolve();
    });
    limiter.reset();
  });

  test("an edit spends the edit budget, per account", async () => {
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    const res = await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_EDIT_RATE_LIMIT.bucket,
    ]);
    expect(limiter.chargedIdentifiers).toEqual(["user1"]);
  });

  test("429s with a retry-after and rewrites nothing when the edit is over budget", async () => {
    // The edit window is twelve hours wide and a ciphertext can be 100KB, so an
    // unbounded budget is 100KB of writes times however many times a script
    // feels like over half a day.
    limiter.setDenied(true);
    const res = await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockMessageFirst).not.toHaveBeenCalled();
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
    expect(mockPublishEdited).not.toHaveBeenCalled();
  });

  test("charges the edit limiter before it reads the row", async () => {
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    await PATCH(
      patchRequest({ ciphertext: "new-cipher", iv: "new-iv" }),
      params
    );
    expect(limiter.order[0]).toBe(
      `consume:${DEN_MESSAGE_EDIT_RATE_LIMIT.bucket}`
    );
    expect(limiter.order).toContain("service:publish-edited");
  });

  test("a delete spends the delete budget, not the edit budget", async () => {
    mockMessageFirst.mockReturnValueOnce(baseMessage);
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(200);
    expect(limiter.chargedBuckets).toEqual([
      DEN_MESSAGE_DELETE_RATE_LIMIT.bucket,
    ]);
  });

  test("429s with a retry-after and soft-deletes nothing when over budget", async () => {
    limiter.setDenied(true);
    const res = await DELETE(new Request(url(), { method: "DELETE" }), params);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(mockCommitSearchMutation).not.toHaveBeenCalled();
    expect(mockPublishDeleted).not.toHaveBeenCalled();
  });

  test("the two methods cannot starve each other", () => {
    // The reasoning `den-details` versus `den-roles` already established: an
    // edit rewrites up to 100KB and a delete rewrites one timestamp, so a shared
    // budget would let an edit storm lock somebody out of removing their own
    // message. Asserted as the budgets rather than the bucket names so renaming
    // a bucket does not quietly re-merge them.
    expect(DEN_MESSAGE_DELETE_RATE_LIMIT.bucket).not.toBe(
      DEN_MESSAGE_EDIT_RATE_LIMIT.bucket
    );
    expect(DEN_MESSAGE_DELETE_RATE_LIMIT.limit).toBeGreaterThan(
      DEN_MESSAGE_EDIT_RATE_LIMIT.limit
    );
  });
});
