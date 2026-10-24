import { expect, test } from "bun:test";

import { NodeOAuthClient } from "@atproto/oauth-client-node";

import {
  BLUESKY_OAUTH_SCOPE,
  blueskyOAuthMetadata,
  hasBlueskyRepoPermission,
} from "./oauth-config";

test("like permissions require create and delete and reject unrelated grants", () => {
  expect(
    hasBlueskyRepoPermission(
      BLUESKY_OAUTH_SCOPE,
      "app.bsky.feed.like",
      "create"
    )
  ).toBe(true);
  expect(
    hasBlueskyRepoPermission(
      BLUESKY_OAUTH_SCOPE,
      "app.bsky.feed.like",
      "delete"
    )
  ).toBe(true);
  expect(
    hasBlueskyRepoPermission(
      "repo:app.bsky.feed.like?action=create",
      "app.bsky.feed.like",
      "delete"
    )
  ).toBe(false);
  expect(
    hasBlueskyRepoPermission(
      "repo:app.bsky.feed.repost",
      "app.bsky.feed.like",
      "create"
    )
  ).toBe(false);
  expect(
    hasBlueskyRepoPermission(undefined, "app.bsky.feed.like", "create")
  ).toBe(false);
});

for (const origin of [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://asocialmedia.cc",
]) {
  test(`SDK accepts OAuth metadata for ${origin}`, () => {
    const metadata = blueskyOAuthMetadata(origin);
    const client = new NodeOAuthClient({
      clientMetadata: metadata,
      handleResolver: { resolve: () => Promise.resolve("did:plc:example") },
      requestLock: (_key, action) => action(),
      sessionStore: {
        del: () => Promise.resolve(),
        get: () => Promise.resolve(),
        set: () => Promise.resolve(),
      },
      stateStore: {
        del: () => Promise.resolve(),
        get: () => Promise.resolve(),
        set: () => Promise.resolve(),
      },
    });
    expect(client.clientMetadata.scope).toBe(BLUESKY_OAUTH_SCOPE);
    expect(metadata.scope).not.toContain("transition:generic");
  });
}

test("rejects insecure non-loopback deployments", () => {
  expect(() => blueskyOAuthMetadata("http://example.com")).toThrow("HTTPS");
});
