import { describe, expect, test } from "bun:test";

import type { PostParentData } from "@asm/db";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResponseParentRow } from "./response-parent-card";

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
});
