import { externalUriSchema } from "@asm/protocols/discovery";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExternalPostPage } from "@/components/protocols/external-post-page";
import JsonLd from "@/components/seo/json-ld";
import {
  blueskyPostJsonLd,
  blueskyPostMetadata,
} from "@/lib/seo/bluesky-metadata";
import { getPublicBlueskyPost } from "@/lib/seo/public-bluesky-post";

interface PageProps {
  searchParams: Promise<{ uri?: string }>;
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { uri } = await searchParams;
  if (!externalUriSchema.safeParse(uri).success) {
    notFound();
  }
  const post = await getPublicBlueskyPost(uri);
  if (!post) {
    return {
      robots: { follow: true, index: false },
      title: "Bluesky post and discussion",
    };
  }
  return blueskyPostMetadata(post);
}

async function PublicBlueskyPost({ searchParams }: PageProps) {
  const { uri } = await searchParams;
  if (!externalUriSchema.safeParse(uri).success) {
    notFound();
  }
  const post = await getPublicBlueskyPost(uri);
  if (!post) {
    // Keep local discussions and opted-in reads available when the public source is absent or restricted.
    return <ExternalPostPage />;
  }
  return (
    <>
      <JsonLd data={blueskyPostJsonLd(post)} />
      <ExternalPostPage initialPost={post} />
      <p className="px-4 py-3 text-sm">
        <a className="underline underline-offset-4" href={post.url}>
          Original post on Bluesky ↗
        </a>
      </p>
    </>
  );
}

export default function Page(props: PageProps) {
  return (
    <Suspense>
      <PublicBlueskyPost {...props} />
    </Suspense>
  );
}
