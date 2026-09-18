import type { Metadata } from "next";
import { Suspense } from "react";

import MediaRouteSkeleton from "@/components/layouts/skeletons/media-route-skeleton";
import {
  generatePostMediaMetadata,
  PostMediaRoute,
} from "@/components/posts/page/post-media-route";

interface PageProps {
  params: Promise<{ slug: string; postId: string; index: string }>;
  searchParams: Promise<{ mediaId?: string }>;
}

// A community post's canonical shareable media route:
// /a/<community>/posts/<postId>/media/<index>.
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const { slug, postId, index } = params;
  return generatePostMediaMetadata({
    params: { communitySlug: slug, index, postId },
    searchParams,
  });
}

export default function Page(props: PageProps) {
  return (
    <Suspense fallback={<MediaRouteSkeleton />}>
      <ResolvedMedia {...props} />
    </Suspense>
  );
}

async function ResolvedMedia(props: PageProps) {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const { slug, postId, index } = params;
  return (
    <PostMediaRoute
      params={{ communitySlug: slug, index, postId }}
      searchParams={searchParams}
    />
  );
}
