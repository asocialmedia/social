import { describe, expect, test } from "bun:test";

import {
  getCommentDataQuery,
  getPostDataQuery,
  getUserDataQuery,
  mapUserData,
} from "./client";
import prisma from "./prisma";

type UserQueryInput = Parameters<typeof mapUserData>[0];

describe("db client queries", () => {
  test("creates a public user query", () => {
    const query = getUserDataQuery(prisma.orm, "user123");
    expect(query).toBeDefined();
  });

  test("creates a post query with related data", () => {
    const query = getPostDataQuery(prisma.orm, "user123");
    expect(query).toBeDefined();
  });

  test("creates a comment query with user data", () => {
    const query = getCommentDataQuery(prisma.orm, "user123");
    expect(query).toBeDefined();
  });

  test("mapUserData extracts blueskyHandle from linked accounts", () => {
    const mapped = mapUserData({
      accounts: [
        { accountId: "did:plc:alice123", issuer: "alice.bsky.social" },
      ],
      aura: 100,
      avatarUrl: null,
      badge: null,
      badges: [],
      bannerUrl: null,
      bio: null,
      communityMembers: [],
      createdAt: new Date(),
      customDomain: null,
      displayName: "Alice",
      displayUsername: null,
      followsFollows: [],
      githubUsername: null,
      id: "u1",
      linkedinUsername: null,
      redditUsername: null,
      twitterUsername: null,
      username: "alice",
    } as unknown as UserQueryInput);

    expect(mapped.blueskyHandle).toBe("alice.bsky.social");
    expect(mapped.displayName).toBe("Alice");
  });

  test("mapUserData sets blueskyHandle to null when no linked account exists", () => {
    const mapped = mapUserData({
      accounts: [],
      aura: 50,
      avatarUrl: null,
      badge: null,
      badges: [],
      bannerUrl: null,
      bio: null,
      communityMembers: [],
      createdAt: new Date(),
      customDomain: null,
      displayName: "Bob",
      displayUsername: null,
      followsFollows: [],
      githubUsername: null,
      id: "u2",
      linkedinUsername: null,
      redditUsername: null,
      twitterUsername: null,
      username: "bob",
    } as unknown as UserQueryInput);

    expect(mapped.blueskyHandle).toBeNull();
  });
});
