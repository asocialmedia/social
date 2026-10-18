import { expect, test } from "bun:test";

import { shouldPersistFeed } from "./persisted-feeds";

function query(queryKey: readonly unknown[], age = 0) {
  return {
    queryKey,
    state: { dataUpdatedAt: Date.now() - age, status: "success" },
  };
}

test("persists only feeds belonging to the current viewer", () => {
  expect(
    shouldPersistFeed(query(["post-feed", "bookmarks", "alice"]), "alice")
  ).toBe(true);
  expect(
    shouldPersistFeed(query(["post-feed", "bookmarks", "bob"]), "alice")
  ).toBe(false);
  expect(
    shouldPersistFeed(
      query(["bluesky-discovery", "latest", "alice", "en"]),
      "alice"
    )
  ).toBe(true);
  expect(
    shouldPersistFeed(
      query(["bluesky-discovery", "latest", "guest", "en"]),
      "alice"
    )
  ).toBe(false);
  expect(shouldPersistFeed(query(["messages", "alice"]), "alice")).toBe(false);
});

test("does not restore expired discovery continuations or failed queries", () => {
  expect(
    shouldPersistFeed(
      query(["bluesky-discovery", "latest", "alice"], 601_000),
      "alice"
    )
  ).toBe(false);
  expect(
    shouldPersistFeed(
      {
        ...query(["post-feed", "latest", "alice"]),
        state: { dataUpdatedAt: Date.now(), status: "error" },
      },
      "alice"
    )
  ).toBe(false);
});
