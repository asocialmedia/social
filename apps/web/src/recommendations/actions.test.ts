import { beforeEach, describe, expect, mock, test } from "bun:test";

const POST_ID = "post-1";
const USER_ID = "user-1";
const DEDUPE_KEY = `not_interested:${USER_ID}:${POST_ID}`;

interface EventExpression {
  field: string;
  operator: string;
  value: unknown;
}

const createdEvents: {
  dedupeKey: string;
  eventType: string;
  postId: string;
  userId: string;
}[] = [];
const upsertCalls: {
  conflictOn: { dedupeKey: string };
  create: {
    dedupeKey: string;
    eventType: string;
    postId: string;
    userId: string;
  };
  update: Record<string, never>;
}[] = [];
const deletedEvents: EventExpression[][] = [];
const updatedEventIds: string[] = [];
const invalidatedUsers: string[] = [];

let existingDedupeKey: string | null = null;
let postExists = true;

function createEventAccessor(): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      get(_target, field) {
        if (typeof field !== "string") {
          return;
        }
        return {
          eq: (value: unknown): EventExpression => ({
            field,
            operator: "eq",
            value,
          }),
        };
      },
    }
  );
}

function getEventExpressions(
  predicate: (model: Record<string, unknown>) => unknown
): EventExpression[] {
  const value = predicate(createEventAccessor());
  return Array.isArray(value) ? (value as EventExpression[]) : [];
}

const mockPrisma = {
  orm: {
    public: {
      Posts: {
        select: () => ({
          where: (where: { id: string }) => ({
            first: () =>
              Promise.resolve(
                postExists && where.id === POST_ID ? { id: POST_ID } : null
              ),
          }),
        }),
      },
      RecommendationEvents: {
        create: (data: {
          dedupeKey: string;
          eventType: string;
          postId: string;
          userId: string;
        }) => {
          createdEvents.push(data);
          return Promise.resolve(data);
        },
        select: () => ({
          where: (where: { dedupeKey: string }) => ({
            first: () =>
              Promise.resolve(
                existingDedupeKey === where.dedupeKey ? { id: "event-1" } : null
              ),
          }),
        }),
        upsert: (args: {
          conflictOn: { dedupeKey: string };
          create: {
            dedupeKey: string;
            eventType: string;
            postId: string;
            userId: string;
          };
          update: Record<string, never>;
        }) => {
          upsertCalls.push(args);
          return Promise.resolve(args.create);
        },
        where: (
          predicate:
            | ((model: Record<string, unknown>) => unknown)
            | { id: string }
        ) => ({
          delete: () => {
            const expressions = [
              "id" in predicate ? [] : getEventExpressions(predicate),
            ];
            deletedEvents.push(expressions);
            return Promise.resolve();
          },
          update: () => {
            updatedEventIds.push("id" in predicate ? predicate.id : "event-1");
            return Promise.resolve();
          },
        }),
      },
    },
  },
};

mock.module("@asm/db", () => ({
  and: (...expressions: EventExpression[]) => expressions,
  invalidateFypProfile: (userId: string): Promise<void> => {
    invalidatedUsers.push(userId);
    return Promise.resolve();
  },
  prisma: mockPrisma,
}));

mock.module("@asm/logger", () => ({
  createLogger: () => ({ error: () => {}, info: () => {}, warn: () => {} }),
}));

const mockGetSession = mock((): { user: { id: string } } | null => ({
  user: { id: USER_ID },
}));

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: mockGetSession,
}));

describe("recommendation hide actions", () => {
  beforeEach(() => {
    createdEvents.length = 0;
    upsertCalls.length = 0;
    deletedEvents.length = 0;
    updatedEventIds.length = 0;
    invalidatedUsers.length = 0;
    existingDedupeKey = null;
    postExists = true;
    mockGetSession.mockClear();
    mockGetSession.mockImplementation(() => ({ user: { id: USER_ID } }));
  });

  test("hide upserts the event atomically (no select-then-create race)", async () => {
    const { hideRecommendationPost } = await import("./actions");
    await hideRecommendationPost(POST_ID);

    // One atomic ON CONFLICT write: concurrent tabs can no longer both read
    // "no row" and insert duplicates (or trip the unique ERROR log).
    expect(upsertCalls).toEqual([
      {
        conflictOn: { dedupeKey: DEDUPE_KEY },
        create: {
          dedupeKey: DEDUPE_KEY,
          eventType: "NOT_INTERESTED",
          postId: POST_ID,
          userId: USER_ID,
        },
        update: {},
      },
    ]);
    expect(createdEvents).toEqual([]);
    expect(updatedEventIds).toEqual([]);
    expect(deletedEvents).toEqual([]);
    expect(invalidatedUsers).toEqual([USER_ID]);
  });

  test("hide is idempotent when the dismissal already exists", async () => {
    const { hideRecommendationPost } = await import("./actions");
    existingDedupeKey = DEDUPE_KEY;

    await hideRecommendationPost(POST_ID);

    // Same single upsert regardless of prior state - the second writer hits
    // ON CONFLICT and becomes a no-op instead of an error.
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0]?.conflictOn).toEqual({ dedupeKey: DEDUPE_KEY });
    expect(createdEvents).toEqual([]);
    expect(updatedEventIds).toEqual([]);
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
      [
        [
          { field: "eventType", operator: "eq", value: "NOT_INTERESTED" },
          { field: "postId", operator: "eq", value: POST_ID },
          { field: "userId", operator: "eq", value: USER_ID },
        ],
      ],
    ]);
    expect(createdEvents).toEqual([]);
    expect(invalidatedUsers).toEqual([USER_ID]);
  });

  test("unhide resolves when there is no dismissal to delete", async () => {
    const { unhideRecommendationPost } = await import("./actions");
    await expect(unhideRecommendationPost(POST_ID)).resolves.toBeUndefined();
    expect(deletedEvents).toHaveLength(1);
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
