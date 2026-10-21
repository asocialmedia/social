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

  test("strips a query string from the post id", () => {
    expect(pathToNativeRoute("/posts/abcd1234?comment=c1")).toBe(
      "/posts/abcd1234?comment=c1"
    );
  });

  test("drops a community prefix and still opens the post", () => {
    expect(pathToNativeRoute("/a/anime/posts/abcd1234")).toBe(
      "/posts/abcd1234"
    );
  });

  test("falls back to the notifications list for non-post paths", () => {
    expect(pathToNativeRoute("/users/alice")).toBe("/users/alice");
    expect(pathToNativeRoute("/a/anime")).toBe("/a/anime");
    expect(pathToNativeRoute("/notifications")).toBe("/notifications");
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
