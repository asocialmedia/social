import { prisma } from "@asm/db";
import type { Metadata } from "next";
import { Suspense } from "react";

import { GustCardSkeleton } from "@/components/gusts/gust-card-skeleton";
import JsonLd from "@/components/seo/json-ld";
import { getUserData } from "@/hooks/use-user-data";
import { absoluteUrl, excerpt, siteConfig } from "@/lib/seo";
import { getRecentGustsForCrawl } from "@/lib/server-feed";
import { getSessionFromApi } from "@/lib/session";

import { ClientGusts } from "./client-gusts";

interface GustsPageProps {
  searchParams: Promise<{ id?: string }>;
}

export async function generateMetadata(
  props: GustsPageProps
): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const gustId = searchParams.id;

  if (gustId) {
    const post = await prisma.post.findUnique({
      include: {
        attachments: true,
        tags: { select: { name: true } },
        user: {
          select: {
            avatarUrl: true,
            displayName: true,
            id: true,
            username: true,
          },
        },
      },
      where: { id: gustId },
    });

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

      const videoMedia = post.attachments.find((m) => m.type === "VIDEO");
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
          ...post.tags.map((t) => t.name),
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
          tags: post.tags.map((t) => t.name),
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

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh w-full items-center justify-center bg-[hsl(var(--background-alt))]">
          <GustCardSkeleton />
        </div>
      }
    >
      <GustsContent />
    </Suspense>
  );
}

async function GustsContent() {
  const session = await getSessionFromApi();
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
      {itemListJsonLd ? <JsonLd data={itemListJsonLd} /> : null}
      <ClientGusts loggedInUserData={loggedInUserData} />
      {/* Hidden crawlable gust links for bots: JS-only stream has no SSR links */}
      <div className="sr-only" aria-hidden={false}>
        <nav aria-label="Latest gusts crawlable">
          <ul>
            {gusts.map((g) => (
              <li key={g.id}>
                <a href={`/gusts?id=${g.id}`}>{g.content || g.id}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
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
