import { describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToString } from "react-dom/server";

import type { UserRepliesPage } from "@/app/api/users/[userId]/replies/route";

import UserRepliesFeed from "./user-replies-feed";

mock.module("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

// Scans rendered HTML for an anchor nested inside another anchor (or an
// unbalanced one). React logs "<a> cannot be a descendant of <a>" as a
// hydration error for exactly this shape.
function hasNestedAnchor(html: string): boolean {
  const tagPattern = /<\/?a(?:\s[^<>]*)?>/g;
  let depth = 0;
  for (const match of html.matchAll(tagPattern)) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth < 0 || depth > 1) {
      return true;
    }
  }
  return depth !== 0;
}

function renderFeed() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const reply = {
    attachments: [],
    aura: 0,
    content: "Check this #cool out https://example.com",
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    deleted: false,
    id: "reply-1",
    parent: null,
    post: {
      content: "parent post",
      id: "post-1",
      isGust: false,
      user: { username: "parentuser" },
    },
    user: {
      avatarUrl: null,
      displayName: "Reply User",
      id: "user-1",
      username: "replyuser",
    },
    votes: [],
  };
  const page = {
    nextCursor: null,
    replies: [reply],
  } as unknown as UserRepliesPage;
  queryClient.setQueryData(["post-feed", "user-replies", "user-1"], {
    pageParams: [null],
    pages: [page],
  });
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <UserRepliesFeed userId="user-1" />
    </QueryClientProvider>
  );
}

describe("user replies feed link nesting", () => {
  test("reply content keeps its inner links without nesting anchors", () => {
    const html = renderFeed();
    // The reply body still links hashtags and URLs...
    expect(html).toContain('href="/hashtag/cool"');
    expect(html).toContain('href="https://example.com"');
    // ...the post itself stays reachable...
    expect(html).toContain("comment=reply-1");
    // ...but no anchor ever sits inside another anchor.
    expect(hasNestedAnchor(html)).toBe(false);
  });

  test("reply body navigates through an accessible container, not a link", () => {
    const html = renderFeed();
    expect(html).toContain('role="link"');
  });
});
