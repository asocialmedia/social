import { expect, test } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import { FEED_WAKE_AGE_MS, refreshExpiredFeeds } from "./feed-wake-refresh";

test("waking after eighteen hours refreshes heads without replaying expired cursors or clearing unrelated data", async () => {
  const client = new QueryClient();
  const now = Date.now();
  const key = ["bluesky-discovery", "personalized", "viewer"];
  client.setQueryData(
    key,
    {
      pageParams: [{ cursor: null }, { cursor: "expired" }],
      pages: [{ items: ["cached"] }, { items: ["old continuation"] }],
    },
    { updatedAt: now - 18 * 60 * 60_000 }
  );
  client.setQueryData(
    ["explore-feed", "viewer"],
    { pageParams: [null], pages: [{ posts: ["explore"] }] },
    { updatedAt: now - FEED_WAKE_AGE_MS }
  );
  client.setQueryData(["post-feed", "latest", "viewer"], {
    pageParams: [null, "valid"],
    pages: [1, 2],
  });
  client.setQueryData(
    ["messages"],
    { pageParams: [null, "valid"], pages: [1, 2] },
    { updatedAt: 1 }
  );
  await refreshExpiredFeeds(client, now);
  expect(client.getQueryData(key)).toEqual({
    pageParams: [{ cursor: null }],
    pages: [{ items: ["cached"] }],
  });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["explore-feed", "viewer"])?.isInvalidated).toBe(
    true
  );
  expect(
    client.getQueryState(["post-feed", "latest", "viewer"])?.isInvalidated
  ).toBe(false);
  expect(client.getQueryData(["messages"])).toEqual({
    pageParams: [null, "valid"],
    pages: [1, 2],
  });
  client.clear();
});
