import { expect, test } from "bun:test";

import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";

import { discoveryTopics, rankExternalForViewer } from "./recommendations";

const profile: UserProfile = {
  authorWeights: {},
  negativeTagWeights: { politics: 5 },
  tagWeights: { astronomy: 8, gardening: 2, politics: 1 },
};
const post = (id: string, text: string): ExternalPost => ({
  author: {
    displayName: "Fixture",
    handle: "fixture.test",
    id: "did:plc:fixture",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:fixture",
  },
  createdAt: "2026-10-18T10:00:00Z",
  id,
  indexedAt: "2026-10-18T10:00:01Z",
  labels: [],
  languages: [],
  media: [],
  revision: "revision",
  segments: [{ text }],
  source: "bluesky",
  text,
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:fixture/post/example",
});

test("discovery terms come from weighted persona signals without negative topics or query operators", () => {
  expect(discoveryTopics(profile)).toEqual(["astronomy", "gardening"]);
  expect(
    discoveryTopics({
      authorWeights: {},
      tagWeights: { "from:someone OR *": 2 },
    })
  ).toEqual(["from someone or"]);
});

test("different personas rank the same live candidates differently and penalize negative interests", () => {
  const posts = [
    post("politics", "politics"),
    post("garden", "gardening"),
    post("space", "astronomy"),
  ];
  expect(rankExternalForViewer(posts, profile).map((item) => item.id)).toEqual([
    "space",
    "garden",
    "politics",
  ]);
  expect(
    rankExternalForViewer(posts, {
      authorWeights: {},
      tagWeights: { gardening: 10 },
    })[0]?.id
  ).toBe("garden");
  expect(posts[0]?.id).toBe("politics");
});

test("structured tags and alt text personalize even when the caption has no topic words", () => {
  const plain = post("plain", "A new post");
  const alt = {
    ...post("alt", "A new post"),
    media: [
      {
        alt: "An astronomy observatory",
        type: "image" as const,
        url: "https://cdn.bsky.app/image.jpg",
      },
    ],
  };
  const tagged = { ...post("tagged", "A new post"), tags: ["Astronomy"] };
  expect(
    rankExternalForViewer([plain, alt, tagged], profile).map((item) => item.id)
  ).toEqual(["tagged", "alt", "plain"]);
  const avoided = {
    ...tagged,
    facets: { links: [], mentions: [], tags: ["Politics"] },
    id: "avoided",
  };
  expect(rankExternalForViewer([avoided, plain], profile)[0]?.id).toBe("plain");
});

test("interest maps add together instead of overwriting native, topic and session preferences", () => {
  const preferences = {
    authorWeights: {},
    sessionTagWeights: { space: 1 },
    tagWeights: { gardening: 5, space: 3 },
    topicAffinities: { space: 2 },
  };
  expect(discoveryTopics(preferences)).toEqual(["space", "gardening"]);
  expect(
    rankExternalForViewer(
      [
        { ...post("garden", ""), tags: ["gardening"] },
        { ...post("space", ""), tags: ["space"] },
      ],
      preferences
    )[0]?.id
  ).toBe("space");
});

test("author avoidance and format taste use the same ASM persona", () => {
  const known = post("known", "Hello");
  const image = {
    ...post("image", "Hello"),
    author: { ...known.author, id: "did:plc:other" },
    media: [
      {
        alt: "Portrait",
        type: "image" as const,
        url: "https://cdn.bsky.app/image.jpg",
      },
    ],
  };
  const preferences = {
    authorWeights: { [known.author.id]: 2 },
    formatAffinities: { audio: 0, image: 1, text: 0, video: 0 },
    tagWeights: {},
  };
  expect(rankExternalForViewer([image, known], preferences)[0]?.id).toBe(
    "known"
  );
  expect(
    rankExternalForViewer([known, image], {
      ...preferences,
      negativeAuthorWeights: { [known.author.id]: 5 },
    })[0]?.id
  ).toBe("image");
});

test("regional metadata, freshness and top-level originals improve weak-interest ties", () => {
  const now = Date.parse("2026-10-18T10:00:00Z");
  const plain = post("plain", "Hello");
  const regional = { ...post("regional", "Hello"), tags: ["India"] };
  const reply = { ...post("reply", "Hello"), replyTo: plain.id };
  const old = { ...post("old", "Hello"), createdAt: "2026-10-01T10:00:00Z" };
  const preferences = { authorWeights: {}, tagWeights: {} };
  expect(
    rankExternalForViewer([old, reply, plain, regional], preferences, {
      locale: "en-IN",
      now,
    }).map((item) => item.id)
  ).toEqual(["regional", "plain", "reply", "old"]);
  expect(
    rankExternalForViewer(
      [plain, { ...plain, id: "english", languages: ["en"] }],
      preferences,
      { locale: "en-IN", now }
    )[0]?.id
  ).toBe("plain");
});
