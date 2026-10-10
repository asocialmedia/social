import { describe, expect, test } from "bun:test";

import { pathToNativeRoute } from "./push-path";

describe("push path routing", () => {
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
      "/posts/abcd1234"
    );
  });

  test("drops a community prefix and still opens the post", () => {
    expect(pathToNativeRoute("/a/anime/posts/abcd1234")).toBe(
      "/posts/abcd1234"
    );
  });

  test("falls back to the notifications list for non-post paths", () => {
    expect(pathToNativeRoute("/users/alice")).toBe("/notifications");
    expect(pathToNativeRoute("/a/anime")).toBe("/notifications");
    expect(pathToNativeRoute("/notifications")).toBe("/notifications");
  });

  test("sends a den link to the list rather than to a route that does not exist", () => {
    // There is no den surface in this app. The push for one carries the web
    // thread's own address, which would map to nothing here, so it lands on the
    // notifications list - where the den notification that produced it is, and
    // where tapping it says where the den actually is.
    expect(pathToNativeRoute("/messages?c=den-1")).toBe("/notifications");
    expect(pathToNativeRoute("/messages?c=den%2Fwith-slash")).toBe(
      "/notifications"
    );
  });

  test("opens gust links in the native reel", () => {
    expect(pathToNativeRoute("/gusts?id=abc-123")).toBe("/gusts?id=abc-123");
    expect(pathToNativeRoute("/gusts?tab=latest&id=abc")).toBe("/gusts?id=abc");
    expect(pathToNativeRoute("/gusts")).toBe("/notifications");
  });
});
