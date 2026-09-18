import type { Metadata } from "next";
import { Suspense } from "react";

import MediaRouteSkeleton from "@/components/layouts/skeletons/media-route-skeleton";
import {
  generatePostMediaMetadata,
  PostMediaRoute,
} from "@/components/posts/page/post-media-route";

interface PageProps {
  params: Promise<{ postId: string; index: string }>;
  searchParams: Promise<{ mediaId?: string }>;
}

// Global shareable media route. A community post reached here is permanently
// redirected to its canonical /a/<community>/posts/.../media/... home.
export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  return generatePostMediaMetadata({ params, searchParams });
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
  return <PostMediaRoute params={params} searchParams={searchParams} />;
}
