import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post-1";
const USER_ID = "user-1";

const deletedEvents: { eventType: string; postId: string; userId: string }[] =
  [];
const createdEvents: { eventType: string; postId: string; userId: string }[] =
  [];
const invalidatedUsers: string[] = [];

let postExists = true;

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const tx = {
  recommendationEvent: {
    create: (args: {
      data: { eventType: string; postId: string; userId: string };
    }): void => {
      createdEvents.push(args.data);
    },
    deleteMany: (args: {
      where: { eventType: string; postId: string; userId: string };
    }): void => {
      deletedEvents.push(args.where);
    },
  },
};

const mockPrisma = {
  $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  post: {
    findUnique: (args: { where: { id: string } }) =>
      postExists && args.where.id === POST_ID ? { id: POST_ID } : null,
  },
  recommendationEvent: {
    deleteMany: (args: {
      where: { eventType: string; postId: string; userId: string };
    }): void => {
      deletedEvents.push(args.where);
    },
  },
};

mock.module("@asm/db", () => ({
  invalidateFypProfile: (userId: string): Promise<void> => {
    invalidatedUsers.push(userId);
    return Promise.resolve();
  },
  logger: {},
  prisma: mockPrisma,
}));

mock.module("@asm/logger", () => ({
  createLogger: () => ({ error: () => {}, info: () => {}, warn: () => {} }),
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("recommendation hide actions", () => {
  beforeEach(() => {
    createdEvents.length = 0;
    deletedEvents.length = 0;
    invalidatedUsers.length = 0;
    postExists = true;
    mockGetSession.mockImplementation(() => ({ user: { id: USER_ID } }));
  });

  test("hide deletes any prior dismissal then writes exactly one event", async () => {
    const { hideRecommendationPost } = await import("./actions");
    await hideRecommendationPost(POST_ID);

    // Idempotent write: the stale row is cleared before the fresh one, so a
    // repeat dismiss (or a two-tab race) cannot stack duplicates that would eat
    // the exclusion cap.
    expect(deletedEvents).toEqual([
      { eventType: "NOT_INTERESTED", postId: POST_ID, userId: USER_ID },
    ]);
    expect(createdEvents).toEqual([
      { eventType: "NOT_INTERESTED", postId: POST_ID, userId: USER_ID },
    ]);
    expect(invalidatedUsers).toEqual([USER_ID]);
  });

  test("hide rejects a post that does not exist", async () => {
    const { hideRecommendationPost } = await import("./actions");
    postExists = false;
    await expect(hideRecommendationPost(POST_ID)).rejects.toThrow(
      "Post not found"
    );
    expect(createdEvents).toEqual([]);
  });

  test("hide requires a signed-in session", async () => {
    const { hideRecommendationPost } = await import("./actions");
    mockGetSession.mockImplementation(() => null);
    await expect(hideRecommendationPost(POST_ID)).rejects.toThrow(
      "Sign in to do that"
    );
    expect(createdEvents).toEqual([]);
  });

  test("unhide removes the dismissal and refreshes the profile", async () => {
    const { unhideRecommendationPost } = await import("./actions");
    await unhideRecommendationPost(POST_ID);

    expect(deletedEvents).toEqual([
      { eventType: "NOT_INTERESTED", postId: POST_ID, userId: USER_ID },
    ]);
    expect(createdEvents).toEqual([]);
    expect(invalidatedUsers).toEqual([USER_ID]);
  });

  test("unhide is a no-op write for an already-restored post", async () => {
    const { unhideRecommendationPost } = await import("./actions");
    // deleteMany matches nothing when there was no dismissal; the action still
    // resolves and the profile is refreshed.
    await expect(unhideRecommendationPost(POST_ID)).resolves.toBeUndefined();
    expect(invalidatedUsers).toEqual([USER_ID]);
  });

  test("unhide requires a signed-in session", async () => {
    const { unhideRecommendationPost } = await import("./actions");
    mockGetSession.mockImplementation(() => null);
    await expect(unhideRecommendationPost(POST_ID)).rejects.toThrow(
      "Sign in to do that"
    );
    expect(deletedEvents).toEqual([]);
  });
});
