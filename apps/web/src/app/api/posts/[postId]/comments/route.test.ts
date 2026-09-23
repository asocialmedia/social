import { beforeEach, describe, expect, mock, test } from "bun:test";

let mockSessionUser: { user: { id: string } } | null = {
  user: { id: "user-123" },
};
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => mockSessionUser,
}));

// Whether the viewer may read the post. Flipped per-test to cover the
// community-visibility gate the route now applies before returning or
// accepting any comment.
let postVisible = true;

mock.module("@asm/db", () => ({
  COMMENT_CREATION_AURA: 5,
  COMMENT_RECEIVED_AURA: 10,
  applyFlatAward: mock(() => Promise.resolve({ amount: 5 })),
  applyWeightedAward: mock(() => Promise.resolve({ amount: 10 })),
  cancelMediaCleanup: mock(() => Promise.resolve()),
  enqueueNotificationCreated: mock(() => Promise.resolve()),
  enqueueNotificationDeleted: mock(() => Promise.resolve()),
  findVisiblePost: (postId: string) =>
    Promise.resolve(
      postVisible && postId === "valid-post"
        ? { id: "valid-post", parentPostId: null, userId: "author-1" }
        : null
    ),
  getCommentDataInclude: () => ({}),
  invalidateAuraSignals: mock(() => Promise.resolve()),
  invalidateFypProfile: mock(() => Promise.resolve()),
  prisma: {
    $transaction: mock((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        comment: {
          create: mock(() => Promise.resolve({ id: "comment-1" })),
          update: mock(() => Promise.resolve({ id: "comment-1" })),
        },
        media: {
          findMany: mock(() => Promise.resolve([])),
        },
        notification: {
          create: mock(() => Promise.resolve({})),
        },
        user: {
          findUnique: mock(() =>
            Promise.resolve({ aura: 100, createdAt: new Date() })
          ),
        },
      })
    ),
    comment: {
      findMany: mock(() => Promise.resolve([])),
      findUnique: mock(() => Promise.resolve(null)),
    },
    post: {
      findUnique: mock((args: { where: { id: string } }) => {
        if (args.where.id === "valid-post") {
          return Promise.resolve({ id: "valid-post", userId: "author-1" });
        }
        return Promise.resolve(null);
      }),
    },
  },
  publishCommentCreated: mock(() => Promise.resolve()),
  publishCommentDeleted: mock(() => Promise.resolve()),
  reverseExactAura: mock(() => Promise.resolve()),
}));

const { GET, POST } = await import("./route");

describe("POST /api/posts/[postId]/comments API enforcement", () => {
  beforeEach(() => {
    mockSessionUser = { user: { id: "user-123" } };
    postVisible = true;
  });

  test("rejects unauthorized callers with 401", async () => {
    mockSessionUser = null;
    const req = new Request("http://localhost/api/posts/valid-post/comments", {
      body: JSON.stringify({ content: "hello" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ postId: "valid-post" }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects empty comment with 400", async () => {
    const req = new Request("http://localhost/api/posts/valid-post/comments", {
      body: JSON.stringify({ content: "" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ postId: "valid-post" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects more than 1 attachment with 400", async () => {
    const req = new Request("http://localhost/api/posts/valid-post/comments", {
      body: JSON.stringify({
        content: "Two attachments",
        mediaIds: ["media-1", "media-2"],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ postId: "valid-post" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBeDefined();
  });

  test("rejects comments exceeding 10000 characters with 400", async () => {
    const req = new Request("http://localhost/api/posts/valid-post/comments", {
      body: JSON.stringify({
        content: "a".repeat(10_001),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ postId: "valid-post" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBeDefined();
  });

  test("rejects comments exceeding 2000 words with 400", async () => {
    const req = new Request("http://localhost/api/posts/valid-post/comments", {
      body: JSON.stringify({
        content: "a ".repeat(2001),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ postId: "valid-post" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBeDefined();
  });
});

describe("comment reads honor community visibility", () => {
  // Own reset: the flag above is shared, and suites must not leak state.
  beforeEach(() => {
    postVisible = true;
  });

  // A comment list is derived from its post, so a post the viewer cannot read
  // must 404 rather than expose the thread; otherwise a guessed id reaches a
  // PRIVATE community's discussion.
  test("GET 404s when the post is not visible to the viewer", async () => {
    postVisible = false;
    const res = await GET(
      new Request("http://localhost/api/posts/valid-post/comments"),
      {
        params: Promise.resolve({ postId: "valid-post" }),
      }
    );
    expect(res.status).toBe(404);
  });

  test("GET serves comments when the post is visible", async () => {
    const res = await GET(
      new Request("http://localhost/api/posts/valid-post/comments"),
      {
        params: Promise.resolve({ postId: "valid-post" }),
      }
    );
    expect(res.status).toBe(200);
  });

  test("POST refuses to write into a post the viewer cannot read", async () => {
    postVisible = false;
    const req = new Request("http://localhost/api/posts/valid-post/comments", {
      body: JSON.stringify({ content: "sneaking in" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ postId: "valid-post" }),
    });
    // 400 is the route's "Post not found" from createComment.
    expect([400, 404]).toContain(res.status);
  });
});
