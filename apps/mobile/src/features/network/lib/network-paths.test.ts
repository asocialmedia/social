import { expect, test } from "bun:test";

import config from "../../../../app.json";
import { externalShareUrl, nativeNetworkPath } from "./network-paths";

const uri = "at://did:plc:alice/app.bsky.feed.post/123";

test("Android keeps email actions and unsupported paths in the browser", () => {
  const claims = config.expo.android.intentFilters.flatMap(
    (filter) => filter.data
  );
  const claimed = (path: string) =>
    claims.some(
      (entry) =>
        ("path" in entry && entry.path === path) ||
        ("pathPrefix" in entry &&
          typeof entry.pathPrefix === "string" &&
          path.startsWith(entry.pathPrefix))
    );
  for (const path of [
    "/verify-email",
    "/reset-password/confirm",
    "/reset-password",
    "/unsupported",
  ]) {
    expect(claimed(path)).toBe(false);
  }
  for (const path of [
    "/posts/123",
    "/a/code/posts/123",
    "/gusts",
    "/network/bluesky",
    "/messages/join/invite",
    "/",
  ]) {
    expect(claimed(path)).toBe(true);
    expect(
      nativeNetworkPath(
        path === "/network/bluesky"
          ? `${path}?uri=${encodeURIComponent(uri)}`
          : path
      )
    ).not.toBeNull();
  }
});
test("canonical external shares return to the ASM discussion and media", () => {
  const shared = externalShareUrl(uri);
  expect(nativeNetworkPath(shared)).toBe(
    `/external-post?${new URLSearchParams({ uri })}`
  );
  expect(nativeNetworkPath(`${shared}&media=2`)).toBe(
    `/external-media?${new URLSearchParams({ index: "2", uri })}`
  );
});
test("maps author links, community post slugs, media and conversation links", () => {
  expect(
    nativeNetworkPath("/network/bluesky/profile?actor=did%3Aplc%3Aalice")
  ).toBe("/external-profile?actor=did%3Aplc%3Aalice");
  expect(nativeNetworkPath("/a/code/posts/123/a-post-slug/media/2")).toBe(
    "/a/code/posts/123/media/2"
  );
  expect(nativeNetworkPath("/a/code/posts/123/a-post-slug")).toBe(
    "/a/code/posts/123"
  );
  expect(nativeNetworkPath("/posts/123/a-post-slug")).toBe("/posts/123");
  expect(
    nativeNetworkPath("asocialmedia://settings?tab=account&state=nonce")
  ).toBe("/settings?tab=account&state=nonce");
  expect(nativeNetworkPath("/messages?c=den-123")).toBe("/messages/den-123");
  expect(nativeNetworkPath("/messages/join/invite")).toBe(
    "/messages/join/invite"
  );
});
test.each([
  "https://attacker.test/posts/123",
  "//attacker.test/posts/123",
  // oxlint-disable-next-line eslint/no-script-url -- A rejected scheme is a security regression fixture.
  "javascript:alert(1)",
  "/network/bluesky?uri=https://attacker.test",
  "/messages?c=",
  "/messages?c=../settings",
])("rejects invalid or foreign destinations: %s", (path) => {
  expect(nativeNetworkPath(path)).toBeNull();
});
test("short profile URLs open the native profile", () => {
  expect(nativeNetworkPath("/alice")).toBe("/users/alice");
  expect(nativeNetworkPath("https://asocialmedia.cc/alice_2/followers")).toBe(
    "/users/alice_2/followers"
  );
  // Web routes are never usernames, whether or not native has a screen.
  expect(nativeNetworkPath("/gusts")).toBe("/gusts");
  expect(nativeNetworkPath("/about")).toBeNull();
  expect(nativeNetworkPath("/Privacy")).toBeNull();
  expect(nativeNetworkPath("/verify-email")).toBeNull();
  // Every native top-level route survives the system-intent redirect instead
  // of falling through to /notifications.
  expect(nativeNetworkPath("asocialmedia://hackernews?sort=score")).toBe(
    "/hackernews?sort=score"
  );
  expect(nativeNetworkPath("asocialmedia://camera")).toBe("/camera");
});
test("community chat links open the chat, not the notifications list", () => {
  expect(nativeNetworkPath("https://asocialmedia.cc/a/code/chat")).toBe(
    "/a/code/chat"
  );
  expect(nativeNetworkPath("/a/code/chat/general")).toBe(
    "/a/code/chat/general"
  );
  expect(nativeNetworkPath("/a/code/chat/general/threads/t1?message=m_1")).toBe(
    "/a/code/chat/general/threads/t1?message=m_1"
  );
  // A jump target that is not an id is dropped, never forwarded.
  expect(nativeNetworkPath("/a/code/chat/general?message=../x")).toBe(
    "/a/code/chat/general"
  );
});
test("video share links open the post media viewer on that video", () => {
  expect(nativeNetworkPath("https://asocialmedia.cc/watch/p1/m_2")).toBe(
    "/posts/p1/media/0?mediaId=m_2"
  );
  expect(nativeNetworkPath("/watch/p1")).toBeNull();
  expect(nativeNetworkPath("/watch/p1/../x")).toBeNull();
});
test("legal pages open the in-app document screen", () => {
  expect(nativeNetworkPath("asocialmedia://privacy")).toBe("/legal/privacy");
  expect(nativeNetworkPath("https://asocialmedia.cc/toc/")).toBe(
    "/legal/terms"
  );
});
test("Android claims video share links", () => {
  const claims = config.expo.android.intentFilters.flatMap(
    (filter) => filter.data
  );
  for (const host of ["asocialmedia.cc", "www.asocialmedia.cc"]) {
    expect(
      claims.some(
        (entry) =>
          entry.host === host &&
          "pathPrefix" in entry &&
          entry.pathPrefix === "/watch/"
      )
    ).toBe(true);
  }
});
