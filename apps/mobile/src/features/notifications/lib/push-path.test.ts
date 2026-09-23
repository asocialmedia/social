import { describe, expect, test } from "bun:test";

// push.ts imports expo-notifications, which bun cannot parse on Node. The path
// mapping is the part worth unit-testing, and it is kept as a plain function;
// this file exercises the same regex the module uses so the contract (root or
// community post id -> native detail route) is pinned without the native
// import.
//
// Kept in sync with pathToNativeRoute in push.ts.
function pathToNativeRoute(path: string): string {
  const postMatch =
    /^\/posts\/(?<id>[^/?#]+)/.exec(path) ??
    /^\/a\/[^/]+\/posts\/(?<id>[^/?#]+)/.exec(path);
  const id = postMatch?.groups?.id;
  return id ? `/posts/${id}` : "/notifications";
}

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
});
