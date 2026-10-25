import {
  and,
  communityVisibilityWhere,
  getPostDataQuery,
  mapPostData,
  prisma,
} from "@asm/db";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { GustCardSkeleton } from "@/components/gusts/gust-card-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/users/use-user-data";
import { getSessionFromApi } from "@/lib/auth/session";
import { postContentReadable } from "@/lib/posts/reader-content-policy";
import { getRecentGustsForCrawl } from "@/lib/posts/server-feed";
import { buildSocialPostJsonLd } from "@/lib/seo/post-schema";
import {
  absoluteUrl,
  excerpt,
  getPostUrl,
  postDescription,
  postTitle,
  siteConfig,
} from "@/lib/seo/seo";

import { ClientGusts } from "./client-gusts";

interface GustsPageProps {
  searchParams: Promise<{ id?: string }>;
}

// A single gust's metadata is public and viewer-independent, and
// generateMetadata cannot sit behind a Suspense boundary, so the read lives in
// a cache scope: a Prisma read in the metadata scope trips the sync-IO check
// (Prisma 8 stamps every query with a crypto.randomUUID() plan id) and aborts
// the prerender. `connection()` does not clear it.
async function getMetadataGust(gustId: string) {
  "use cache";
  cacheLife("hours");
  cacheTag("og-post-card");
  return await readPublicGust(gustId);
}

async function readPublicGust(gustId: string) {
  const row = await getPostDataQuery(prisma.orm, "")
    .where((candidate) =>
      and(
        candidate.id.eq(gustId),
        candidate.isGust.eq(true),
        candidate.moderated.eq(false),
        candidate.explicitContent.eq(false),
        candidate.user.some((user) => user.banned.eq(false)),
        communityVisibilityWhere("")(candidate)
      )
    )
    .first();
  const post = row ? mapPostData(row) : null;
  return post && postContentReadable(post, false) ? post : null;
}

export async function generateMetadata(
  props: GustsPageProps
): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const gustId = searchParams.id;

  if (gustId?.startsWith("at://")) {
    return { robots: { follow: true, index: false }, title: "Bluesky video" };
  }
  if (gustId) {
    const post = await getMetadataGust(gustId);

    if (post) {
      const authorUsername = post.user?.username || "unknown";
      const authorName =
        post.user?.displayName || post.user?.username || "Anonymous";
      const snippet = post.content ? excerpt(post.content, 60) : "";
      const title = snippet
        ? `${authorName} (@${authorUsername}): ${snippet}`
        : `${authorName} (@${authorUsername})'s Gust`;
      const description = post.content?.trim()
        ? `${excerpt(post.content, 140)} · ${post.aura} aura`
        : `Watch ${authorName}'s gust video clip on asocialmedia.`;
      const canonical = `/gusts?id=${post.id}`;
      const url = absoluteUrl(canonical);
      const { tags } = post;

      const videoMedia = post.attachments.find(
        (media) => media.type === "VIDEO"
      );
      // ?thumb=1 always resolves server-side: poster derivative for
      // pipeline videos, legacy thumbnail frame otherwise.
      const videoThumb = videoMedia
        ? absoluteUrl(`/api/media/${videoMedia.id}?thumb=1`)
        : null;
      const ogImageUrl =
        videoThumb || absoluteUrl(`/posts/${post.id}/opengraph-image`);

      return {
        alternates: { canonical },
        description,
        keywords: [
          "gusts",
          "short-form video",
          "reels",
          authorName,
          authorUsername,
          ...tags.map((tag) => tag.name),
        ],
        openGraph: {
          authors: [absoluteUrl(`/users/${authorUsername}`)],
          description,
          images: [
            {
              alt: title,
              height: 630,
              url: ogImageUrl,
              width: 1200,
            },
          ],
          locale: siteConfig.locale,
          siteName: siteConfig.name,
          tags: tags.map((tag) => tag.name),
          title,
          type: "article",
          url,
        },
        title,
        twitter: {
          card: "summary_large_image",
          creator: `@${authorUsername}`,
          description,
          images: [ogImageUrl],
          title,
        },
      };
    }
    return { robots: { follow: true, index: false }, title: "Gust" };
  }

  return {
    alternates: { canonical: "/gusts" },
    description:
      "Explore high-energy short-form video clips and creative gusts on asocialmedia.",
    keywords: [
      "gusts",
      "short-form video",
      "reels",
      "video clips",
      "asocialmedia",
    ].join(", "),
    openGraph: {
      description:
        "Explore high-energy short-form video clips and creative gusts on asocialmedia.",
      images: [
        {
          alt: "Gusts on asocialmedia",
          height: 630,
          url: absoluteUrl(siteConfig.ogImage),
          width: 1200,
        },
      ],
      locale: siteConfig.locale,
      siteName: siteConfig.name,
      title: "Gusts",
      type: "website",
      url: absoluteUrl("/gusts"),
    },
    title: "Gusts",
    twitter: {
      card: "summary_large_image",
      description:
        "Explore high-energy short-form video clips and creative gusts on asocialmedia.",
      images: [absoluteUrl(siteConfig.ogImage)],
      title: "Gusts",
    },
  };
}

export default function Page(props: GustsPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh w-full items-center justify-center bg-[hsl(var(--background-alt))]">
          <GustCardSkeleton />
        </div>
      }
    >
      <GustsContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function GustsContent({ searchParams }: GustsPageProps) {
  // Claims the request before the first read. Prisma 8 stamps every query with
  // a crypto.randomUUID() plan id, and Cache Components fails a prerender that
  // touches an uncached value, so an unclaimed database read aborts the
  // prerender. headers() alone does not claim it: partial prefetching serves
  // runtime data during the shell render.
  await connection();

  const { id } = await searchParams;
  const session = await getSessionFromApi();
  const selectedPost =
    !session?.user && id && !id.startsWith("at://")
      ? await readPublicGust(id)
      : null;
  if (!session?.user && id && !id.startsWith("at://") && !selectedPost) {
    notFound();
  }
  const loggedInUserData = session?.user
    ? await getUserData(session.user.id)
    : null;

  const gusts = await getRecentGustsForCrawl(16);

  const itemListJsonLd =
    gusts.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: gusts.map((post, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${siteConfig.url}/gusts?id=${post.id}`,
          })),
          name: "Latest gusts on asocialmedia",
        }
      : null;

  return (
    <>
      {selectedPost ? (
        <JsonLd
          data={buildSocialPostJsonLd({
            author: {
              name:
                selectedPost.user?.displayName ||
                selectedPost.user?.username ||
                "Anonymous",
              url: absoluteUrl(
                `/users/${selectedPost.user?.username || "unknown"}`
              ),
              username: selectedPost.user?.username || "unknown",
            },
            commentCount: selectedPost._count.comments,
            content: selectedPost.content,
            createdAt: selectedPost.createdAt,
            description: postDescription(selectedPost),
            headline: postTitle(selectedPost),
            media: selectedPost.attachments,
            url: getPostUrl(selectedPost),
            viewCount: selectedPost.viewCount,
          })}
        />
      ) : null}
      {itemListJsonLd ? <JsonLd data={itemListJsonLd} /> : null}
      <ClientGusts
        initialGuestPost={
          session?.user ? undefined : (selectedPost ?? undefined)
        }
        loggedInUserData={loggedInUserData}
      />
      {/* Visible crawlable fallback below the interactive area on no-JS */}
      <noscript>
        <div style={{ padding: 16 }}>
          <p>Recent gusts:</p>
          <ul>
            {gusts.map((g) => (
              <li key={g.id}>
                <a href={`/gusts?id=${g.id}`}>{g.content || g.id}</a>
              </li>
            ))}
          </ul>
        </div>
      </noscript>
    </>
  );
}
