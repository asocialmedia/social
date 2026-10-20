import { expect, test } from "bun:test";

import { authorDid, postFixture, profileFixture } from "../testing/fixtures";
import {
  isAuthFeed,
  isAuthFeedUri,
  isAuthenticationNotice,
} from "./auth-feeds";
import { BlueskyClient } from "./client";
import { normalizePost } from "./normalize";
import { postViewSchema } from "./schemas";

test("identifies auth and personalized feed URIs", () => {
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/for-you`)
  ).toBe(true);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/with-friends`)
  ).toBe(true);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/mutuals`)
  ).toBe(true);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/only-posts`)
  ).toBe(true);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/mentions`)
  ).toBe(true);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/followpics`)
  ).toBe(true);
  expect(
    isAuthFeedUri(
      "at://did:plc:tenurhgjptubkk5zf5qhi3og/app.bsky.feed.generator/discover"
    )
  ).toBe(true);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/whats-hot`)
  ).toBe(false);
  expect(
    isAuthFeedUri(`at://${authorDid}/app.bsky.feed.generator/for-science`)
  ).toBe(false);
});

test("identifies auth and personalized feeds by description", () => {
  expect(
    isAuthFeed({
      description: "A personalized algorithmic feed based on your likes.",
      displayName: "For You",
      uri: `at://${authorDid}/app.bsky.feed.generator/custom-feed-1`,
    })
  ).toBe(true);
  expect(
    isAuthFeed({
      description:
        "Posts from accounts you follow and content that your follows like.",
      displayName: "Friends Feed",
      uri: `at://${authorDid}/app.bsky.feed.generator/custom-feed-2`,
    })
  ).toBe(true);
  expect(
    isAuthFeed({
      description: "Posts from users who are following you back.",
      displayName: "My Mutuals",
      uri: `at://${authorDid}/app.bsky.feed.generator/custom-feed-3`,
    })
  ).toBe(true);
  expect(
    isAuthFeed({
      description: "This feed requires user authentication via Bluesky JWT.",
      displayName: "Private Feed",
      uri: `at://${authorDid}/app.bsky.feed.generator/custom-feed-4`,
    })
  ).toBe(true);
  expect(
    isAuthFeed({
      description:
        "You have to be logged in for this feed because it's personalized",
      displayName: "Logged In Only",
      uri: `at://${authorDid}/app.bsky.feed.generator/custom-feed-5`,
    })
  ).toBe(true);

  expect(
    isAuthFeed({
      description:
        "The Science Feed. A curated feed from Bluesky professional scientists.",
      displayName: "Science",
      uri: `at://${authorDid}/app.bsky.feed.generator/for-science`,
    })
  ).toBe(false);
  expect(
    isAuthFeed({
      description: "Trending content from your personal network",
      displayName: "Discover",
      uri: `at://${authorDid}/app.bsky.feed.generator/whats-hot`,
    })
  ).toBe(false);
});

test("detects feed authentication error notice posts", () => {
  const screenshotNotice =
    "This feed requires authentication.\n\nMake sure you're logged into your Bluesky account to access this personalized feed.\n\nYour Bluesky client made a request with no JWT token attached. The JWT token is how For You identifies who you are so it can personalize your feed.";
  expect(isAuthenticationNotice(screenshotNotice)).toBe(true);
  expect(
    isAuthenticationNotice(
      "You have to be logged in for this feed because it's personalized"
    )
  ).toBe(true);

  expect(
    isAuthenticationNotice(
      "Our backend now supports WebAuthn authentication mechanisms for user security."
    )
  ).toBe(false);
});

test("BlueskyClient excludes auth feeds from suggestions and rejects direct getFeed", async () => {
  const catalog = {
    feeds: [
      {
        cid: postFixture.cid,
        creator: profileFixture,
        description: "A personalized algorithmic feed based on your likes.",
        did: authorDid,
        displayName: "For You",
        indexedAt: postFixture.indexedAt,
        uri: `at://${authorDid}/app.bsky.feed.generator/for-you`,
      },
      {
        cid: postFixture.cid,
        creator: profileFixture,
        description: "Curated posts from verified researchers and astronomers.",
        did: authorDid,
        displayName: "Science",
        indexedAt: postFixture.indexedAt,
        uri: `at://${authorDid}/app.bsky.feed.generator/for-science`,
      },
    ],
  };

  const client = new BlueskyClient({
    fetch: () => Promise.resolve(Response.json(catalog)),
  });
  const suggested = await client.getSuggestedFeeds({ limit: 10 });
  expect(suggested.items).toHaveLength(1);
  expect(suggested.items[0]?.displayName).toBe("Science");

  await expect(
    client.getFeed(`at://${authorDid}/app.bsky.feed.generator/for-you`)
  ).rejects.toMatchObject({
    code: "restricted",
  });
});

test("normalizePost restricts auth notice posts from rendering", () => {
  const noticePost = postViewSchema.parse({
    ...postFixture,
    record: {
      ...postFixture.record,
      text: "This feed requires authentication.\n\nMake sure you're logged into your Bluesky account to access this personalized feed.",
    },
  });
  expect(() => normalizePost(noticePost)).toThrow();

  const regularPost = postViewSchema.parse({
    ...postFixture,
    record: {
      ...postFixture.record,
      text: "Normal public post content about astronomy and stargazing.",
    },
  });
  const normalized = normalizePost(regularPost);
  expect(normalized.text).toBe(regularPost.record.text);
});
