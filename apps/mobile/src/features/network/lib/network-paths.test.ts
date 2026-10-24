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
    "/posts/123/media/2"
  );
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
