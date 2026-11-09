import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP = path.join(import.meta.dir, "..", "..", "app");

// Every screen a reader can land on recovers in place: a throw there must
// not escalate to the root boundary and blank the whole app.
const SCREEN_ROUTES = [
  "index.tsx",
  "posts/[postId]/index.tsx",
  "posts/[postId]/media/[index].tsx",
  "a/[slug].tsx",
  "a/[slug]/chat.tsx",
  "a/[slug]/chat/[channel-id].tsx",
  "a/[slug]/chat/[channel-id]/threads/[thread-id].tsx",
  "a/[slug]/posts/[postId]/index.tsx",
  "a/[slug]/posts/[postId]/[post-slug].tsx",
  "a/[slug]/posts/[postId]/media/[index].tsx",
  "gusts.tsx",
  "messages/index.tsx",
  "messages/[conversationId]/index.tsx",
  "settings.tsx",
  "users/[username].tsx",
  "discover.tsx",
  "communities.tsx",
  "notifications.tsx",
  "hackernews.tsx",
  "bookmarks.tsx",
  "camera.tsx",
  "history.tsx",
  "external-post.tsx",
  "external-profile.tsx",
  "hashtag/[tag].tsx",
];

test.each(SCREEN_ROUTES)("%s exports a route error boundary", (route) => {
  const source = readFileSync(path.join(APP, route), "utf-8");
  expect(source).toContain(
    'export { RouteErrorBoundary as ErrorBoundary } from "@/components/feedback/route-error-boundary";'
  );
});
