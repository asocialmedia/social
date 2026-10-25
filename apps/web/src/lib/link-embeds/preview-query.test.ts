import { afterEach, expect, test } from "bun:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

import { fetchLinkPreview, linkPreviewQueryOptions } from "./preview-query";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubResponse(status: number, body?: unknown) {
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        Response.json(body ?? { embed: null }, { status })
      );
    },
    { preconnect: originalFetch.preconnect }
  );
  return calls;
}

test.each([200, 422])(
  "unavailable metadata (%i) is cached across badge, comment, composer, and message mounts",
  async (status) => {
    const calls = stubResponse(status);
    const client = new QueryClient();
    const options = linkPreviewQueryOptions("https://example.com/no-preview");
    try {
      expect(await client.fetchQuery(options)).toBeNull();
      const observer = new QueryObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      expect(observer.getCurrentResult().status).toBe("success");
      expect(observer.getCurrentResult().data).toBeNull();
      expect(await client.fetchQuery(options)).toBeNull();
      expect(calls).toHaveLength(1);
      unsubscribe();
    } finally {
      client.clear();
    }
  }
);

test("a valid preview remains available to every consumer", async () => {
  const embed = {
    title: "Example",
    type: "opengraph",
    url: "https://example.com",
  };
  stubResponse(200, { embed });
  expect(
    await fetchLinkPreview(embed.url, new AbortController().signal)
  ).toEqual(embed);
});

test.each([429, 503])(
  "%i remains an operational failure, not a cached missing preview",
  async (status) => {
    const calls = stubResponse(status);
    const client = new QueryClient();
    try {
      await expect(
        client.fetchQuery(linkPreviewQueryOptions("https://example.com"))
      ).rejects.toThrow("preview unavailable");
      expect(calls).toHaveLength(1);
    } finally {
      client.clear();
    }
  }
);

test("cancelled queued requests never fetch", async () => {
  const calls = stubResponse(200);
  const controller = new AbortController();
  controller.abort();
  await expect(
    fetchLinkPreview("https://example.com", controller.signal)
  ).rejects.toBeDefined();
  expect(calls).toHaveLength(0);
});
