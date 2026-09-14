import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  FYP_PROFILE_KEY_PREFIX,
  buildAndCacheProfile,
  generateLocalEmbedding,
  getSocialProofPostWeights,
  getPersonalizedFeedPage,
  invalidateFypProfile,
  prisma,
  redis,
} from "@asm/db";
import { createLogger } from "@asm/logger";

const logger = createLogger({
  level: "debug",
  serviceName: "recommendation-integration",
});

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const PROFILE_KEY = `${FYP_PROFILE_KEY_PREFIX}rec-it-viewer-${RUN_ID}`;
const SECOND_PROFILE_KEY = `${FYP_PROFILE_KEY_PREFIX}rec-it-viewer-b-${RUN_ID}`;
const USER_IDS = {
  coldStart: `rec-it-cold-start-${RUN_ID}`,
  explorer: `rec-it-explorer-${RUN_ID}`,
  favorite: `rec-it-favorite-${RUN_ID}`,
  local: `rec-it-local-${RUN_ID}`,
  peer: `rec-it-peer-${RUN_ID}`,
  remote: `rec-it-remote-${RUN_ID}`,
  viewer: `rec-it-viewer-${RUN_ID}`,
  viewerB: `rec-it-viewer-b-${RUN_ID}`,
} as const;

const POST_IDS: string[] = [];
const MEDIA_IDS: string[] = [];

let sourcePostId = "";
let collaborativePostId = "";
let socialProofPostId = "";
let commentProofPostId = "";
let localPostId = "";
let remotePostId = "";
let unrelatedPostId = "";
let gustPostId = "";

function embedding(text: string): number[] {
  return generateLocalEmbedding(text);
}

async function createUser(userId: string, country?: string): Promise<void> {
  await prisma.user.create({
    data: {
      displayName: userId,
      email: `${userId}@example.test`,
      id: userId,
      username: userId,
    },
  });

  if (country) {
    await prisma.session.create({
      data: {
        country,
        expiresAt: new Date(Date.now() + 86_400_000),
        id: `${userId}-session`,
        token: `${userId}-token`,
        userId,
      },
    });
  }
}

async function createPost(input: {
  authorId: string;
  content: string;
  createdAt: Date;
  id: string;
  isGust?: boolean;
  semanticTags: string[];
  vectorText: string;
}): Promise<void> {
  await prisma.post.create({
    data: {
      content: input.content,
      createdAt: input.createdAt,
      embedding: embedding(input.vectorText),
      id: input.id,
      isGust: input.isGust ?? false,
      semanticTags: input.semanticTags,
      userId: input.authorId,
    },
  });
  POST_IDS.push(input.id);
}

async function createVideoAttachment(
  postId: string,
  userId: string
): Promise<void> {
  const mediaId = `${postId}-video`;
  await prisma.media.create({
    data: {
      id: mediaId,
      key: `${mediaId}.mp4`,
      mimeType: "video/mp4",
      postId,
      size: 1,
      status: "READY",
      type: "VIDEO",
      url: "https://example.test/fixture.mp4",
      userId,
    },
  });
  MEDIA_IDS.push(mediaId);
}

async function createFixtures(): Promise<void> {
  logger.info(
    { runId: RUN_ID },
    "creating recommendation integration fixtures"
  );
  await Promise.all([
    createUser(USER_IDS.explorer),
    createUser(USER_IDS.favorite, "IN"),
    createUser(USER_IDS.local, "IN"),
    createUser(USER_IDS.peer, "IN"),
    createUser(USER_IDS.remote, "US"),
    createUser(USER_IDS.viewer, "IN"),
    createUser(USER_IDS.viewerB, "US"),
    createUser(USER_IDS.coldStart),
  ]);

  const now = Date.now();
  const interestVectorText = "linux homelab server networking";
  sourcePostId = `rec-it-source-${RUN_ID}`;
  collaborativePostId = `rec-it-collaborative-${RUN_ID}`;
  socialProofPostId = `rec-it-zz-social-proof-${RUN_ID}`;
  commentProofPostId = `rec-it-yy-comment-proof-${RUN_ID}`;
  localPostId = `rec-it-local-post-${RUN_ID}`;
  remotePostId = `rec-it-remote-post-${RUN_ID}`;
  unrelatedPostId = `rec-it-unrelated-${RUN_ID}`;
  gustPostId = `rec-it-gust-${RUN_ID}`;

  await createPost({
    authorId: USER_IDS.favorite,
    content: "source post about a Linux homelab",
    createdAt: new Date(now - 60_000),
    id: sourcePostId,
    semanticTags: ["linux", "homelab", "networking"],
    vectorText: interestVectorText,
  });
  await createPost({
    authorId: USER_IDS.peer,
    content: "a peer-liked Linux server walkthrough",
    createdAt: new Date(now - 120_000),
    id: collaborativePostId,
    semanticTags: ["linux", "homelab", "networking"],
    vectorText: interestVectorText,
  });

  // These two posts intentionally have identical content features and age.
  // The only ranking difference should be the viewer/author country match.
  const geographicCreatedAt = new Date(now - 180_000);
  await createPost({
    authorId: USER_IDS.local,
    content: "local homelab community update",
    createdAt: geographicCreatedAt,
    id: localPostId,
    semanticTags: ["linux", "homelab"],
    vectorText: interestVectorText,
  });
  await createPost({
    authorId: USER_IDS.remote,
    content: "remote homelab community update",
    createdAt: geographicCreatedAt,
    id: remotePostId,
    semanticTags: ["linux", "homelab"],
    vectorText: interestVectorText,
  });
  await createPost({
    authorId: USER_IDS.explorer,
    content: "a cooking post outside the viewer's interest",
    createdAt: new Date(now - 240_000),
    id: unrelatedPostId,
    semanticTags: ["cooking", "recipes"],
    vectorText: "cooking recipes sourdough",
  });
  await createPost({
    authorId: USER_IDS.explorer,
    content: "a cooking post amplified by someone the viewer follows",
    createdAt: new Date(now - 240_000),
    id: socialProofPostId,
    semanticTags: ["cooking", "recipes"],
    vectorText: "cooking recipes sourdough",
  });
  await createPost({
    authorId: USER_IDS.explorer,
    content: "a cooking post discussed by someone the viewer follows",
    createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
    id: commentProofPostId,
    semanticTags: ["cooking", "recipes"],
    vectorText: "cooking recipes sourdough",
  });
  await createPost({
    authorId: USER_IDS.peer,
    content: "a video gust about Linux networking",
    createdAt: new Date(now - 300_000),
    id: gustPostId,
    isGust: true,
    semanticTags: ["linux", "networking"],
    vectorText: interestVectorText,
  });
  await createVideoAttachment(gustPostId, USER_IDS.peer);

  await prisma.follow.create({
    data: {
      followerId: USER_IDS.viewer,
      followingId: USER_IDS.favorite,
    },
  });

  // Exercise the bounded 500-row retrieval pool with a larger local corpus.
  // These rows are intentionally older than the signal-bearing posts but still
  // recent enough to be eligible for recommendation retrieval.
  const bulkPosts = Array.from({ length: 514 }, (_, index) => ({
    authorId: index % 2 === 0 ? USER_IDS.favorite : USER_IDS.explorer,
    content: `bulk fixture post ${index}`,
    createdAt: new Date(now - (index + 10) * 60_000),
    id: `rec-it-bulk-${RUN_ID}-${index}`,
    semanticTags: index % 2 === 0 ? ["linux"] : ["gardening"],
    vectorText: index % 2 === 0 ? interestVectorText : "gardening plants soil",
  }));
  await prisma.post.createMany({
    data: bulkPosts.map((post) => ({
      content: post.content,
      createdAt: post.createdAt,
      embedding: embedding(post.vectorText),
      id: post.id,
      semanticTags: post.semanticTags,
      userId: post.authorId,
    })),
  });
  POST_IDS.push(...bulkPosts.map((post) => post.id));

  const responseId = `rec-it-response-${RUN_ID}`;
  await createPost({
    authorId: USER_IDS.peer,
    content: "a response can enter the recommendation pool",
    createdAt: new Date(now - 30_000),
    id: responseId,
    semanticTags: ["linux"],
    vectorText: interestVectorText,
  });
  await prisma.post.update({
    data: { parentPostId: sourcePostId, rootPostId: sourcePostId },
    where: { id: responseId },
  });

  await prisma.vote.create({
    data: {
      createdAt: new Date(now - 30_000),
      postId: socialProofPostId,
      userId: USER_IDS.favorite,
      value: 1,
    },
  });
  await prisma.comment.create({
    data: {
      content: "favorite found this useful",
      createdAt: new Date(now - 20_000),
      id: `rec-it-social-proof-comment-${RUN_ID}`,
      postId: socialProofPostId,
      userId: USER_IDS.favorite,
    },
  });
  await prisma.comment.create({
    data: {
      content: "favorite discussed this one",
      createdAt: new Date(now - 20_000),
      id: `rec-it-comment-proof-${RUN_ID}`,
      postId: commentProofPostId,
      userId: USER_IDS.favorite,
    },
  });

  await prisma.recommendationEvent.createMany({
    data: [
      {
        createdAt: new Date(now - 30_000),
        durationMs: 12_000,
        eventType: "VIEW_COMPLETE",
        postId: sourcePostId,
        userId: USER_IDS.viewer,
      },
      {
        createdAt: new Date(now - 20_000),
        eventType: "BOOKMARK",
        postId: sourcePostId,
        userId: USER_IDS.peer,
      },
      {
        createdAt: new Date(now - 10_000),
        eventType: "BOOKMARK",
        postId: collaborativePostId,
        userId: USER_IDS.peer,
      },
      {
        createdAt: new Date(now - 5000),
        durationMs: 12_000,
        eventType: "VIEW_COMPLETE",
        postId: unrelatedPostId,
        userId: USER_IDS.viewerB,
      },
    ],
  });
  await invalidateFypProfile(USER_IDS.viewer);
  await invalidateFypProfile(USER_IDS.viewerB);
  await invalidateFypProfile(USER_IDS.coldStart);
  logger.info(
    {
      bulkPostCount: 514,
      postCount: POST_IDS.length,
      runId: RUN_ID,
      userCount: Object.keys(USER_IDS).length,
    },
    "recommendation integration fixtures ready"
  );
}

async function cleanupFixtures(): Promise<void> {
  logger.info(
    { runId: RUN_ID },
    "cleaning recommendation integration fixtures"
  );
  await redis.del(PROFILE_KEY, SECOND_PROFILE_KEY);
  if (POST_IDS.length > 0) {
    await prisma.post.deleteMany({ where: { id: { in: POST_IDS } } });
  }
  if (MEDIA_IDS.length > 0) {
    await prisma.media.deleteMany({ where: { id: { in: MEDIA_IDS } } });
  }
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(USER_IDS) } },
  });
  logger.info({ runId: RUN_ID }, "recommendation integration fixtures removed");
}

describe("personalized feed against local Postgres and Redis", () => {
  beforeAll(async () => {
    await createFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  test("personalizes by behavior, social proof, geography, and diversity", async () => {
    const page = await getPersonalizedFeedPage({
      includeVisited: true,
      pageSize: 20,
      userId: USER_IDS.viewer,
    });
    const ids = page.posts.map((post) => post.id);
    const indexOf = (id: string) => ids.indexOf(id);

    expect(ids.length).toBe(20);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(USER_IDS.viewer);
    expect(indexOf(collaborativePostId)).toBeGreaterThanOrEqual(0);
    expect(indexOf(collaborativePostId)).toBeLessThan(indexOf(unrelatedPostId));
    expect(indexOf(socialProofPostId)).toBeGreaterThanOrEqual(0);
    expect(indexOf(socialProofPostId)).toBeLessThan(indexOf(unrelatedPostId));
    expect(indexOf(localPostId)).toBeLessThan(indexOf(remotePostId));
    expect(new Set(page.posts.map((post) => post.userId)).size).toBeGreaterThan(
      2
    );
    expect(page.nextCursor).toBeTruthy();
    logger.info(
      {
        collaborativePosition: indexOf(collaborativePostId),
        geographicLocalPosition: indexOf(localPostId),
        geographicRemotePosition: indexOf(remotePostId),
        socialProofPosition: indexOf(socialProofPostId),
        topPosts: page.posts.slice(0, 10).map((post) => post.id),
        uniqueAuthors: new Set(page.posts.map((post) => post.userId)).size,
      },
      "recommendation quality assertions passed"
    );
  });

  test("gives different viewers different rankings and handles cold start", async () => {
    const [viewerAPage, viewerBPage, coldStartPage] = await Promise.all([
      getPersonalizedFeedPage({
        includeVisited: true,
        pageSize: 20,
        userId: USER_IDS.viewer,
      }),
      getPersonalizedFeedPage({
        includeVisited: true,
        pageSize: 20,
        userId: USER_IDS.viewerB,
      }),
      getPersonalizedFeedPage({
        includeVisited: true,
        pageSize: 20,
        userId: USER_IDS.coldStart,
      }),
    ]);
    const viewerATop = viewerAPage.posts.slice(0, 5).map((post) => post.id);
    const viewerBIds = viewerBPage.posts.map((post) => post.id);
    const viewerBIndexOf = (id: string) => viewerBIds.indexOf(id);

    expect(viewerATop).not.toEqual(
      viewerBPage.posts.slice(0, 5).map((post) => post.id)
    );
    expect(viewerBIndexOf(unrelatedPostId)).toBeGreaterThanOrEqual(0);
    expect(viewerBIndexOf(unrelatedPostId)).toBeLessThan(
      viewerBIndexOf(sourcePostId)
    );
    expect(coldStartPage.posts).toHaveLength(20);
    expect(coldStartPage.nextCursor).toBeTruthy();
    logger.info(
      {
        coldStartTopPosts: coldStartPage.posts
          .slice(0, 5)
          .map((post) => post.id),
        viewerATop,
        viewerBTop: viewerBPage.posts.slice(0, 5).map((post) => post.id),
      },
      "multi-viewer personalization assertions passed"
    );
  });

  test("only applies social proof from people the viewer follows", async () => {
    const candidateIds = [
      socialProofPostId,
      commentProofPostId,
      unrelatedPostId,
    ];
    const viewerWeights = await getSocialProofPostWeights(
      USER_IDS.viewer,
      candidateIds,
      new Date()
    );
    const nonFollowingViewerWeights = await getSocialProofPostWeights(
      USER_IDS.viewerB,
      candidateIds,
      new Date()
    );

    expect(viewerWeights.get(socialProofPostId)).toBeGreaterThan(0);
    expect(viewerWeights.get(commentProofPostId)).toBeGreaterThan(0);
    expect(nonFollowingViewerWeights.get(socialProofPostId) ?? 0).toBe(0);
    expect(nonFollowingViewerWeights.get(commentProofPostId) ?? 0).toBe(0);
    logger.info(
      {
        followedViewerWeight: viewerWeights.get(socialProofPostId),
        nonFollowingViewerWeight:
          nonFollowingViewerWeights.get(socialProofPostId) ?? 0,
      },
      "social proof follow-scope assertions passed"
    );
  });

  test("builds and reuses the taste profile in real Redis", async () => {
    const profile = await buildAndCacheProfile(USER_IDS.viewer);

    expect(profile.signalCount).toBeGreaterThan(0);
    expect(profile.tagWeights.linux).toBeGreaterThan(0);
    expect(profile.tasteVector?.length).toBe(384);
    expect(await redis.get(PROFILE_KEY)).not.toBeNull();

    const cachedPage = await getPersonalizedFeedPage({
      includeVisited: true,
      pageSize: 10,
      userId: USER_IDS.viewer,
    });
    expect(cachedPage.posts.length).toBe(10);
    logger.info(
      {
        cacheKey: PROFILE_KEY,
        cachedPageSize: cachedPage.posts.length,
        profileSignalCount: profile.signalCount,
        topTags: profile.summary?.topTags,
      },
      "profile and Redis cache assertions passed"
    );
  });

  test("keeps Gust personalization constrained to video Gusts", async () => {
    const page = await getPersonalizedFeedPage({
      contentKind: "gust",
      includeVisited: true,
      pageSize: 10,
      userId: USER_IDS.viewer,
    });

    expect(page.posts.length).toBeGreaterThan(0);
    expect(page.posts.every((post) => post.isGust)).toBe(true);
    expect(
      page.posts.every((post) =>
        post.attachments.some((attachment) => attachment.type === "VIDEO")
      )
    ).toBe(true);
    expect(page.posts.map((post) => post.id)).toContain(gustPostId);
    logger.info(
      {
        gustIds: page.posts.map((post) => post.id),
        gustPostCount: page.posts.length,
      },
      "Gust recommendation assertions passed"
    );
  });

  test("turns negative feedback into a persisted profile penalty", async () => {
    await prisma.recommendationEvent.create({
      data: {
        eventType: "NOT_INTERESTED",
        postId: collaborativePostId,
        userId: USER_IDS.viewer,
      },
    });
    await invalidateFypProfile(USER_IDS.viewer);

    const profile = await buildAndCacheProfile(USER_IDS.viewer);
    expect(profile.negativeAuthorWeights?.[USER_IDS.peer]).toBeGreaterThan(0);
    expect(profile.negativeTagWeights?.linux).toBeGreaterThan(0);
    logger.info(
      {
        negativeAuthorWeight: profile.negativeAuthorWeights?.[USER_IDS.peer],
        negativeTagWeight: profile.negativeTagWeights?.linux,
      },
      "negative feedback assertions passed"
    );
  });

  test("survives concurrent feed requests against the local stack", async () => {
    const startedAt = performance.now();
    const requestDurations: number[] = [];
    const pages = await Promise.all(
      Array.from({ length: 24 }, async () => {
        const requestStartedAt = performance.now();
        const page = await getPersonalizedFeedPage({
          includeVisited: true,
          pageSize: 20,
          userId: USER_IDS.viewer,
        });
        requestDurations.push(performance.now() - requestStartedAt);
        return page;
      })
    );
    const elapsedMs = performance.now() - startedAt;

    expect(pages).toHaveLength(24);
    expect(pages.every((page) => page.posts.length === 20)).toBe(true);
    // This is a hang/regression guard, not a production SLO. Actual SLOs need
    // to be measured under a production-shaped load test environment.
    expect(elapsedMs).toBeLessThan(15_000);
    const sortedDurations = requestDurations.toSorted((a, b) => a - b);
    const p95DurationMs =
      sortedDurations[Math.min(sortedDurations.length - 1, 22)] ?? elapsedMs;
    logger.info(
      {
        elapsedMs: Math.round(elapsedMs),
        maxDurationMs: Math.round(sortedDurations.at(-1) ?? elapsedMs),
        p95DurationMs: Math.round(p95DurationMs),
        requestCount: pages.length,
      },
      "concurrent recommendation load assertions passed"
    );
  });
});
