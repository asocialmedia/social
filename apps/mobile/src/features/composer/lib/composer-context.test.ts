import { expect, test } from "bun:test";

import type { ComposerDraft } from "../state/composer-store";
import {
  composerPublishContext,
  draftForComposerOpen,
  draftWithContext,
  hasFleetContent,
  removeHnStory,
} from "./composer-context";

const draft: ComposerDraft = { mentions: [], tags: [], text: "" };
const story = {
  descendants: 4,
  score: 20,
  storyId: 123,
  title: "Story without an external URL",
};

test("normal compose clears a previous community destination and Gust clears fleet-only embeds", () => {
  const previous = {
    ...draft,
    communityId: "old",
    communitySharePostId: "source",
    hnStory: story,
    text: "My thoughts",
  };
  const fleet = draftForComposerOpen(previous, "post", false);
  expect(fleet.communityId).toBeUndefined();
  expect(fleet.communitySharePostId).toBeUndefined();
  expect(fleet.hnStory).toEqual(story);
  const gust = draftForComposerOpen(previous, "gust", false);
  expect(gust.hnStory).toBeUndefined();
  expect(gust.text).toBe("My thoughts");
  expect(draftForComposerOpen(previous, "post", true).hnStory).toBeUndefined();
});

test("an attached Hacker News story enables a fleet without a caption", () => {
  const next = draftWithContext(
    { ...draft, communityId: "old" },
    { kind: "hn", story }
  );
  expect(next.text).toBe(`Sharing: "${story.title}"`);
  expect(hasFleetContent({ ...next, text: "" }, 0)).toBe(true);
  expect(composerPublishContext(next).hnStory).toEqual(story);
  expect(next.communityId).toBeUndefined();
  expect(hasFleetContent(removeHnStory(next), 0)).toBe(false);
  expect(removeHnStory({ ...next, text: "My own caption" }).text).toBe(
    "My own caption"
  );
});

test("a community reshare publishes to the global feed with source attribution", () => {
  const next = draftWithContext(
    { ...draft, communityId: "source-community", hnStory: story },
    {
      kind: "share",
      source: {
        name: "ASM",
        slug: "asocialmedia",
        sourcePostId: "source-post",
      },
    }
  );
  expect(hasFleetContent(next, 0)).toBe(true);
  expect(next.communityShare?.slug).toBe("asocialmedia");
  expect(composerPublishContext(next)).toEqual({
    communityId: undefined,
    communitySharePostId: "source-post",
    hnStory: undefined,
    parentPostId: undefined,
  });
  expect(
    composerPublishContext({ ...next, communityId: "legacy-source" })
      .communityId
  ).toBeUndefined();
});

test("responding clears previous publishing targets while keeping the author's draft", () => {
  const previous = {
    ...draft,
    communityId: "old-community",
    communitySharePostId: "old-source",
    hnStory: story,
    tags: ["native"],
    text: "My thoughts",
  };
  const next = draftWithContext(previous, { kind: "reply" });
  expect(next.text).toBe("My thoughts");
  expect(next.tags).toEqual(["native"]);
  expect(composerPublishContext(next, "parent")).toEqual({
    communityId: undefined,
    communitySharePostId: undefined,
    hnStory: undefined,
    parentPostId: "parent",
  });
  expect(composerPublishContext(previous, "parent")).toEqual(
    composerPublishContext(next, "parent")
  );
});

test("posting inside a community and removing that destination match web", () => {
  const next = draftWithContext(draft, {
    community: { id: "community", slug: "native" },
    kind: "community",
  });
  expect(next.communitySlug).toBe("native");
  expect(composerPublishContext(next).communityId).toBe("community");
  expect(hasFleetContent(next, 0)).toBe(false);
  expect(hasFleetContent(next, 1)).toBe(true);
  expect(
    composerPublishContext(draftWithContext(next, { kind: "global" }))
      .communityId
  ).toBeUndefined();
});
