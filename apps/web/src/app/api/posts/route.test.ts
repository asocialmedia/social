import { beforeEach, describe, expect, mock, test } from "bun:test";

import { ZodError } from "zod";

// In-memory Redis with SET NX EX semantics, enough for the idempotency flow.
const store = new Map<string, string>();
const redis = {
  del: mock((key: string) => {
    store.delete(key);
    return Promise.resolve(1);
  }),
  get: mock((key: string) => Promise.resolve(store.get(key) ?? null)),
  set: mock((key: string, value: string, ...args: (string | number)[]) => {
    if (args.includes("NX") && store.has(key)) {
      return Promise.resolve(null);
    }
    store.set(key, value);
    return Promise.resolve("OK");
  }),
};

let session: { user: { id: string } } | null = { user: { id: "user-1" } };
let submit: (input: unknown) => Promise<unknown> = () =>
  Promise.resolve({ id: "post-1" });
const submitPost = mock((input: unknown) => submit(input));

mock.module("@asm/db", () => ({
  // Named-export stub for the linker: sibling route tests in the same
  // process mock @asm/db with only prisma, and vice versa.
  prisma: {},
  redis,
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/lib/otel", () => ({ getWebLogger: () => null }));
mock.module("@/posts/editor/actions", () => ({ submitPost }));

const { POST } = await import("./route");

const KEY = "idem-key-0123456789abcdef";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/posts", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}

beforeEach(() => {
  store.clear();
  session = { user: { id: "user-1" } };
  submit = () => Promise.resolve({ id: "post-1" });
  submitPost.mockClear();
});

describe("POST /api/posts", () => {
  test("rejects guests", async () => {
    session = null;
    const res = await POST(request({ content: "hi" }));
    expect(res.status).toBe(401);
    expect(submitPost).not.toHaveBeenCalled();
  });

  test("creates a post through submitPost", async () => {
    const res = await POST(request({ content: "hi", mediaIds: [] }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "post-1" });
    expect(submitPost).toHaveBeenCalledTimes(1);
  });

  test("rejects a malformed idempotency key and a bad body", async () => {
    const badKey = await POST(request({}, { "idempotency-key": "short" }));
    expect(badKey.status).toBe(400);
    const badBody = await POST(request("{not json"));
    expect(badBody.status).toBe(400);
  });

  test("a retry of a finished create returns the existing post, never a second one", async () => {
    const first = await POST(
      request({ content: "hi" }, { "idempotency-key": KEY })
    );
    expect(first.status).toBe(201);

    const retry = await POST(
      request({ content: "hi" }, { "idempotency-key": KEY })
    );
    expect(retry.status).toBe(409);
    expect(await retry.json()).toEqual({
      error: "duplicate",
      postId: "post-1",
    });
    expect(submitPost).toHaveBeenCalledTimes(1);
  });

  test("a retry while the first attempt runs is told to wait", async () => {
    store.set(`post-idem:user-1:${KEY}`, "pending");
    const res = await POST(
      request({ content: "hi" }, { "idempotency-key": KEY })
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toEqual({ error: "in-flight" });
  });

  test("keys are scoped per user", async () => {
    await POST(request({ content: "a" }, { "idempotency-key": KEY }));
    session = { user: { id: "user-2" } };
    const other = await POST(
      request({ content: "b" }, { "idempotency-key": KEY })
    );
    expect(other.status).toBe(201);
    expect(submitPost).toHaveBeenCalledTimes(2);
  });

  test("a failed create releases the key so the retry can succeed", async () => {
    submit = () =>
      Promise.reject(new Error("Join this community before posting in it"));
    const failed = await POST(
      request({ content: "hi" }, { "idempotency-key": KEY })
    );
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({
      error: "Join this community before posting in it",
    });
    expect(store.has(`post-idem:user-1:${KEY}`)).toBe(false);

    submit = () => Promise.resolve({ id: "post-2" });
    const retry = await POST(
      request({ content: "hi" }, { "idempotency-key": KEY })
    );
    expect(retry.status).toBe(201);
  });

  test("maps validation, auth and internal failures", async () => {
    submit = () =>
      Promise.reject(
        new ZodError([
          {
            code: "custom",
            message: "A post needs either a caption or an attachment",
            path: [],
          },
        ])
      );
    const invalid = await POST(request({}));
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json();
    expect(invalidBody.error).toBe(
      "A post needs either a caption or an attachment"
    );

    submit = () =>
      Promise.reject(new Error("You are not logged in. Please log in again."));
    const unauthorized = await POST(request({}));
    expect(unauthorized.status).toBe(401);

    // Internal errors (subclasses) never leak their message.
    submit = () => Promise.reject(new TypeError("prisma exploded"));
    const internal = await POST(request({}));
    expect(internal.status).toBe(500);
    const internalBody = await internal.json();
    expect(internalBody.error).toBe("Couldn't create your post, try again?");

    submit = () => Promise.resolve(null);
    const empty = await POST(request({}));
    expect(empty.status).toBe(500);
  });
});
