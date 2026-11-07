import { expect, mock, test } from "bun:test";
import type { ExternalPost } from "@asm/protocols/contracts";

const source: ExternalPost | null = null;
mock.module("@/lib/seo/public-bluesky-post", () => ({ getPublicBlueskyPost: () => Promise.resolve(source) }));
mock.module("@/components/protocols/external-post-page", () => ({ ExternalPostPage: () => null }));
const { generateMetadata } = await import("./page");

test("a missing public preview does not index an empty source or remove the discussion reader", async () => {
  const metadata = await generateMetadata({ searchParams: Promise.resolve({ uri: "at://did:plc:example/app.bsky.feed.post/123" }) });
  expect(metadata.robots).toEqual({ follow: true, index: false });
  expect(metadata.title).toBe("Bluesky post and discussion");
});

test("invalid remote post addresses return not-found instead of creating indexable empty pages", async () => {
  await expect(generateMetadata({ searchParams: Promise.resolve({ uri: "https://untrusted.test" }) })).rejects.toThrow();
});
