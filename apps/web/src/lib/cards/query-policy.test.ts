import { expect, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { CARD_QUERY_POLICY } from "./query-policy";

test("cards render cached data on another page without fetching again, and events still refresh", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let requests = 0;
  const options = {
    ...CARD_QUERY_POLICY,
    queryFn: () => Promise.resolve((requests += 1)),
    queryKey: ["discovery-suggestions", "viewer", "profile-a"],
  };
  try {
    const firstPage = new QueryObserver(client, options);
    const leaveFirstPage = firstPage.subscribe(() => {});
    await firstPage.refetch();
    leaveFirstPage();
    const secondPage = new QueryObserver(client, options);
    expect(secondPage.getCurrentResult().data).toBe(1);
    const leaveSecondPage = secondPage.subscribe(() => {});
    expect(requests).toBe(1);
    await client.invalidateQueries({
      queryKey: ["discovery-suggestions", "viewer"],
    });
    expect(secondPage.getCurrentResult().data).toBe(2);
    expect(requests).toBe(2);
    leaveSecondPage();
  } finally {
    client.clear();
  }
});

test("expired data stays visible while refreshing and profile/viewer caches stay separate", async () => {
  const client = new QueryClient();
  const key = ["trending-feed", "v5", "viewer-a", "profile-a"];
  client.setQueryData(key, "cached", {
    updatedAt: Date.now() - CARD_QUERY_POLICY.staleTime - 1000,
  });
  const refresh = Promise.withResolvers<string>();
  const observer = new QueryObserver(client, {
    ...CARD_QUERY_POLICY,
    queryFn: () => refresh.promise,
    queryKey: key,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(observer.getCurrentResult().data).toBe("cached");
    expect(observer.getCurrentResult().isFetching).toBe(true);
    expect(
      client.getQueryData(["trending-feed", "v5", "viewer-b", "profile-a"])
    ).toBeUndefined();
    expect(
      client.getQueryData(["trending-feed", "v5", "viewer-a", "profile-b"])
    ).toBeUndefined();
    const refreshed = observer.refetch({ cancelRefetch: false });
    refresh.resolve("fresh");
    await refreshed;
    expect(observer.getCurrentResult().data).toBe("fresh");
  } finally {
    unsubscribe();
    client.clear();
  }
});
