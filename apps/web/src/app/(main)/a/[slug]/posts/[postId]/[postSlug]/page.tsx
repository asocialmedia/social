import type { Metadata } from "next";
import { Suspense } from "react";

import PostDetailSkeleton from "@/components/layouts/skeletons/post-detail-skeleton";
import {
  generatePostMetadata,
  PostRoute,
} from "@/components/posts/page/post-route";

interface PageProps {
  params: Promise<{ slug: string; postId: string; postSlug: string }>;
}

// The slugged form of a community post URL. `postSlug` is the human-readable
// content slug; the shared route verifies it against the post and redirects to
// the canonical short form when it is stale or missing.
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug, postId, postSlug } = await props.params;
  return generatePostMetadata({ communitySlug: slug, postId, slug: postSlug });
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<PostDetailSkeleton />}>
      <ResolvedPost params={props.params} />
    </Suspense>
  );
}

async function ResolvedPost({ params }: PageProps) {
  const { slug, postId, postSlug } = await params;
  return <PostRoute params={{ communitySlug: slug, postId, slug: postSlug }} />;
}
