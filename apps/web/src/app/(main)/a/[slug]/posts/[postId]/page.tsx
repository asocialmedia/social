import type { Metadata } from "next";
import { Suspense } from "react";

import PostDetailSkeleton from "@/components/layouts/skeletons/post-detail-skeleton";
import {
  generatePostMetadata,
  PostRoute,
} from "@/components/posts/page/post-route";

interface PageProps {
  params: Promise<{ slug: string; postId: string }>;
}

// A community post's canonical home: /a/<community>/posts/<postId>. The shared
// route checks the post really belongs to `slug` (and that the id/slug are the
// canonical short forms), redirecting to the true address otherwise.
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug, postId } = await props.params;
  return generatePostMetadata({ communitySlug: slug, postId });
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<PostDetailSkeleton />}>
      <ResolvedPost params={props.params} />
    </Suspense>
  );
}

async function ResolvedPost({ params }: PageProps) {
  const { slug, postId } = await params;
  return <PostRoute params={{ communitySlug: slug, postId }} />;
}
