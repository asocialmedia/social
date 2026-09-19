import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post-1";
const USER_ID = "user-1";

const deletedEvents: { eventType: string; postId: string; userId: string }[] =
  [];
const createdEvents: {
  dedupeKey: string;
  eventType: string;
  postId: string;
  userId: string;
}[] = [];
const upsertedKeys: string[] = [];
const invalidatedUsers: string[] = [];

let postExists = true;

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

const mockPrisma = {
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
    // The durable hide is an atomic upsert on the unique dedupeKey, so the mock
    // records the create payload and the conflict key.
    upsert: (args: {
      create: {
        dedupeKey: string;
        eventType: string;
        postId: string;
        userId: string;
      };
      where: { dedupeKey: string };
    }): void => {
      createdEvents.push(args.create);
      upsertedKeys.push(args.where.dedupeKey);
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
    upsertedKeys.length = 0;
    invalidatedUsers.length = 0;
    postExists = true;
    mockGetSession.mockImplementation(() => ({ user: { id: USER_ID } }));
  });

  test("hide writes one event via an atomic upsert on the dedupe key", async () => {
    const { hideRecommendationPost } = await import("./actions");
    await hideRecommendationPost(POST_ID);

    // A single upsert on the unique dedupeKey is race-safe by construction: two
    // tabs cannot both insert, so the exclusion cap is not eaten by duplicates.
    expect(createdEvents).toEqual([
      {
        dedupeKey: `not_interested:${USER_ID}:${POST_ID}`,
        eventType: "NOT_INTERESTED",
        postId: POST_ID,
        userId: USER_ID,
      },
    ]);
    expect(upsertedKeys).toEqual([`not_interested:${USER_ID}:${POST_ID}`]);
    // Hide no longer deletes first (that was the racy pattern it replaced).
    expect(deletedEvents).toEqual([]);
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
