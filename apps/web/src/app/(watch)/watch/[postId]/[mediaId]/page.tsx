import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { WatchVideoPlayer } from "@/components/media/watch-video-player";
import { getPost } from "@/components/posts/page/post-route";
import JsonLd from "@/components/seo/json-ld";
import {
  getPostPath,
  postDescription,
  postTitle,
  siteConfig,
} from "@/lib/seo/seo";
import { buildVideoJsonLd, videoWatchUrl } from "@/lib/seo/video";

interface PageProps {
  params: Promise<{ postId: string; mediaId: string }>;
}

async function getPublicVideo(postId: string, mediaId: string) {
  "use cache";
  cacheLife({ expire: 300, revalidate: 60, stale: 60 });
  const post = await getPost(postId, "", { mediaId });
  const media = post.attachments.find(
    (attachment) => attachment.id === mediaId && attachment.type === "VIDEO"
  );
  if (!media) {
    notFound();
  }
  return { media, post };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { postId, mediaId } = await params;
  const { post } = await getPublicVideo(postId, mediaId);
  const title = postTitle(post);
  const description = postDescription(post);
  const url = videoWatchUrl(post.id, mediaId);
  const images = [`${siteConfig.url}/api/media/${mediaId}?thumb=1`];
  return {
    alternates: { canonical: url },
    description,
    openGraph: {
      description,
      images,
      siteName: siteConfig.name,
      title,
      type: "video.other",
      url,
    },
    title,
    twitter: { card: "summary_large_image", description, images, title },
  };
}

async function WatchVideo({ params }: PageProps) {
  const { postId, mediaId } = await params;
  const { post, media } = await getPublicVideo(postId, mediaId);
  const title = postTitle(post);
  const description = postDescription(post);
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
      <nav
        aria-label="Video navigation"
        className="mb-5 flex justify-between gap-4 text-sm"
      >
        <Link href="/">asocialmedia</Link>
        <Link href={getPostPath(post)}>Post and discussion ↗</Link>
      </nav>
      <JsonLd
        data={buildVideoJsonLd({
          createdAt: post.createdAt,
          description,
          mediaId,
          postId: post.id,
          title,
        })}
      />
      <WatchVideoPlayer
        mediaId={media.id}
        title={title}
        hasHls={media.hasHls}
        hasCaptions={Boolean(media.transcript)}
      />
      <h1 className="mt-6 text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        By @{post.user.username} ·{" "}
        <time dateTime={post.createdAt.toISOString()}>
          {post.createdAt.toISOString().slice(0, 10)}
        </time>
      </p>
      <p className="mt-4 max-w-3xl whitespace-pre-wrap">
        {post.content || description}
      </p>
    </main>
  );
}

export default function Page(props: PageProps) {
  return (
    <Suspense>
      <WatchVideo {...props} />
    </Suspense>
  );
}
