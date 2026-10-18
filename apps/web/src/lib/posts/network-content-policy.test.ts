import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import {
  externalNetworkPostAllowed,
  networkPostAllowed,
  networkPostRecommended,
  externalNetworkPostRecommended,
} from "./network-content-policy";
import { externalPostView } from "./presentation";

const source: ExternalPost = {
  author: {
    displayName: "Example",
    handle: "example.test",
    id: "did:plc:example",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/example.test",
  },
  createdAt: "2026-10-18T00:00:00.000Z",
  id: "at://did:plc:example/app.bsky.feed.post/example",
  labels: [],
  languages: [],
  media: [
    {
      alt: "A landscape clip",
      type: "video",
      url: "https://video.bsky.app/playlist.m3u8",
    },
  ],
  revision: "revision",
  segments: [{ text: "A new clip" }],
  source: "bluesky",
  text: "A new clip",
  upstreamCounts: {},
  url: "https://bsky.app/profile/example.test/post/example",
};

test("cached recommendations obey the active profile, including media metadata and relevant quoted context", () => {
  const preferences = {
    ...defaultNetworkPreferences(),
    profiles: [
      {
        id: "default",
        interests: ["web development", "software"],
        name: "Dev",
      },
      {
        id: "11111111-1111-4111-8111-111111111111",
        interests: ["politics"],
        name: "Politics",
      },
    ],
  };
  const topicScope = {
    avoided: {},
    interests: {
      software: ["typescript"],
      "web development": ["react hooks", "typescript"],
    },
    version: "fixture",
  };
  const political = { ...source, text: "Election politics and world news" };
  expect(networkPostRecommended(externalPostView(political), preferences)).toBe(
    false
  );
  expect(
    networkPostRecommended(
      { ...externalPostView(political), external: undefined },
      preferences
    )
  ).toBe(false);
  expect(
    networkPostRecommended(externalPostView(political), {
      ...preferences,
      activeProfileId: "11111111-1111-4111-8111-111111111111",
    })
  ).toBe(true);
  expect(
    externalNetworkPostRecommended(
      {
        ...source,
        quote: { ...source, text: "React hooks tutorial" },
        text: "Thoughts?",
      },
      preferences,
      undefined,
      topicScope
    )
  ).toBe(true);
  expect(
    networkPostRecommended(
      {
        ...externalPostView(source),
        external: undefined,
        semanticTags: ["typescript"],
      },
      preferences,
      topicScope
    )
  ).toBe(true);
  expect(networkPostAllowed(externalPostView(political), preferences)).toBe(
    true
  );
});

test("avoided source labels remain hard exclusions even after opting into 18+", () => {
  const preferences = {
    ...defaultNetworkPreferences(),
    avoidedTopics: ["porn"],
    showExplicitContent: true,
  };
  expect(
    externalNetworkPostAllowed({ ...source, labels: ["porn"] }, preferences)
  ).toBe(false);
  expect(
    externalNetworkPostAllowed(
      { ...source, author: { ...source.author, labels: ["porn"] } },
      preferences
    )
  ).toBe(false);
  expect(
    externalNetworkPostAllowed({ ...source, selfLabels: ["porn"] }, preferences)
  ).toBe(false);
});

test("an innocent outer post cannot smuggle an excluded or explicit quoted post into a feed", () => {
  const preferences = {
    ...defaultNetworkPreferences(),
    avoidedTopics: ["furry", "porn"],
  };
  for (const quote of [
    { ...source, tags: ["furryart"] },
    { ...source, labels: ["porn"] },
    {
      ...source,
      externalLink: {
        description: "#furryimages",
        title: "A clip",
        url: "https://example.test",
      },
    },
  ]) {
    const post = { ...source, quote, text: "Software and web development" };
    expect(externalNetworkPostAllowed(post, preferences)).toBe(false);
    expect(networkPostAllowed(externalPostView(post), preferences)).toBe(false);
  }
  expect(
    externalNetworkPostAllowed({ ...source, quote: source }, preferences)
  ).toBe(true);
});

test("current exclusions remove already cached Gusts from native and external sources", () => {
  const external = externalPostView({ ...source, tags: ["furryart"] });
  const native = {
    ...externalPostView(source),
    external: undefined,
    semanticTags: ["furryimage"],
  };
  const preferences = defaultNetworkPreferences();
  expect(networkPostAllowed(external, preferences)).toBe(true);
  expect(networkPostAllowed(native, preferences)).toBe(true);
  const blocked = { ...preferences, avoidedTopics: ["furry"] };
  expect(networkPostAllowed(external, blocked)).toBe(false);
  expect(networkPostAllowed(native, blocked)).toBe(false);
  expect(networkPostAllowed(external, preferences)).toBe(true);
});

test("metadata, alt text, and source labels still apply to cached presentations", () => {
  const preferences = {
    ...defaultNetworkPreferences(),
    avoidedTopics: ["furry"],
  };
  const alt = externalPostView({
    ...source,
    media: [
      {
        alt: "Digital furryimages",
        type: "video",
        url: "https://video.bsky.app/playlist.m3u8",
      },
    ],
  });
  expect(networkPostAllowed(alt, preferences)).toBe(false);
  const nativeAlt = { ...alt, external: undefined };
  expect(networkPostAllowed(nativeAlt, preferences)).toBe(false);
  const labeled = externalPostView(source);
  const cached = {
    ...labeled,
    explicitContent: false,
    external: { ...source, selfLabels: ["porn"] },
  };
  expect(networkPostAllowed(cached, defaultNetworkPreferences())).toBe(false);
  expect(
    networkPostAllowed(cached, {
      ...defaultNetworkPreferences(),
      showExplicitContent: true,
    })
  ).toBe(true);
});

test("new account defaults hide adult native clips and an explicit opt-in preserves topic exclusions", () => {
  const native = {
    ...externalPostView(source),
    explicitContent: true,
    external: undefined,
  };
  expect(networkPostAllowed(native, defaultNetworkPreferences())).toBe(false);
  expect(
    networkPostAllowed(native, {
      ...defaultNetworkPreferences(),
      showExplicitContent: true,
    })
  ).toBe(true);
  expect(
    networkPostAllowed(
      { ...native, semanticTags: ["furrydrawing"] },
      {
        ...defaultNetworkPreferences(),
        avoidedTopics: ["furry"],
        showExplicitContent: true,
      }
    )
  ).toBe(false);
});

test("new accounts or accounts with no configured interests strictly do not receive adult Bluesky content by default", () => {
  const defaultPrefs = defaultNetworkPreferences();
  expect(defaultPrefs.showExplicitContent).toBe(false);
  expect(defaultPrefs.profiles[0]?.interests).toEqual([]);

  const adultPosts: ExternalPost[] = [
    { ...source, labels: ["nsfw"] },
    { ...source, labels: ["porn"] },
    { ...source, labels: ["adult"] },
    { ...source, selfLabels: ["nudity"] },
    { ...source, author: { ...source.author, labels: ["sexual"] } },
    { ...source, tags: ["nsfw"] },
    { ...source, tags: ["18+"] },
    { ...source, tags: ["r18"] },
    { ...source, text: "Some art #nsfw" },
  ];

  for (const post of adultPosts) {
    expect(externalNetworkPostAllowed(post, defaultPrefs)).toBe(false);
    expect(externalNetworkPostRecommended(post, defaultPrefs)).toBe(false);
    expect(networkPostAllowed(externalPostView(post), defaultPrefs)).toBe(
      false
    );
  }

  const enabledPrefs = { ...defaultPrefs, showExplicitContent: true };
  const firstAdult = adultPosts[0] ?? source;
  expect(externalNetworkPostAllowed(firstAdult, enabledPrefs)).toBe(true);
  expect(externalNetworkPostRecommended(firstAdult, enabledPrefs)).toBe(true);
});
