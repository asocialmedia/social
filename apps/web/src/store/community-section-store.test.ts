import { afterEach, expect, test } from "bun:test";

import {
  communitySectionScope,
  useCommunitySectionStore,
} from "./community-section-store";

afterEach(() => useCommunitySectionStore.setState({ locations: {} }));

test("switching sections retains both filtered posts and the last channel", () => {
  const scope = communitySectionScope("anny", "table");
  const { remember } = useCommunitySectionStore.getState();
  remember(scope, { postsHref: "/a/table?sort=top&type=images" });
  remember(scope, { chatHref: "/a/table/chat/studio" });
  expect(useCommunitySectionStore.getState().locations[scope]).toEqual({
    chatHref: "/a/table/chat/studio",
    postsHref: "/a/table?sort=top&type=images",
  });
});

test("community and account scopes do not expose another viewer's return destination", () => {
  const { remember } = useCommunitySectionStore.getState();
  remember(communitySectionScope("anny", "table"), {
    chatHref: "/a/table/chat/staff",
  });
  for (const scope of [
    communitySectionScope("someone", "table"),
    communitySectionScope(undefined, "table"),
    communitySectionScope("anny", "other"),
  ]) {
    expect(
      useCommunitySectionStore.getState().locations[scope]
    ).toBeUndefined();
  }
});

test("repeated route renders do not publish redundant navigation updates", () => {
  const scope = communitySectionScope("anny", "table");
  const { remember } = useCommunitySectionStore.getState();
  remember(scope, { postsHref: "/a/table" });
  const previous = useCommunitySectionStore.getState();
  remember(scope, { postsHref: "/a/table" });
  expect(useCommunitySectionStore.getState()).toBe(previous);
});

test("session navigation memory remains bounded across many communities", () => {
  const { remember } = useCommunitySectionStore.getState();
  for (let index = 0; index < 50; index += 1) {
    remember(communitySectionScope("anny", `community-${index}`), {
      postsHref: `/a/community-${index}`,
    });
  }
  const { locations } = useCommunitySectionStore.getState();
  expect(Object.keys(locations)).toHaveLength(32);
  expect(
    locations[communitySectionScope("anny", "community-0")]
  ).toBeUndefined();
  expect(locations[communitySectionScope("anny", "community-49")]).toEqual({
    postsHref: "/a/community-49",
  });
});
