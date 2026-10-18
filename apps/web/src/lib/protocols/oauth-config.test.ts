import { expect, test } from "bun:test";

import { NodeOAuthClient } from "@atproto/oauth-client-node";

import { BLUESKY_OAUTH_SCOPE, blueskyOAuthMetadata } from "./oauth-config";

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
