// A community post's canonical home: /a/<slug>/posts/<postId>, mirroring
// web's app/(main)/a/[slug]/posts/[postId]/page.tsx. The shared detail screen
// loads the post by id; the slug is the community namespace for the route
// (web redirects when the post does not belong to `slug`, and the screen
// replaces to the canonical address here).
import { useLocalSearchParams } from "expo-router";

import { PostDetailScreen } from "@/features/post/components/post-detail-screen";

export default function CommunityPostDetailRoute() {
  const { postId, slug } = useLocalSearchParams<{
    postId?: string;
    slug?: string;
  }>();
  return (
    <PostDetailScreen
      communitySlug={typeof slug === "string" ? slug : undefined}
      postId={typeof postId === "string" ? postId : ""}
    />
  );
}

export { RouteErrorBoundary as ErrorBoundary } from "@/components/feedback/route-error-boundary";
