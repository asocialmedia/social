import { beforeEach, describe, expect, mock, test } from "bun:test";

let session: { user: { id: string } } | null = { user: { id: "user-1" } };
let hideImpl: (postId: string) => Promise<void> = () => Promise.resolve();
const hideRecommendationPost = mock((postId: string) => hideImpl(postId));
const unhideRecommendationPost = mock(() => Promise.resolve());

mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/recommendations/actions", () => ({
  hideRecommendationPost,
  unhideRecommendationPost,
}));
mock.module("@asm/logger", () => ({
  createLogger: () => ({ error: () => null, info: () => null }),
}));

const { DELETE, POST } = await import("./route");

function request(body: unknown, method = "POST") {
  return new Request("http://localhost/api/recommendations/not-interested", {
    // No static body key: the unicorn rule rejects body alongside a
    // non-literal method, and every caller here posts JSON anyway.
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json" },
    method,
  });
}

beforeEach(() => {
  session = { user: { id: "user-1" } };
  hideImpl = () => Promise.resolve();
  hideRecommendationPost.mockClear();
  unhideRecommendationPost.mockClear();
});

describe("/api/recommendations/not-interested", () => {
  test("rejects guests", async () => {
    session = null;
    const res = await POST(request({ postId: "p1" }));
    expect(res.status).toBe(401);
    expect(hideRecommendationPost).not.toHaveBeenCalled();
  });

  test("requires a post id", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(400);
  });

  test("POST hides and DELETE undoes", async () => {
    const hidden = await POST(request({ postId: "p1" }));
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ hidden: true, postId: "p1" });
    expect(hideRecommendationPost).toHaveBeenCalledWith("p1");

    const undone = await DELETE(request({ postId: "p1" }, "DELETE"));
    expect(await undone.json()).toEqual({ hidden: false, postId: "p1" });
    expect(unhideRecommendationPost).toHaveBeenCalledTimes(1);
  });

  test("maps a missing post to 404 and hides internal errors", async () => {
    hideImpl = () => Promise.reject(new Error("Post not found"));
    const missing = await POST(request({ postId: "nope" }));
    expect(missing.status).toBe(404);

    hideImpl = () => Promise.reject(new Error("db down"));
    const failed = await POST(request({ postId: "p1" }));
    expect(failed.status).toBe(500);
    const body = await failed.json();
    expect(body.error).toBe("That didn't go through, give it another try?");
  });
});
