import { describe, expect, test } from "bun:test";

import type { FeedPost } from "./feed-types";
import {
  canModeratePost,
  deletePost,
  updatePostModeration,
  updatePostTags,
} from "./post-mutations";

const API = "https://api.test";

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    attachments: [],
    content: "hello",
    createdAt: "2026-09-26T00:00:00.000Z",
    id: "post-1",
    user: { id: "author-1", username: "alice" },
    userId: "author-1",
    ...overrides,
  } as FeedPost;
}

function recording(respond: (input: string, init?: RequestInit) => Response) {
  const calls: { init?: RequestInit; url: string }[] = [];
  const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    return Promise.resolve(respond(String(input), init));
  }) as unknown as typeof fetch;
  return { baseFetch, calls };
}

const json = (payload: unknown, status = 200) =>
  Response.json(payload, { status });

describe("deletePost", () => {
  test("sends DELETE to the post route", async () => {
    const { baseFetch, calls } = recording(() => json({ ok: true }));
    await deletePost("post-1", { apiBase: API, baseFetch });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${API}/api/posts/post-1`);
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  test("encodes an id that needs escaping", async () => {
    const { baseFetch, calls } = recording(() => json({ ok: true }));
    await deletePost("a/b", { apiBase: API, baseFetch });
    expect(calls[0]?.url).toBe(`${API}/api/posts/a%2Fb`);
  });

  test("a 4xx is not retried", async () => {
    let attempts = 0;
    const baseFetch = (() => {
      attempts += 1;
      return Promise.resolve(json({ error: "Not yours" }, 403));
    }) as unknown as typeof fetch;
    await expect(deletePost("p", { apiBase: API, baseFetch })).rejects.toThrow(
      "Not yours"
    );
    // Retrying a rejection would only produce the same rejection.
    expect(attempts).toBe(1);
  });

  test("a 5xx is retried", async () => {
    let attempts = 0;
    const baseFetch = (() => {
      attempts += 1;
      return attempts < 3
        ? Promise.resolve(json({ error: "boom" }, 500))
        : Promise.resolve(json({ ok: true }));
    }) as unknown as typeof fetch;
    await deletePost("p", { apiBase: API, baseFetch });
    expect(attempts).toBe(3);
  });
});

describe("updatePostModeration", () => {
  test("PATCHes only the flags that changed and returns the post", async () => {
    const { baseFetch, calls } = recording(() =>
      json({ post: { explicitContent: true, id: "post-1", moderated: false } })
    );
    const result = await updatePostModeration(
      "post-1",
      { explicitContent: true },
      { apiBase: API, baseFetch }
    );
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(String(calls[0]?.init?.body)).toBe('{"explicitContent":true}');
    expect(result.moderated).toBe(false);
  });
});

describe("updatePostTags", () => {
  test("POSTs the tag list to the tags route", async () => {
    const { baseFetch, calls } = recording(() => json({ ok: true }));
    await updatePostTags("post-1", ["rust", "systems"], {
      apiBase: API,
      baseFetch,
    });
    expect(calls[0]?.url).toBe(`${API}/api/posts/post-1/tags`);
    expect(String(calls[0]?.init?.body)).toBe('{"tags":["rust","systems"]}');
  });
});

describe("canModeratePost", () => {
  test("the author can always moderate their own post", () => {
    expect(canModeratePost(post(), { id: "author-1" })).toBe(true);
  });

  test("staff can moderate anyone's", () => {
    expect(canModeratePost(post(), { id: "other", role: "moderator" })).toBe(
      true
    );
    expect(canModeratePost(post(), { id: "other", role: "admin" })).toBe(true);
  });

  test("a signed-in reader cannot moderate someone else's", () => {
    expect(canModeratePost(post(), { id: "other", role: "user" })).toBe(false);
  });

  test("a signed-out viewer cannot moderate at all", () => {
    expect(canModeratePost(post(), null)).toBe(false);
    expect(canModeratePost(post(), {})).toBe(false);
  });
});
