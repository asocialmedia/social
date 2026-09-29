// What a failed post card is allowed to say about the post.
//
// The card is the only view of a shared post inside a message, and it used one
// sentence for every possible failure: a 404 (deleted, or in a private community
// the viewer cannot read) and a 500, a 429, an expired session, a dropped
// connection and a malformed body all rendered "Post no longer available". The
// response to the first is a fact; to the rest it is a lie, and one with no way back
// -- the error is cached, so the notice is pinned for the life of the query and a
// transient blip permanently replaces a post the reader could have opened.

import { describe, expect, test } from "bun:test";

import { postEmbedFailure, postEmbedRetries } from "./post-embed-failure";

describe("postEmbedFailure", () => {
  test("a 404 is the one status that means the post is gone", () => {
    expect(postEmbedFailure(404)).toBe("gone");
  });

  test("an expired session is not a deleted post", () => {
    // The case that made the old copy a lie in the common direction: signing in
    // again fixes this, and the card had no way to say so or to act on it.
    expect(postEmbedFailure(401)).toBe("retryable");
  });

  test("a rate limit or a server fault is not a deleted post", () => {
    expect(postEmbedFailure(429)).toBe("retryable");
    expect(postEmbedFailure(500)).toBe("retryable");
    expect(postEmbedFailure(503)).toBe("retryable");
  });

  // A request that never produced a response cannot be evidence of absence, so it
  // belongs on the side that admits ignorance rather than the side that declares it.
  test("no response at all is retryable, never gone", () => {
    expect(postEmbedFailure()).toBe("retryable");
  });
});

describe("postEmbedRetries", () => {
  test("a 404 is not retried", () => {
    // The server has answered. Asking again spends a request and changes nothing,
    // and this card can be one of twenty inside a virtualized list.
    expect(postEmbedRetries(0, 404)).toBe(false);
    expect(postEmbedRetries(3, 404)).toBe(false);
  });

  test("anything else gets exactly one retry", () => {
    // Enough to ride out a blip or a session that expired mid-view; bounded so a
    // broken endpoint cannot turn one card into a request loop.
    expect(postEmbedRetries(0, 500)).toBe(true);
    expect(postEmbedRetries(1, 500)).toBe(false);
    expect(postEmbedRetries(0, 401)).toBe(true);
    expect(postEmbedRetries(0)).toBe(true);
    expect(postEmbedRetries(1)).toBe(false);
  });

  test("the two agree, so the copy and the budget cannot drift", () => {
    for (const status of [404, 401, 429, 500, undefined]) {
      expect(postEmbedRetries(0, status)).toBe(
        postEmbedFailure(status) === "retryable"
      );
    }
  });
});
