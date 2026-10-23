import { beforeEach, expect, mock, test } from "bun:test";

import type { UserProfile } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import {
  defaultNetworkPreferences,
  discoveryTopicsSchema,
} from "@asm/protocols/discovery";
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
      related: { software: ["ajax (programming)", "automattic"] },
      version: "fixture",
    },
  });
});
const read = mock(() => Promise.resolve(upstream));
const safety = mock((posts: ExternalPost[]) => Promise.resolve(posts));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@asm/db", () => ({
  externalFollowAuthors: () => Promise.resolve([]),
  externalPostStates: () => Promise.resolve(new Map()),
  filterExternalMediaSafety: safety,
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
      likes: id === "politics" ? 10_000_000 : 50,
      quotes: 0,
      replies: 0,
      reposts: 0,
    },
    url: `https://bsky.app/profile/did:plc:fixture/post/${id}`,
  };
}

beforeEach(() => {
  safety.mockClear();
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
      expect(page.items.map((entry) => entry.id).toSorted()).toEqual(
        upstream.items
          .filter(
            (entry) =>
              !entry.text.includes("politics") &&
              (content !== "video" || entry.media.length > 0)
          )
          .map((entry) => entry.id)
          .toSorted()
      );
      expect(page.cursor).toBe(upstream.cursor);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    })
  );
  for (const publication of publications) {
    const watch: { content: string; topics: string[] } =
      JSON.parse(publication);
    if (!watch.topics.includes("software")) {
      expect(watch.content).toBe("video");
      expect(watch.topics).toEqual(["ajax programming", "automattic"]);
    }
    expect(watch.topics).not.toContain("politics");
  }
});

test("primary interest labels are valid for protocol reads and event watches", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/protocols/bluesky/discover?mode=trending&content=all&profile=default&locale=en-IN"
    )
  );
  expect(response.status).toBe(200);
  const topics = ["software", "web development", "tech"];
  expect(read).toHaveBeenCalledWith(
    "trending",
    undefined,
    expect.any(AbortSignal),
    expect.any(String),
    "en-IN",
    topics,
    false,
    "all"
  );
  expect(publications).toHaveLength(2);
  const watch: { topics: string[] } = JSON.parse(publications[0] ?? "{}");
  expect(discoveryTopicsSchema.parse(watch.topics)).toEqual(topics);
  expect(JSON.parse(publications[1] ?? "{}")).toMatchObject({
    content: "video",
    topics: ["ajax programming", "automattic"],
  });
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

test("quiet external posts cannot qualify for trending discovery", async () => {
  upstream.items = [
    {
      ...post("quiet", "TypeScript tutorial"),
      upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    },
    {
      ...post("engaged", "TypeScript tutorial"),
      upstreamCounts: { likes: 25, quotes: 0, replies: 0, reposts: 0 },
    },
  ];
  const response = await GET(
    new Request("http://localhost/api/protocols/bluesky/discover?mode=trending")
  );
  const page: DiscoveryPage = await response.json();
  expect(page.items.map((entry) => entry.id)).toEqual([upstream.items[1]?.id]);
});

test("Explore gates discovery by the active interests and exclusions", async () => {
  preferences.avoidedTopics = ["politics"];
  upstream.items = [
    post("related", "TypeScript software engineering"),
    post("broad", "Cats playing"),
    post("blocked", "Politics news"),
  ];
  const response = await GET(
    new Request(
      "http://localhost/api/protocols/bluesky/discover?mode=personalized&surface=explore"
    )
  );
  const page: DiscoveryPage = await response.json();
  expect(response.status).toBe(200);
  expect(page.items.map((entry) => entry.id)).toEqual([upstream.items[0]?.id]);
  const watch: { topics: string[] } = JSON.parse(publications[0] ?? "{}");
  expect(watch.topics).toContain("software");
  expect(watch.topics).not.toContain("automattic");
});

test("guests cannot request explicit snapshots and every discovery surface enforces an engagement floor", async () => {
  session = null;
  const clean = post("engaged", "A useful programming demonstration", true);
  const adult = {
    ...post("adult", "Preview", true),
    author: { ...clean.author, description: "18+ NSFW creator" },
  };
  const quiet = {
    ...post("quiet", "Unreviewed random text", true),
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  };
  const quoted = {
    ...post("quoted", "Look at this", true),
    quote: { ...clean, labels: ["porn"] },
  };
  cached = {
    cursor: null,
    items: [clean, adult, quiet, quoted],
    partial: false,
  };
  for (const mode of ["latest", "personalized", "trending"]) {
    for (const surface of ["home", "explore"]) {
      // oxlint-disable-next-line no-await-in-loop -- compare each public surface against the same hostile cached candidates.
      const response = await GET(
        new Request(
          `http://localhost/api/protocols/bluesky/discover?mode=${mode}&surface=${surface}&content=video&explicit=1`
        )
      );
      // oxlint-disable-next-line no-await-in-loop -- assert the response before changing request scope.
      const page = await response.json();
      expect(response.status).toBe(200);
      expect(page.items.map((entry: { id: string }) => entry.id)).toEqual([
        clean.id,
      ]);
    }
  }
});

test("adult opt-in permits labeled media while avoid topics remain enforced", async () => {
  preferences = {
    ...preferences,
    avoidedTopics: ["furry"],
    showExplicitContent: true,
  };
  const adult = {
    ...post("opted", "Software tutorial", true),
    labels: ["porn"],
  };
  const excludedAdult = {
    ...post("avoided", "Software furry tutorial", true),
    labels: ["porn"],
  };
  cached = { cursor: null, items: [adult, excludedAdult], partial: false };
  const response = await GET(
    new Request(
      "http://localhost/api/protocols/bluesky/discover?mode=personalized"
    )
  );
  const page = await response.json();
  expect(page.items.map((entry: { id: string }) => entry.id)).toEqual([
    adult.id,
  ]);
});

test("off-topic candidates are removed before visual safety admission", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/protocols/bluesky/discover?mode=personalized&content=all"
    )
  );
  expect(response.status).toBe(200);
  const assessed = safety.mock.calls.flatMap(([posts]) =>
    posts.map((entry) => entry.id)
  );
  expect(assessed).toContain(
    "at://did:plc:fixture/app.bsky.feed.post/software"
  );
  expect(assessed).not.toContain(
    "at://did:plc:fixture/app.bsky.feed.post/politics"
  );
});
