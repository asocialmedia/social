import { expect, test } from "bun:test";

import { readDiscoveryPage } from "@asm/protocols/discovery";

const page = { cursor: null, items: [], partial: false };

test("an expired discovery cursor restarts at the head instead of failing the feed", async () => {
  const urls: string[] = [];
  const result = await readDiscoveryPage({
    cursor: "expired",
    fetch: (url) => {
      urls.push(url);
      return Promise.resolve(
        urls.length === 1
          ? new Response(null, { status: 410 })
          : Response.json(page)
      );
    },
    mode: "latest",
    signal: new AbortController().signal,
  });
  expect(result.items).toEqual([]);
  expect(urls).toHaveLength(2);
  expect(urls[0]).toContain("cursor=expired");
  expect(urls[1]).not.toContain("cursor=");
});

test("a closed browser stream is retried within the discovery read budget", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await readDiscoveryPage({
    fetch: () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError("NetworkError: NS_BASE_STREAM_CLOSED"))
        : Promise.resolve(Response.json(page));
    },
    mode: "latest",
    signal: new AbortController().signal,
    wait: (delay) => {
      waits.push(delay);
      return Promise.resolve();
    },
  });
  expect(result.items).toEqual([]);
  expect(calls).toBe(2);
  expect(waits).toHaveLength(1);
});
