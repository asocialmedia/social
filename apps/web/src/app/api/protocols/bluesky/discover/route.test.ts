import { beforeEach, expect, mock, test } from "bun:test";

import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";
import type { DiscoveryPage } from "@asm/protocols/discovery";

let session: { user: { id: string } } | null = { user: { id: "reader" } };
let preferences = defaultNetworkPreferences();
let cached: DiscoveryPage | null = null;
let upstream: DiscoveryPage = { cursor: null, items: [], partial: false };
let excluded = new Set<string>();
const publications: string[] = [];
const cacheKeys: string[] = [];
const profile: UserProfile = {
  authorWeights: {},
  expandedEntityWeights: { politics: 99_999 },
  tagWeights: { news: 99_999, politics: 99_999, software: 1 },
};

const persona = mock((_userId: string, requestedProfileId?: string) => {
  const selected = preferences.profiles.find(
    (entry) => entry.id === (requestedProfileId ?? preferences.activeProfileId)
  );
  if (!selected) {
    throw new Error("Missing profile fixture");
  }
  return Promise.resolve({
    preferences,
    profile,
    revision: 7,
    selected,
    topicScope: {
      avoided: {},
      interests: { software: ["typescript", "react hooks", "next.js"] },
      version: "fixture",
    },
  });
});
const read = mock(() => Promise.resolve(upstream));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@asm/db", () => ({
  externalFollowAuthors: () => Promise.resolve([]),
  externalPostStates: () => Promise.resolve(new Map()),
  getClientIpFromHeaders: () => "127.0.0.1",
  getNetworkPersona: persona,
  getTrustedIngressIp: () => "127.0.0.1",
  hashViewerId: () => "ingress",
  networkContentTopics: (_text: string, tags: string[]) => tags,
  networkLanguageMatches: () => true,
  networkSocialCandidates: () =>
    Promise.resolve({ external: [], followedIds: [], native: [] }),
  recordSharedTopicRelations: () => Promise.resolve(),
  redis: {
    get: (key: string) => {
      cacheKeys.push(key);
      return Promise.resolve(
        cached ? JSON.stringify({ at: Date.now(), page: cached }) : null
      );
    },
    publish: (_channel: string, value: string) => {
      publications.push(value);
      return Promise.resolve(0);
    },
    set: () => Promise.resolve("OK"),
  },
}));
mock.module("@/lib/protocols/service", () => ({
  readBlueskyDiscovery: read,
  readBlueskyPosts: () => Promise.resolve([]),
  readBlueskyProfileResource: () =>
    Promise.resolve({ cursor: null, items: [] }),
}));
mock.module("@/lib/protocols/feedback", () => ({
  readExternalFeedback: () => Promise.resolve(excluded),
}));
mock.module("@/lib/protocols/budget", () => ({
  ProtocolBudgetError: class extends Error {},
  consumeProtocolBudget: () => Promise.resolve(),
}));
mock.module("next/server", () => ({ after: () => {} }));

const { GET } = await import("./route");

function post(id: string, text: string, video = false): ExternalPost {
  return {
    author: {
      displayName: "Fixture",
      handle: "fixture.test",
      id: "did:plc:fixture",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/did:plc:fixture",
    },
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    id: `at://did:plc:fixture/app.bsky.feed.post/${id}`,
    indexedAt: new Date(Date.now() - 60_000).toISOString(),
    labels: [],
    languages: ["en"],
    media: video
      ? [{ alt: "", type: "video", url: "https://video.example/clip.m3u8" }]
      : [],
    revision: "revision",
    segments: [{ text }],
    source: "bluesky",
    text,
    upstreamCounts: {
      likes: id === "politics" ? 10_000_000 : 0,
      quotes: 0,
      replies: 0,
      reposts: 0,
    },
    url: `https://bsky.app/profile/did:plc:fixture/post/${id}`,
  };
}

beforeEach(() => {
  session = { user: { id: "reader" } };
  preferences = {
    ...defaultNetworkPreferences(),
    language: "all",
    profiles: [
      {
        id: "default",
        interests: ["software", "web development", "tech"],
        name: "Dev",
      },
      { id: "politics-profile", interests: ["politics"], name: "Politics" },
    ],
  };
  upstream = {
    cursor: crypto.randomUUID(),
    items: [
      post("politics", "Election news and world politics", true),
      post("software", "TypeScript and React hooks tutorial"),
      post("software-video", "Next.js server components tutorial", true),
    ],
    partial: false,
  };
  cached = null;
  excluded = new Set();
  publications.length = 0;
  cacheKeys.length = 0;
  persona.mockClear();
  read.mockClear();
});

test("all five discovery modes enforce chosen interests before popularity and learned-topic ranking", async () => {
  await Promise.all(
    [
      ["personalized", "all"],
      ["latest", "all"],
      ["trending", "all"],
      ["personalized", "video"],
      ["latest", "video"],
    ].map(async ([mode, content]) => {
      const response = await GET(
        new Request(
          `http://localhost/api/protocols/bluesky/discover?mode=${mode}&content=${content}`
        )
      );
      const page: DiscoveryPage = await response.json();
      expect(response.status).toBe(200);
      expect(page.items.map((entry) => entry.id)).toEqual(
        upstream.items
          .filter(
            (entry) =>
              !entry.text.includes("politics") &&
              (content !== "video" || entry.media.length > 0)
          )
          .map((entry) => entry.id)
      );
      expect(page.cursor).toBe(upstream.cursor);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    })
  );
  for (const publication of publications) {
    const watch: { topics: string[] } = JSON.parse(publication);
    expect(watch.topics).toContain("software");
    expect(watch.topics).not.toContain("politics");
  }
});

test("cached heads are filtered against the selected profile and its current exclusions", async () => {
  cached = upstream;
  preferences.avoidedTopics = ["typescript"];
  const response = await GET(
    new Request("http://localhost/api/protocols/bluesky/discover?mode=trending")
  );
  const page: DiscoveryPage = await response.json();
  expect(response.status).toBe(200);
  expect(page.items.map((entry) => entry.id)).toEqual([upstream.items[2]?.id]);
  expect(read).not.toHaveBeenCalled();

  preferences.activeProfileId = "politics-profile";
  const switched = await GET(
    new Request("http://localhost/api/protocols/bluesky/discover?mode=trending")
  );
  const politicalPage: DiscoveryPage = await switched.json();
  expect(politicalPage.items.map((entry) => entry.id)).toEqual([
    upstream.items[0]?.id,
  ]);
  expect(cacheKeys[0]).not.toBe(cacheKeys[1]);
});

test("an unmatched profile preserves continuation without filling a page with unrelated posts", async () => {
  preferences.profiles = [
    { id: "default", interests: ["violin restoration"], name: "Unmatched" },
  ];
  const cursor = crypto.randomUUID();
  const response = await GET(
    new Request(
      `http://localhost/api/protocols/bluesky/discover?mode=latest&cursor=${cursor}`
    )
  );
  const page: DiscoveryPage = await response.json();
  expect(response.status).toBe(200);
  expect(page.items).toEqual([]);
  expect(page.cursor).toBe(upstream.cursor);
  expect(read).toHaveBeenCalled();
  expect(cacheKeys).toEqual([]);
});

test("an explicit requested profile controls eligibility and guests can still browse", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/protocols/bluesky/discover?profile=politics-profile"
    )
  );
  const page: DiscoveryPage = await response.json();
  expect(persona).toHaveBeenCalledWith("reader", "politics-profile");
  expect(page.items.map((entry) => entry.id)).toEqual([upstream.items[0]?.id]);

  session = null;
  const guest = await GET(
    new Request("http://localhost/api/protocols/bluesky/discover")
  );
  const guestPage: DiscoveryPage = await guest.json();
  expect(guest.status).toBe(200);
  expect(guestPage.items).toHaveLength(3);
  expect(
    guestPage.items.every((entry) => !entry.networkRecommendationToken)
  ).toBe(true);
});
