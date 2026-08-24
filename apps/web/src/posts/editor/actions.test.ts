import { beforeEach, describe, expect, mock, test } from "bun:test";

const AUTHOR_ID = "author-1";
const OTHER_USER_ID = "user-2";
const POST_ID = "new-post-1";

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: AUTHOR_ID },
}));

const state = {
  auraAwards: [] as { recipientId: string; type: string }[],
  mentionCreates: [] as unknown,
  notifications: [] as { recipientId: string; type: string }[],
};

function resetState() {
  state.auraAwards = [];
  state.mentionCreates = [];
  state.notifications = [];
}

const mockTx = {
  media: {
    findMany: () => Promise.resolve([]),
  },
  notification: {
    create: (args: { data: { recipientId: string; type: string } }) => {
      state.notifications.push(args.data);
      return Promise.resolve({});
    },
  },
  post: {
    create: (args: {
      data: { mentions?: { create: { userId: string }[] } };
    }) => {
      // Mentions persist through the nested create on the post row.
      const created = args.data.mentions?.create ?? [];
      state.mentionCreates.push(...created);
      return Promise.resolve({
        hnStoryShare: null,
        id: POST_ID,
        mentions: [],
        tags: [],
      });
    },
    findUnique: () =>
      // The final include-fetch: null-safe in assertions via result?.id.
      Promise.resolve(null),
  },
  user: {
    // Both ids exist in the database, so ONLY the self-exclusion rule can
    // keep the author's own id out of validatedInput.mentions.
    findMany: () => Promise.resolve([{ id: AUTHOR_ID }, { id: OTHER_USER_ID }]),
  },
};

// Registered before the module under test is (dynamically) imported so its
// named bindings resolve to these fakes.
mock.module("@asm/db", () => ({
  ATTACHMENT_BONUSES: {},
  HN_SHARE_BONUS_AURA: 15,
  MENTION_RECEIVED_AURA: 10,
  POST_CREATION_AURA: 10,
  POST_CREATION_MAX_AURA: 150,
  applyFlatAward: (
    _tx: typeof mockTx,
    args: { recipientId: string; type: string }
  ) => {
    state.auraAwards.push({ recipientId: args.recipientId, type: args.type });
    return Promise.resolve({ amount: 10 });
  },
  cancelMediaCleanup: () => Promise.resolve(),
  enqueueNotificationCreated: () => Promise.resolve(),
  enqueueShitposterCheck: () => Promise.resolve(),
  getPostDataInclude: () => ({ user: true }),
  invalidateAuraSignals: () => Promise.resolve(),
  postViewsCache: {},
  prisma: {
    $transaction: (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
  },
  tagCache: {},
}));

mock.module("next/cache", () => ({
  revalidateTag: () => {},
  updateTag: () => {},
}));

mock.module("@/lib/session", () => ({
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
    // ...never generates a self-notification...
    expect(state.notifications).toEqual([]);
    // ...and never mints MENTION_RECEIVED aura back to themselves. The only
    // award is the ordinary POST_CREATION stipend.
    expect(state.auraAwards).toEqual([
      { recipientId: AUTHOR_ID, type: "POST_CREATION" },
    ]);
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
        issuerId: AUTHOR_ID,
        postId: POST_ID,
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
        issuerId: AUTHOR_ID,
        postId: POST_ID,
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
