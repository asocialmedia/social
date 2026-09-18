import type { Metadata } from "next";
import { Suspense } from "react";

import PostDetailSkeleton from "@/components/layouts/skeletons/post-detail-skeleton";
import {
  generatePostMetadata,
  PostRoute,
} from "@/components/posts/page/post-route";

export interface PageProps {
  params: Promise<{ postId: string; slug?: string }>;
}

// Global post detail. A community post reached on this path is permanently
// redirected by the shared route to its canonical /a/<community>/posts/... home.
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { postId, slug } = await props.params;
  return generatePostMetadata({ postId, slug });
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<PostDetailSkeleton />}>
      <ResolvedPost params={props.params} />
    </Suspense>
  );
}

async function ResolvedPost({ params }: PageProps) {
  const { postId, slug } = await params;
  return <PostRoute params={{ postId, slug }} />;
}
