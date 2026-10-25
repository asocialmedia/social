import { beforeEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

const values = new Map<string, string>();
const jobs: unknown[] = [];
let unavailable = false;
let claimGate: Promise<undefined> | undefined;
let addGate: Promise<undefined> | undefined;
let addFails = false;
let claimFailsAfterSet = false;
mock.module("./redis", () => ({
  redis: {
    del: (key: string) => Promise.resolve(Number(values.delete(key))),
    eval: async (
      script: string,
      _count: number,
      key: string,
      ...args: string[]
    ) => {
      const [bucket, owner] = args;
      if (script.includes("DECR")) {
        if (values.get(key) !== owner) {
          return 0;
        }
        values.delete(key);
        values.set(
          bucket,
          String(Math.max(0, Number(values.get(bucket) ?? 0) - 1))
        );
        return 1;
      }
      await claimGate;
      if (values.has(key) || Number(values.get(bucket) ?? 0) >= 500) {
        return 0;
      }
      values.set(key, owner);
      values.set(bucket, String(Number(values.get(bucket) ?? 0) + 1));
      if (claimFailsAfterSet) {
        throw new Error("claim acknowledgement lost");
      }
      return 1;
    },
    mget: (...keys: string[]) =>
      unavailable
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(keys.map((key) => values.get(key) ?? null)),
  },
}));
mock.module("../queue", () => ({
  getQueue: () => ({
    add: async (_name: string, input: unknown) => {
      await addGate;
      if (addFails) {
        throw new Error("queue offline");
      }
      jobs.push(input);
    },
    getWaitingCount: () => Promise.resolve(0),
  }),
}));
const {
  externalMediaSafetyInput,
  filterExternalMediaSafety,
  releaseExternalMediaSafetyClaim,
} = await import("./external-media-safety");

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
  claimGate = undefined;
  addGate = undefined;
  addFails = false;
  claimFailsAfterSet = false;
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

test("a late claim after admission timeout is released without queuing stale work", async () => {
  const image = post("late-claim");
  const claim = Promise.withResolvers<undefined>();
  claimGate = claim.promise;
  expect(await filterExternalMediaSafety([image])).toEqual([]);
  claim.resolve();
  await Bun.sleep(0);
  expect(values.has(`${externalMediaSafetyInput(image).key}:queued`)).toBe(
    false
  );
  expect(jobs).toHaveLength(0);
  claimGate = undefined;
  await filterExternalMediaSafety([image]);
  expect(jobs).toHaveLength(1);
});

test("an in-flight queue addition keeps its successful claim and failed additions release it", async () => {
  const image = post("late-add");
  const addition = Promise.withResolvers<undefined>();
  addGate = addition.promise;
  await filterExternalMediaSafety([image]);
  addition.resolve();
  await Bun.sleep(0);
  expect(values.has(`${externalMediaSafetyInput(image).key}:queued`)).toBe(
    true
  );
  expect(jobs).toHaveLength(1);
  addGate = undefined;
  addFails = true;
  const failed = post("failed-add");
  await filterExternalMediaSafety([failed]);
  expect(values.has(`${externalMediaSafetyInput(failed).key}:queued`)).toBe(
    false
  );
});

test("a claim acknowledgement failure releases only this admission's claim", async () => {
  const image = post("lost-acknowledgement");
  claimFailsAfterSet = true;
  await filterExternalMediaSafety([image]);
  expect(values.has(`${externalMediaSafetyInput(image).key}:queued`)).toBe(
    false
  );
  expect(jobs).toHaveLength(0);
});

test("completed assessments release capacity exactly once without releasing a newer owner", async () => {
  const input = externalMediaSafetyInput(post("release"));
  const queuedAt = Date.now();
  const bucket = `external:media-safety:admission:${Math.floor(queuedAt / 900_000)}`;
  values.set(`${input.key}:queued`, "current-owner");
  values.set(bucket, "500");
  await releaseExternalMediaSafetyClaim({
    ...input,
    owner: "old-owner",
    queuedAt,
  });
  expect(values.get(bucket)).toBe("500");
  expect(values.get(`${input.key}:queued`)).toBe("current-owner");
  await releaseExternalMediaSafetyClaim({
    ...input,
    owner: "current-owner",
    queuedAt,
  });
  await releaseExternalMediaSafetyClaim({
    ...input,
    owner: "current-owner",
    queuedAt,
  });
  expect(values.get(bucket)).toBe("499");
  await filterExternalMediaSafety([post("new-capacity")]);
  expect(jobs).toHaveLength(1);
  expect(values.get(bucket)).toBe("500");
  await filterExternalMediaSafety([post("bounded")]);
  expect(jobs).toHaveLength(1);
});
