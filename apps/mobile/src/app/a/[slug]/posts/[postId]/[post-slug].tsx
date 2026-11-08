// Slugged form of a community post URL: /a/<slug>/posts/<postId>/<postSlug>,
// mirroring web's app/(main)/a/[slug]/posts/[postId]/[postSlug]/page.tsx.
// `postSlug` is the human-readable content slug; web redirects to the canonical
// short form when it is stale or missing. Natively there is no URL bar or SEO,
// so any slug lands on the same detail screen for that post id, with the
// community namespace guard replacing to the canonical address on mismatch,
// which is what a shared slugged link must open.
import { useLocalSearchParams } from "expo-router";

import { PostDetailScreen } from "@/features/post/components/post-detail-screen";

export default function CommunityPostSluggedRoute() {
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
