import { describe, expect, test } from "bun:test";

import type { PostParentData } from "@asm/db";
import type { ExternalPost } from "@asm/protocols/contracts";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ResponseParentCard, { ResponseParentRow } from "./response-parent-card";

const router = {
  back: () => {},
  bfcacheId: "response-source-test",
  forward: () => {},
  prefetch: () => {},
  push: () => {},
  refresh: () => {},
  replace: () => {},
};

function renderSource(children: ReactNode) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      {children}
    </AppRouterContext.Provider>
  );
}

const parent: PostParentData = {
  attachments: [],
  community: { accentColor: "pine", slug: "source-community" },
  content: "Community source post",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  embeds: [],
  id: "source-post",
  isGust: false,
  moderated: false,
  user: {
    avatarUrl: null,
    badge: null,
    badges: [],
    communityMemberships: [],
    displayName: "Source author",
    id: "source-author",
    username: "source-author",
  },
  userId: "source-author",
};

describe("response source community rail", () => {
  test.each([parent.id, "at://did:plc:alice/app.bsky.feed.post/source"])(
    "a compact unavailable source retains a recovery link for %s",
    (id) => {
      const html = renderSource(
        <ResponseParentCard parent={null} parentPostId={id} />
      );
      expect(html).toContain("Check original post");
      expect(html).toContain(
        id.startsWith("at://")
          ? `/network/bluesky?uri=${encodeURIComponent(id)}`
          : `/posts/${id}`
      );
    }
  );
  test("Bluesky source uses the shared full parent row, rail and internal profile route", () => {
    const source: ExternalPost = {
      author: {
        displayName: "Alice",
        handle: "alice.bsky.social",
        id: "did:plc:alice",
        labels: [],
        source: "bluesky",
        upstreamCounts: {},
        url: "https://bsky.app/profile/did:plc:alice",
      },
      createdAt: "2026-10-16T10:00:00.000Z",
      id: "at://did:plc:alice/app.bsky.feed.post/source",
      indexedAt: "2026-10-16T10:00:00.000Z",
      labels: [],
      languages: ["en"],
      media: [],
      revision: "revision",
      segments: [{ text: "The complete original" }],
      source: "bluesky",
      text: "The complete original",
      upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
      url: "https://bsky.app/profile/did:plc:alice/post/source",
    };
    const html = renderSource(
      <ResponseParentRow
        parent={{ ...parent, community: null, content: source.text }}
        parentPostId={source.id}
        external={source}
      />
    );
    expect(html).toContain(
      'data-response-source="at://did:plc:alice/app.bsky.feed.post/source"'
    );
    expect(html).toContain("The complete original");
    expect(html).toContain("/network/bluesky/profile?actor=did%3Aplc%3Aalice");
    expect(html).toContain("bg-border -mt-1 -mb-3 w-0.5 flex-1");
    expect(html).not.toContain("/users/source-author");
  });
  test("keeps the community rail inside the source, before the global response", () => {
    const html = renderSource(
      <>
        <ResponseParentRow parent={parent} parentPostId={parent.id} />
        <p data-response-body="true">Global response</p>
      </>
    );
    expect(html).toContain('data-response-source="source-post"');
    expect(
      html.match(/data-testid="response-source-community-rail"/g)
    ).toHaveLength(1);
    expect(html).toContain("--community-accent:#047857");
    expect(html).toContain("--community-accent-dark:#34d399");
    expect(html).toContain("a/source-community");
    expect(html).toEndWith(
      '</div><p data-response-body="true">Global response</p>'
    );
  });

  test("blurs explicit source media while keeping an ordinary source clear", () => {
    const source = {
      ...parent,
      attachments: [
        { height: 480, id: "media", type: "IMAGE" as const, width: 640 },
      ],
    };
    const hidden = renderSource(
      <ResponseParentRow
        parent={{ ...source, explicitContent: true }}
        parentPostId={source.id}
      />
    );
    const normal = renderSource(
      <ResponseParentRow
        parent={{ ...source, explicitContent: false }}
        parentPostId={source.id}
      />
    );
    expect(hidden).toContain("opacity-60 blur-lg saturate-50");
    expect(normal).not.toContain("blur-lg");
  });

  test("a global source has a thread connector without a community rail", () => {
    const html = renderSource(
      <ResponseParentRow
        parent={{ ...parent, community: null }}
        parentPostId={parent.id}
      />
    );
    expect(html).not.toContain("response-source-community-rail");
    expect(html).toContain("bg-border");
    expect(html).toContain("Community source post");
  });

  test("an unavailable source keeps its tombstone without a community rail", () => {
    const html = renderSource(
      <ResponseParentRow parent={null} parentPostId={parent.id} />
    );
    expect(html).not.toContain("response-source-community-rail");
    expect(html).toContain("This post is unavailable");
  });

  test("an unavailable external source retains its Bluesky recovery link without source metadata", () => {
    const uri = "at://did:plc:alice/app.bsky.feed.post/source";
    const html = renderSource(
      <ResponseParentRow parent={null} parentPostId={uri} />
    );
    expect(html).toContain("surface-3d");
    expect(html).toContain("This response is still available.");
    expect(html).toContain("Check original post");
    expect(html).toContain(`/network/bluesky?uri=${encodeURIComponent(uri)}`);
    expect(html).not.toContain("/posts/at:");
  });
});
