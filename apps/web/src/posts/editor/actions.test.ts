import { beforeEach, describe, expect, mock, test } from "bun:test";

import { asmDbMockBase } from "../test-support/asm-db-mock";

const AUTHOR_ID = "author-1";
const OTHER_USER_ID = "user-2";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: AUTHOR_ID },
}));

const state = {
  attachmentClaims: [] as { claimedPostId: string; mediaIds: string[] }[],
  auraAwards: [] as { recipientId: string; type: string }[],
  createdPostData: null as Record<string, unknown> | null,
  createdPostId: null as string | null,
  mentionCreates: [] as { userId: string }[],
  notifications: [] as { recipientId: string; type: string }[],
  ownedMediaIds: [] as string[],
  postsById: {} as Record<string, Record<string, unknown>>,
  scheduledCleanups: [] as string[],
};

function resetState() {
  state.attachmentClaims = [];
  state.auraAwards = [];
  state.createdPostId = null;
  state.createdPostData = null;
  state.mentionCreates = [];
  state.notifications = [];
  state.ownedMediaIds = [];
  state.postsById = {};
  state.scheduledCleanups = [];
}

const mockTx = {
  media: {
    // Only rows the fixture marks as owned-and-unclaimed resolve; the claim's
    // updateMany counts exactly those matches so shortfall paths are real.
    findMany: (args: { where?: { id?: { in?: string[] } } }) =>
      Promise.resolve(
        (args.where?.id?.in ?? [])
          .filter((id) => state.ownedMediaIds.includes(id))
          .map((id) => ({
            commentId: null,
            id,
            postId: null,
            status: "READY",
            userId: AUTHOR_ID,
          }))
      ),
    updateMany: (args: {
      data: { postId: string };
      where: { id?: { in?: string[] }; postId?: null };
    }) => {
      const requested = args.where?.id?.in ?? [];
      const claimable = requested.filter((id) =>
        state.ownedMediaIds.includes(id)
      );
      const count = args.where?.postId === null ? claimable.length : 0;
      if (count > 0) {
        state.attachmentClaims.push({
          claimedPostId: args.data.postId,
          mediaIds: requested,
        });
      }
      return Promise.resolve({ count });
    },
  },
  notification: {
    create: (args: { data: { recipientId: string; type: string } }) => {
      state.notifications.push(args.data);
      return Promise.resolve({ id: "notif-published-1", ...args.data });
    },
  },
  post: {
    create: (args: {
      data: { id: string; mentions?: { create: { userId: string }[] } };
    }) => {
      // Mentions persist through the nested create on the post row.
      const created = args.data.mentions?.create ?? [];
      state.mentionCreates.push(...created);
      state.createdPostId = args.data.id;
      state.createdPostData = args.data;
      return Promise.resolve({
        hnStoryShare: null,
        id: args.data.id,
        mentions: [],
        tags: [],
      });
    },
    findUnique: (args: {
      select?: Record<string, unknown>;
      where?: { id?: string };
    }) => {
      // A `select` marks the response-target lookup (parent, then thread root),
      // keyed by the requested id; the include-fetch passes an `include` and
      // stays null in this harness.
      if (args.select && args.where?.id) {
        return Promise.resolve(state.postsById[args.where.id] ?? null);
      }
      // The final include-fetch: null-safe in assertions via result?.id.
      return Promise.resolve(null);
    },
  },
  user: {
    // Both ids exist in the database, so ONLY the self-exclusion rule can
    // keep the author's own id out of validatedInput.mentions.
    findMany: () => Promise.resolve([{ id: AUTHOR_ID }, { id: OTHER_USER_ID }]),
  },
};

// Registered before the module under test is (dynamically) imported so its
// named bindings resolve to these fakes. The shared fixture carries every
// @asm/db export; only the prisma surface is suite-specific.
mock.module("@asm/db", () => ({
  ...asmDbMockBase,
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  // Pulled by the system-moderation-user helper actions.ts delegates to;
  // without it the static named import reaches the real barrel.
  applyFlatAward: (
    _tx: typeof mockTx,
    args: { recipientId: string; type: string }
  ) => {
    state.auraAwards.push({ recipientId: args.recipientId, type: args.type });
    return Promise.resolve({ amount: 10 });
  },
  prisma: {
    $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    // calculateAuraReward reads attachment types outside the transaction.
    media: {
      findMany: (args: { where?: { id?: { in?: string[] } } }) =>
        Promise.resolve(
          (args.where?.id?.in ?? [])
            .filter((id) => state.ownedMediaIds.includes(id))
            .map((id) => ({ id, type: "IMAGE" }))
        ),
    },
    user: {
      // Zeph persona upsert (getModerationSystemUserId).
      upsert: () =>
        Promise.resolve({
          id: "sys-zeph",
        }),
    },
  },
  redis: {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
  },
  schedulePublishedNotificationCleanup: (notificationId: string) => {
    state.scheduledCleanups.push(notificationId);
    return Promise.resolve();
  },
}));

mock.module("next/cache", () => ({
  revalidateTag: () => {},
  updateTag: () => {},
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("submitPost mention validation", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("a self-mention is stripped: no record, notification, or aura", async () => {
    const { submitPost } = await import("./actions");

    const result = await submitPost({
      content: "hello world",
      mediaIds: [],
      mentions: [AUTHOR_ID],
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    expect(result).toBeNull();
    // The author's own id never becomes a mention record...
    expect(state.mentionCreates).toEqual([]);
    // ...never generates a self-notification (only Zeph's publish receipt)...
    expect(state.notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: state.createdPostId,
        recipientId: AUTHOR_ID,
        type: "PUBLISHED",
      },
    ]);
    // ...and never mints MENTION_RECEIVED aura back to themselves. The only
    // award is the ordinary POST_CREATION stipend.
    expect(state.auraAwards).toEqual([
      { recipientId: AUTHOR_ID, type: "POST_CREATION" },
    ]);
    expect(state.scheduledCleanups).toEqual(["notif-published-1"]);
  });

  test("mentions of other users are kept and awarded normally", async () => {
    const { submitPost } = await import("./actions");

    await submitPost({
      content: "hello world",
      mediaIds: [],
      mentions: [OTHER_USER_ID],
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    expect(state.mentionCreates).toEqual([{ userId: OTHER_USER_ID }]);
    expect(state.notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: state.createdPostId,
        recipientId: AUTHOR_ID,
        type: "PUBLISHED",
      },
      {
        issuerId: AUTHOR_ID,
        postId: state.createdPostId,
        recipientId: OTHER_USER_ID,
        type: "MENTION",
      },
    ]);
    expect(state.auraAwards).toEqual([
      { recipientId: OTHER_USER_ID, type: "MENTION_RECEIVED" },
      { recipientId: AUTHOR_ID, type: "POST_CREATION" },
    ]);
  });

  test("self-mention mixed into valid mentions leaves only the valid one", async () => {
    const { submitPost } = await import("./actions");

    await submitPost({
      content: "hello world",
      mediaIds: [],
      mentions: [AUTHOR_ID, OTHER_USER_ID],
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    expect(state.mentionCreates).toEqual([{ userId: OTHER_USER_ID }]);
    expect(state.notifications).toEqual([
      {
        issuerId: "sys-zeph",
        postId: state.createdPostId,
        recipientId: AUTHOR_ID,
        type: "PUBLISHED",
      },
      {
        issuerId: AUTHOR_ID,
        postId: state.createdPostId,
        recipientId: OTHER_USER_ID,
        type: "MENTION",
      },
    ]);
    const mentionAwards = state.auraAwards.filter(
      (award) => award.type === "MENTION_RECEIVED"
    );
    expect(mentionAwards).toEqual([
      { recipientId: OTHER_USER_ID, type: "MENTION_RECEIVED" },
    ]);
  });
});

describe("submitPost attachment claiming", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("a successful claim assigns the created post id to the attachments", async () => {
    const { submitPost } = await import("./actions");
    state.ownedMediaIds = ["media-1", "media-2"];

    await submitPost({
      content: "with attachments",
      mediaIds: ["media-1", "media-2"],
      mentions: [],
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    // The post row was created first and the claim stamped that exact id.
    expect(state.createdPostId).toBeString();
    expect(state.attachmentClaims).toEqual([
      {
        claimedPostId: state.createdPostId,
        mediaIds: ["media-1", "media-2"],
      },
    ]);
  });

  test("a claim shortfall aborts with the invalid-attachments error", async () => {
    const { submitPost } = await import("./actions");
    // One of the two requested ids is not owned-and-unclaimed, so the
    // updateMany count comes back short.
    state.ownedMediaIds = ["media-1"];

    await expect(
      submitPost({
        content: "raced attachments",
        mediaIds: ["media-1", "media-2"],
        mentions: [],
        tags: [],
      } as Parameters<typeof submitPost>[0])
    ).rejects.toThrow("One or more attachments are invalid");
  });
});

describe("submitPost responses", () => {
  beforeEach(() => {
    resetState();
    mockGetSession.mockClear();
  });

  test("a direct response sets rootPostId to the parent and notifies the parent author", async () => {
    const { submitPost } = await import("./actions");
    state.postsById["post-root"] = {
      id: "post-root",
      moderated: false,
      parentPostId: null,
      rootPostId: null,
      threadTopId: null,
      userId: "parent-author",
    };

    await submitPost({
      content: "a response",
      mediaIds: [],
      mentions: [],
      parentPostId: "post-root",
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    expect(state.createdPostData?.parentPostId).toBe("post-root");
    expect(state.createdPostData?.rootPostId).toBe("post-root");
    expect(state.createdPostData?.threadTopId).toBeNull();
    // The parent author is notified once, as a REPLY.
    const replyRecipients = state.notifications
      .filter((notification) => notification.type === "REPLY")
      .map((notification) => notification.recipientId);
    expect(replyRecipients).toEqual(["parent-author"]);
  });

  test("a nested response carries the thread root and both threadTopId and rootPostId", async () => {
    const { submitPost } = await import("./actions");
    // The parent is itself a direct response of "post-root".
    state.postsById["response-1"] = {
      id: "response-1",
      moderated: false,
      parentPostId: "post-root",
      rootPostId: "post-root",
      threadTopId: null,
      userId: "response-author",
    };
    state.postsById["post-root"] = { userId: "root-author" };

    await submitPost({
      content: "a nested response",
      mediaIds: [],
      mentions: [],
      parentPostId: "response-1",
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    expect(state.createdPostData?.parentPostId).toBe("response-1");
    expect(state.createdPostData?.rootPostId).toBe("post-root");
    // The first-level parent response becomes the thread's top anchor.
    expect(state.createdPostData?.threadTopId).toBe("response-1");
    // Both the parent author and the thread-root author are notified.
    const replyRecipients = state.notifications
      .filter((notification) => notification.type === "REPLY")
      .map((notification) => notification.recipientId)
      .toSorted();
    expect(replyRecipients).toEqual(["response-author", "root-author"]);
  });

  test("a gust response is coerced to a fleet", async () => {
    const { submitPost } = await import("./actions");
    state.postsById["post-root"] = {
      id: "post-root",
      moderated: false,
      parentPostId: null,
      rootPostId: null,
      threadTopId: null,
      userId: "parent-author",
    };

    await submitPost({
      content: "not a gust",
      isGust: true,
      mediaIds: [],
      mentions: [],
      parentPostId: "post-root",
      tags: [],
    } as Parameters<typeof submitPost>[0]);

    expect(state.createdPostData?.isGust).toBe(false);
  });

  test("responding to a deleted or missing post is rejected", async () => {
    const { submitPost } = await import("./actions");

    await expect(
      submitPost({
        content: "into the void",
        mediaIds: [],
        mentions: [],
        parentPostId: "missing",
        tags: [],
      } as Parameters<typeof submitPost>[0])
    ).rejects.toThrow("no longer exists");
  });

  test("responding to a moderated post is rejected", async () => {
    const { submitPost } = await import("./actions");
    state.postsById["moderated-post"] = {
      id: "moderated-post",
      moderated: true,
      parentPostId: null,
      rootPostId: null,
      threadTopId: null,
      userId: "parent-author",
    };

    await expect(
      submitPost({
        content: "nope",
        mediaIds: [],
        mentions: [],
        parentPostId: "moderated-post",
        tags: [],
      } as Parameters<typeof submitPost>[0])
    ).rejects.toThrow("no longer available");
  });
});
