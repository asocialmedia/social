import { expect, test } from "bun:test";

import { externalMutationSchema, feedAvailability } from "./interactions";

test("selected feed sources produce one loading, error, empty, or content state", () => {
  const input = {
    count: 0,
    externalEnabled: true,
    externalError: true,
    externalLoading: false,
    nativeEnabled: true,
    nativeError: false,
    nativeLoading: false,
  };
  expect(feedAvailability(input)).toBe("error");
  expect(feedAvailability({ ...input, count: 1 })).toBe("content");
  expect(feedAvailability({ ...input, externalEnabled: false })).toBe("empty");
  expect(feedAvailability({ ...input, nativeLoading: true })).toBe("loading");
  expect(
    feedAvailability({
      ...input,
      externalError: false,
      nativeEnabled: false,
      nativeError: true,
      nativeLoading: true,
    })
  ).toBe("empty");
});
test("interaction inputs cannot smuggle snapshots, arbitrary URLs, or unknown actions", () => {
  const input = {
    action: "bookmark",
    active: true,
    uri: "at://did:web:example.test/app.bsky.feed.post/example",
  };
  expect(externalMutationSchema.safeParse(input).success).toBe(true);
  expect(
    externalMutationSchema.safeParse({ ...input, snapshot: { text: "forged" } })
      .success
  ).toBe(false);
  expect(
    externalMutationSchema.safeParse({
      ...input,
      uri: "https://localhost/private",
    }).success
  ).toBe(false);
  expect(
    externalMutationSchema.safeParse({ ...input, action: "vote" }).success
  ).toBe(false);
});

test("source outages never replace a populated feed with an error state", () => {
  const populated = {
    count: 12,
    externalEnabled: true,
    externalError: true,
    externalLoading: false,
    nativeEnabled: true,
    nativeError: false,
    nativeLoading: false,
  };
  expect(feedAvailability(populated)).toBe("content");
  expect(feedAvailability({ ...populated, nativeEnabled: false })).toBe(
    "content"
  );
  expect(feedAvailability({ ...populated, nativeError: true })).toBe("content");
  expect(feedAvailability({ ...populated, count: 0 })).toBe("error");
});
