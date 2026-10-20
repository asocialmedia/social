import { expect, mock, test } from "bun:test";

let offline = false;
const reads: unknown[][] = [];
const proof = {
  avatarUrl: null,
  displayName: "Friend",
  id: "friend",
  username: "friend",
};
const source = {
  id: "at://did:plc:fixture/app.bsky.feed.post/source",
  sources: [proof],
  weight: 0.5,
};
mock.module("@asm/db", () => ({
  networkSocialCandidates: () =>
    Promise.resolve({
      external: [source],
      followedIds: ["friend"],
      native: [],
    }),
  redis: {
    get: () => Promise.resolve(null),
    publish: () => Promise.resolve(0),
    set: () => Promise.resolve("OK"),
  },
}));
mock.module("@/lib/protocols/service", () => ({
  readBlueskyDiscovery: () =>
    Promise.resolve({ cursor: null, items: [], partial: false }),
  readBlueskyPosts: (...args: unknown[]) => {
    reads.push(args);
    return offline
      ? Promise.reject(new Error("offline"))
      : Promise.resolve([{ id: source.id, text: "Fresh upstream version" }]);
  },
}));
const { socialExternalRecommendations } = await import("./social-external");

test("source candidates are reread live with recommendation opt-outs enforced and preserve ASM attribution", async () => {
  const signal = AbortSignal.timeout(1000);
  const result = await socialExternalRecommendations(
    "viewer",
    true,
    signal,
    "request"
  );
  expect(reads[0]).toEqual([[source.id], signal, "request", true]);
  expect(result.items[0]?.text).toBe("Fresh upstream version");
  expect(
    result.annotate({ id: source.id, text: "Upstream" }).recommendationSources
  ).toEqual([proof]);
});

test("source failure keeps the regular discovery page usable and continuations do not reread old social candidates", async () => {
  offline = true;
  const signal = AbortSignal.timeout(1000);
  const result = await socialExternalRecommendations(
    "viewer",
    true,
    signal,
    "request"
  );
  expect(result.partial).toBe(true);
  expect(result.items).toEqual([]);

  offline = false;
  reads.length = 0;
  const skipped = await socialExternalRecommendations(
    "viewer",
    false,
    signal,
    "request"
  );
  expect(skipped.items).toEqual([]);
  expect(reads.length).toBe(0);
});
