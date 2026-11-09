import { describe, expect, test } from "bun:test";

import { pathToNativeRoute } from "./push-path";

describe("push path routing", () => {
  test("opens a DM notification in its conversation", () => {
    expect(pathToNativeRoute("/messages?c=convo-123")).toBe(
      "/messages/convo-123"
    );
    expect(pathToNativeRoute("/messages?c=")).toBe("/notifications");
    expect(pathToNativeRoute("/messages?c=../settings")).toBe("/notifications");
  });
  test("maps a post path to the native detail route", () => {
    expect(pathToNativeRoute("/posts/abcd1234")).toBe("/posts/abcd1234");
  });

  test("keeps the full id when the path carries one", () => {
    expect(pathToNativeRoute("/posts/abcdefghijkl")).toBe(
      "/posts/abcdefghijkl"
    );
  });

  test("maps community chat links to the native community chat screen", () => {
    expect(pathToNativeRoute("/a/anime/chat/channel-1")).toBe(
      "/a/anime/chat/channel-1"
    );
  });

  test("preserves channel, thread, and message destinations in community pushes", () => {
    expect(
      pathToNativeRoute(
        "/a/garden/chat/general-id/threads/thread-id?message=message-id"
      )
    ).toBe("/a/garden/chat/general-id/threads/thread-id?message=message-id");
    expect(
      pathToNativeRoute(
        "/a/garden/chat/general-id?message=message-id&unused=value"
      )
    ).toBe("/a/garden/chat/general-id?message=message-id");
    expect(pathToNativeRoute("/a/garden/chat/general-id/unexpected")).toBe(
      "/notifications"
    );
  });

  test("strips a query string from the post id", () => {
    expect(pathToNativeRoute("/posts/abcd1234?comment=c1")).toBe(
      "/posts/abcd1234?comment=c1"
    );
  });

  test("keeps the community namespace when opening a community post", () => {
    expect(pathToNativeRoute("/a/anime/posts/abcd1234")).toBe(
      "/a/anime/posts/abcd1234"
    );
  });

  test("falls back to the notifications list for unmapped targets", () => {
    expect(pathToNativeRoute("/about")).toBe("/notifications");
  });

  test("falls back to the notifications list for non-post paths", () => {
    expect(pathToNativeRoute("/users/alice")).toBe("/users/alice");
    expect(pathToNativeRoute("/a/anime")).toBe("/a/anime");
    expect(pathToNativeRoute("/notifications")).toBe("/notifications");
  });

  test("opens short profile URLs on the native profile", () => {
    // Web 953ef2d3 short profile URLs: /<username> and the followers lists.
    expect(pathToNativeRoute("/alice")).toBe("/users/alice");
    expect(pathToNativeRoute("/alice/followers")).toBe(
      "/users/alice/followers"
    );
    expect(pathToNativeRoute("/users/alice/following")).toBe(
      "/users/alice/following"
    );
    // App paths are never profiles, even when short.
    expect(pathToNativeRoute("/settings")).toBe("/settings");
    expect(pathToNativeRoute("/login")).toBe("/login");
  });

  test("passes new top-level settings-adjacent routes through", () => {
    expect(pathToNativeRoute("/support")).toBe("/support");
    expect(pathToNativeRoute("/login-error?error=oauthError")).toBe(
      "/login-error?error=oauthError"
    );
  });

  test("keeps community join requests on the community", () => {
    expect(pathToNativeRoute("/a/anime?requests=1")).toBe(
      "/a/anime?requests=1"
    );
  });

  test("routes conversation paths without guessing the kind from their id", () => {
    // The path carries only an id; DM and den ids share the same format.
    expect(pathToNativeRoute("/messages?c=den-1")).toBe("/messages/den-1");
    expect(pathToNativeRoute("/messages?c=den%2Fwith-slash")).toBe(
      "/notifications"
    );
  });

  test("opens gust links in the native reel", () => {
    expect(pathToNativeRoute("/gusts?id=abc-123")).toBe("/gusts?id=abc-123");
    expect(pathToNativeRoute("/gusts?tab=latest&id=abc")).toBe(
      "/gusts?tab=latest&id=abc"
    );
    expect(pathToNativeRoute("/gusts")).toBe("/gusts");
  });
});
