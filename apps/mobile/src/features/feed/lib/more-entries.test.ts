import { describe, expect, test } from "bun:test";

import type { FeedPost } from "./feed-types";
import { buildMoreEntries } from "./more-entries";

function post(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    attachments: [],
    content: "hello",
    createdAt: "2026-09-26T00:00:00.000Z",
    id: "post-1",
    tags: [],
    user: { id: "author-1", username: "alice" },
    userId: "author-1",
    ...overrides,
  } as FeedPost;
}

const community = {
  accentColor: "ember",
  id: "c1",
  name: "Builders",
  slug: "builders",
};

function labels(
  target: FeedPost,
  viewer: { id?: string | null; role?: string | null } = {}
): string[] {
  return buildMoreEntries({
    post: target,
    showCaptions: false,
    showingAlt: false,
    viewerId: viewer.id ?? null,
    viewerRole: viewer.role ?? null,
  }).map((entry) => entry.label);
}

describe("buildMoreEntries", () => {
  test("a reader on a plain post only gets Not interested", () => {
    expect(labels(post(), { id: "reader" })).toEqual(["Not interested"]);
  });

  test("a signed-out viewer gets no entries at all", () => {
    expect(labels(post())).toEqual([]);
  });

  test("the author is offered moderation, tags and delete but not hide", () => {
    const got = labels(post(), { id: "author-1" });
    expect(got).toContain("Moderation");
    expect(got).toContain("Edit tags & mentions");
    expect(got).toContain("Delete");
    // Hiding your own post is not a thing web offers.
    expect(got).not.toContain("Not interested");
  });

  test("the app admin may moderate someone else's post but not edit or delete it", () => {
    const got = labels(post(), { id: "admin", role: "admin" });
    expect(got).toContain("Moderation");
    expect(got).not.toContain("Edit tags & mentions");
    expect(got).not.toContain("Delete");
  });

  test("a community moderator role is not app staff", () => {
    expect(labels(post(), { id: "mod", role: "moderator" })).not.toContain(
      "Moderation"
    );
  });

  test("entries follow web's order", () => {
    const got = buildMoreEntries({
      post: post({
        attachments: [
          { altText: "a cat", id: "m1", type: "VIDEO" },
        ] as FeedPost["attachments"],
        community,
      }),
      showCaptions: false,
      showingAlt: false,
      viewerId: "author-1",
    }).map((entry) => entry.label);
    expect(got).toEqual([
      "Share to feed",
      "Moderation",
      "Show alt",
      "Show captions",
      "Edit tags & mentions",
      "Delete",
    ]);
  });
  test("an ordinary reader may not moderate someone else's post", () => {
    const got = labels(post(), { id: "reader", role: "user" });
    expect(got).not.toContain("Moderation");
    expect(got).not.toContain("Delete");
  });

  test("Share to feed needs a community, a session and an unmoderated post", () => {
    expect(labels(post({ community }), { id: "reader" })).toContain(
      "Share to feed"
    );
    // No community: there is nothing to share it into.
    expect(labels(post(), { id: "reader" })).not.toContain("Share to feed");
    // Moderated posts are not offered out.
    expect(
      labels(post({ community, moderated: true }), { id: "reader" })
    ).not.toContain("Share to feed");
    // A signed-out reader cannot post at all.
    expect(labels(post({ community }))).not.toContain("Share to feed");
  });

  test("delete is the only destructive entry", () => {
    const entries = buildMoreEntries({
      post: post({ community }),
      showCaptions: false,
      showingAlt: false,
      viewerId: "author-1",
    });
    const destructive = entries.filter((entry) => entry.destructive);
    expect(destructive).toHaveLength(1);
    expect(destructive[0]?.label).toBe("Delete");
  });
});
