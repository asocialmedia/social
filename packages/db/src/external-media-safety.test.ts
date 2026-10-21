import { beforeEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

const values = new Map<string, string>();
const jobs: unknown[] = [];
let unavailable = false;
mock.module("./redis", () => ({
  redis: {
    del: (key: string) => Promise.resolve(Number(values.delete(key))),
    eval: (_script: string, _count: number, key: string) => {
      if (values.has(key)) {
        return Promise.resolve(0);
      }
      values.set(key, "1");
      return Promise.resolve(1);
    },
    mget: (...keys: string[]) =>
      unavailable
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(keys.map((key) => values.get(key) ?? null)),
  },
}));
mock.module("../queue", () => ({
  getQueue: () => ({
    add: (_name: string, input: unknown) => {
      jobs.push(input);
      return Promise.resolve();
    },
    getWaitingCount: () => Promise.resolve(0),
  }),
}));
const { externalMediaSafetyInput, filterExternalMediaSafety } =
  await import("./external-media-safety");

const post = (id: string, media = true): ExternalPost => ({
  author: {
    displayName: "Artist",
    handle: "artist.test",
    id: "did:plc:artist",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/artist.test",
  },
  createdAt: new Date().toISOString(),
  id,
  indexedAt: new Date().toISOString(),
  labels: [],
  languages: ["en"],
  media: media
    ? [
        {
          alt: "",
          type: "image",
          url: `https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:artist/${id}`,
        },
      ]
    : [],
  revision: "cid",
  segments: [],
  source: "bluesky",
  text: "Bun boy art for a friend",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/post/test",
});

beforeEach(() => {
  values.clear();
  jobs.length = 0;
  unavailable = false;
});

test("unlabelled media is withheld and queued once; only an explicit safe verdict releases it", async () => {
  const image = post("unknown");
  const text = post("text", false);
  expect(await filterExternalMediaSafety([image, text])).toEqual([text]);
  await filterExternalMediaSafety([image]);
  expect(jobs).toHaveLength(1);
  values.set(externalMediaSafetyInput(image).key, "safe");
  expect(await filterExternalMediaSafety([image])).toEqual([image]);
  values.set(externalMediaSafetyInput(image).key, "explicit");
  expect(await filterExternalMediaSafety([image])).toEqual([]);
});

test("Redis failures preserve text and never approve unchecked images or quoted media", async () => {
  const text = post("text", false);
  const quote = { ...post("parent", false), quote: post("quoted") };
  unavailable = true;
  expect(await filterExternalMediaSafety([text, quote])).toEqual([text]);
  expect(externalMediaSafetyInput(quote).images).toHaveLength(1);
  expect(jobs).toHaveLength(0);
});

test("changed image references cannot reuse an earlier safe verdict", async () => {
  const image = post("first");
  values.set(externalMediaSafetyInput(image).key, "safe");
  const edited = { ...image, media: post("replacement").media };
  expect(await filterExternalMediaSafety([edited])).toEqual([]);
});
