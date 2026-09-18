import { describe, expect, test } from "bun:test";

import type { GroupedNotificationData } from "@asm/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import Notification from "./notification";

function createMockNotificationItem(
  overrides: Partial<GroupedNotificationData> & {
    id: string;
    issuerId: string;
    type: GroupedNotificationData["type"];
  }
): GroupedNotificationData {
  const {
    id,
    issuerId,
    type,
    postId = "post-1",
    issuers,
    allNotificationIds,
    ...rest
  } = overrides;
  const defaultIssuer = {
    avatarUrl: `https://avatars.example.com/${issuerId}.jpg`,
    displayName: `User ${issuerId}`,
    id: issuerId,
    username: issuerId,
  };

  return {
    allNotificationIds: allNotificationIds ?? [id],
    comment: null,
    commentId: null,
    community: null,
    communityId: null,
    count: 1,
    createdAt: new Date("2026-09-13T12:00:00.000Z"),
    id,
    issuer: defaultIssuer,
    issuerId,
    issuers: issuers ?? [defaultIssuer],
    post: postId
      ? {
          community: null,
          content: "Snippet of user post",
          id: postId,
          isGust: false,
        }
      : null,
    postId,
    read: false,
    recipientId: "author-1",
    type,
    ...rest,
  };
}

function renderNotificationComponent(
  notification: GroupedNotificationData
): string {
  const queryClient = new QueryClient();
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <Notification notification={notification} />
    </QueryClientProvider>
  );
}

describe("Notification component (grouped rendering)", () => {
  test("renders single amplify notification with single avatar and headline", () => {
    const notif = createMockNotificationItem({
      id: "notif-1",
      issuerId: "alice",
      type: "AMPLIFY",
    });

    const html = renderNotificationComponent(notif);
    expect(html).toContain("User alice");
    expect(html).toContain("amplified your post");
    expect(html).not.toContain("+");
    expect(html).toContain("Snippet of user post");
  });

  test("renders 2-user grouped amplify with both names and no plus bubble", () => {
    const notif = createMockNotificationItem({
      allNotificationIds: ["notif-1", "notif-2"],
      id: "notif-1",
      issuerId: "alice",
      issuers: [
        {
          avatarUrl: "https://avatars.example.com/alice.jpg",
          displayName: "Alice",
          id: "alice",
          username: "alice",
        },
        {
          avatarUrl: "https://avatars.example.com/bob.jpg",
          displayName: "Bob",
          id: "bob",
          username: "bob",
        },
      ],
      type: "AMPLIFY",
    });

    const html = renderNotificationComponent(notif);
    expect(html).toContain("Alice");
    expect(html).toContain("and");
    expect(html).toContain("Bob");
    expect(html).toMatch(/amplified your (?:<!-- -->)?post/);
    expect(html).not.toContain("+");
  });

  test("renders 3-user grouped amplify with all three names", () => {
    const notif = createMockNotificationItem({
      allNotificationIds: ["notif-1", "notif-2", "notif-3"],
      id: "notif-1",
      issuerId: "alice",
      issuers: [
        {
          avatarUrl: "https://avatars.example.com/alice.jpg",
          displayName: "Alice",
          id: "alice",
          username: "alice",
        },
        {
          avatarUrl: "https://avatars.example.com/bob.jpg",
          displayName: "Bob",
          id: "bob",
          username: "bob",
        },
        {
          avatarUrl: "https://avatars.example.com/charlie.jpg",
          displayName: "Charlie",
          id: "charlie",
          username: "charlie",
        },
      ],
      type: "AMPLIFY",
    });

    const html = renderNotificationComponent(notif);
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Charlie");
    expect(html).toMatch(/amplified your (?:<!-- -->)?post/);
    expect(html).not.toContain("others");
  });

  test("renders 6-user grouped amplify with multiple avatars, +4 count bubble, and +4 text", () => {
    const users = ["Alice", "Bob", "Charlie", "David", "Eve", "Frank"];
    const notif = createMockNotificationItem({
      allNotificationIds: users.map((_, i) => `notif-${i + 1}`),
      id: "notif-1",
      issuerId: "alice",
      issuers: users.map((name) => ({
        avatarUrl: `https://avatars.example.com/${name.toLowerCase()}.jpg`,
        displayName: name,
        id: name.toLowerCase(),
        username: name.toLowerCase(),
      })),
      type: "AMPLIFY",
    });

    const html = renderNotificationComponent(notif);
    // Headline should mention first two users and +4 others
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toMatch(/\+<!-- -->4<!-- --> others|\+4 others/);
    expect(html).toMatch(/amplified your (?:<!-- -->)?post/);
    // Avatar row should render the +4 counter pill
    expect(html).toContain("+");
    expect(html).toContain("4");
    expect(html).toContain('title="+4 others"');
  });

  test("names the community on a community post's engagement", () => {
    const notif = createMockNotificationItem({
      id: "notif-community-comment",
      issuerId: "alice",
      post: {
        community: {
          accentColor: "orange",
          id: "community-1",
          name: "Anime",
          slug: "anime",
        },
        content: "Snippet of community post",
        id: "post-1",
        isGust: false,
      },
      type: "COMMENT",
    });

    const html = renderNotificationComponent(notif);
    // The action reads as happening inside the community, not on the global
    // feed, and links to the post's canonical community address.
    expect(html).toMatch(/eddied on your post(?:<!-- -->)? in a\/anime/);
    expect(html).toContain("/a/anime/posts/");
  });

  test("renders a batched community-post notification naming the community", () => {
    const notif = createMockNotificationItem({
      community: {
        accentColor: "orange",
        id: "community-1",
        name: "Anime",
        slug: "anime",
      },
      communityId: "community-1",
      count: 3,
      id: "notif-community-batch",
      issuerId: "alice",
      type: "COMMUNITY_POST",
    });

    const html = renderNotificationComponent(notif);
    expect(html).toContain("posted");
    expect(html).toContain("3 new fleets in a/anime");
    // The batched row links to the community itself, not a single post.
    expect(html).toContain('href="/a/anime"');
  });

  test("renders a single community-post as one new fleet", () => {
    const notif = createMockNotificationItem({
      community: {
        accentColor: "orange",
        id: "community-1",
        name: "Anime",
        slug: "anime",
      },
      communityId: "community-1",
      count: 1,
      id: "notif-community-single",
      issuerId: "alice",
      type: "COMMUNITY_POST",
    });

    const html = renderNotificationComponent(notif);
    expect(html).toContain("posted a new fleet in a/anime");
  });

  test("renders eddie amplification text when comment is present", () => {
    const notif = createMockNotificationItem({
      allNotificationIds: ["notif-1", "notif-2"],
      comment: {
        id: "comment-1",
        parent: null,
        parentId: null,
      },
      commentId: "comment-1",
      id: "notif-1",
      issuerId: "alice",
      issuers: [
        {
          avatarUrl: "https://avatars.example.com/alice.jpg",
          displayName: "Alice",
          id: "alice",
          username: "alice",
        },
        {
          avatarUrl: "https://avatars.example.com/bob.jpg",
          displayName: "Bob",
          id: "bob",
          username: "bob",
        },
      ],
      type: "AMPLIFY",
    });

    const html = renderNotificationComponent(notif);
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toMatch(/amplified your (?:<!-- -->)?eddie/);
  });
});
